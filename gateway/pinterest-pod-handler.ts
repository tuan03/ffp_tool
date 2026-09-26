import fs from "node:fs";
import path from "node:path";
import type http from "node:http";

import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { loadLocalEnv } from "./store-config-loader";
import { handoverPinterestToSeo } from "../src/modules/orchestrator";
import type { PinterestPodDeliverables, PodDeliverableItem } from "../src/modules/pinterest-pod";
import { adaptPinterestPodItemToViewModel } from "../src/pages/seo-review/seo-content-ui-adapter";
import type { SeoProductUiViewModel } from "../src/pages/seo-review/types";
import type { SeoContentInput, SeoContentOutput, PinterestPodSeoItemResult } from "../src/modules/seo-content";

export interface PinterestPodSeoHandlerOptions {
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
  readonly seoRunner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  readonly outputDir?: string;
}

export interface PinterestPodSeoResponse {
  readonly success: boolean;
  readonly message: string;
  readonly workflowId: string;
  readonly count: number;
  readonly receivedAt: number;
  readonly printMasterCount: number;
  readonly approvedMockupCount: number;
  readonly savedPath: string;
  readonly items: readonly PinterestPodSeoItemResult[];
  readonly viewModels: readonly SeoProductUiViewModel[];
}

/**
 * Loads server-side environment variables from local .env files onto process.env.
 * Ensures Google Cloud ADC credentials (e.g. GOOGLE_CLOUD_PROJECT) are present in Node.js.
 */
export function loadServerEnvironment(cwd: string = process.cwd()): Record<string, string> {
  const localEnv = loadLocalEnv(cwd);
  for (const [key, val] of Object.entries(localEnv)) {
    if (process.env[key] === undefined && val !== undefined) {
      process.env[key] = val;
    }
  }
  return localEnv;
}

/**
 * Validates whether the parsed body conforms to PinterestPodDeliverables.
 */
export function validatePinterestPodDeliverables(body: unknown): PinterestPodDeliverables {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid request body: expected JSON object");
  }

  const candidate = body as Partial<PinterestPodDeliverables>;
  if (!Array.isArray(candidate.items)) {
    throw new Error("Invalid request body: 'items' array is required");
  }

  return body as PinterestPodDeliverables;
}

/**
 * HTTP handler for POST /api/pinterest-pod/handover-seo.
 * Runs inside Backend Gateway (Node.js) where Google Cloud ADC & Vertex AI are available.
 */
export async function handlePinterestPodSeoHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: PinterestPodSeoHandlerOptions,
): Promise<void> {
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "METHOD_NOT_ALLOWED", message: "Method Not Allowed" },
      }),
    );
    return;
  }

  if (options?.authToken && !isGatewayAuthorized(req.headers, options.authToken)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: "GATEWAY_AUTH_FAILED",
          message: "Unauthorized: Invalid or missing Gateway authentication token",
        },
      }),
    );
    return;
  }

  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0 ? options.maxBodyBytes : MAX_BODY_BYTES;

  const clHeader = req.headers["content-length"];
  if (clHeader) {
    const cl = Number.parseInt(clHeader, 10);
    if (!Number.isNaN(cl) && cl > maxBodyBytes) {
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
          },
        }),
      );
      return;
    }
  }

  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxBodyBytes) {
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: "PAYLOAD_TOO_LARGE",
              message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
            },
          }),
        );
        return;
      }
      chunks.push(buf);
    }

    const bodyText = Buffer.concat(chunks).toString("utf8");
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyText);
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: { code: "INVALID_JSON", message: "Invalid JSON body" },
        }),
      );
      return;
    }

    const payload = validatePinterestPodDeliverables(parsedBody);

    // 1. Ensure server environment (Google Cloud credentials / Vertex AI) is loaded
    loadServerEnvironment();

    // 2. Persist backup copies to local filesystem (matches Python backend layout)
    const rawWorkflowId = payload.workflowId || (payload as { jobId?: string }).jobId || `job_pod_${Date.now()}`;
    const workflowId = String(rawWorkflowId).replace(/[^a-zA-Z0-9_-]/g, "_");
    const baseOutputDir = options?.outputDir
      ? path.resolve(options.outputDir)
      : path.resolve(process.cwd(), "src/modules/pinterest-pod/server/data/pinterest_pod/output");

    const handoffDir = path.resolve(baseOutputDir, workflowId);
    if (!handoffDir.startsWith(baseOutputDir)) {
      throw new Error(`Invalid workflowId: path traversal detected '${rawWorkflowId}'`);
    }
    fs.mkdirSync(handoffDir, { recursive: true });
    const handoffFile = path.join(handoffDir, "seo_handoff_payload.json");
    fs.writeFileSync(handoffFile, JSON.stringify(payload, null, 2), "utf8");

    // Also write a secondary copy to data/seo_handoffs for audit
    try {
      const seoInboxDir = options?.outputDir
        ? path.join(path.resolve(options.outputDir), "seo_handoffs")
        : path.resolve(process.cwd(), "src/modules/pinterest-pod/server/data/seo_handoffs");
      const seoBackupFile = path.resolve(seoInboxDir, `${workflowId}_seo_payload.json`);
      if (seoBackupFile.startsWith(seoInboxDir)) {
        fs.mkdirSync(seoInboxDir, { recursive: true });
        fs.writeFileSync(seoBackupFile, JSON.stringify(payload, null, 2), "utf8");
      }
    } catch {
      // Non-fatal secondary copy
    }

    const savedPath = path.relative(process.cwd(), handoffFile).replace(/\\/g, "/");

    // 3. Coordinate handover to SEO Pipeline
    const firstItem = payload.items[0];
    const defaultNiche =
      firstItem?.trendKeywords?.[0] ||
      (firstItem as PodDeliverableItem | undefined)?.productType ||
      payload.productType ||
      "home decor";

    const handoverResult = await handoverPinterestToSeo(
      {
        workflowId,
        deliverables: payload,
        defaultNiche,
      },
      {
        ...(options?.seoRunner ? { seoRunner: options.seoRunner } : {}),
      },
    );

    // 4. Adapt items to SeoProductUiViewModel
    const viewModels = handoverResult.items.map((item) => adaptPinterestPodItemToViewModel(item));

    const printMasterCount = payload.items.filter((it) => Boolean(it.printMaster)).length;
    const approvedMockupCount = payload.items.reduce(
      (acc, it) => acc + (it.composedMockups?.length ?? 0),
      0,
    );

    const responseData: PinterestPodSeoResponse = {
      success: true,
      message: `Bàn giao sang SEO thành công: ${printMasterCount} file in xưởng (CMYK 300 DPI) và ${approvedMockupCount} mockup AI đã duyệt.`,
      workflowId: handoverResult.workflowId,
      count: handoverResult.total,
      receivedAt: Date.now(),
      printMasterCount,
      approvedMockupCount,
      savedPath,
      items: handoverResult.items,
      viewModels,
    };

    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(responseData));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const isValidationError = message.includes("Invalid request body");

    res.statusCode = isValidationError ? 400 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: isValidationError ? "PINTEREST_POD_INVALID_INPUT" : "PINTEREST_POD_HANDOVER_FAILED",
          message,
        },
      }),
    );
  }
}
