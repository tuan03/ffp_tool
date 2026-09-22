import crypto from "node:crypto";
import type http from "node:http";
import type Database from "better-sqlite3";

import { getAutoSeoDb } from "./auto-seo-db";
import { calculateSha256, canonicalizeJson } from "./canonical-json";
import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { runSeoContent } from "./seo-content";
import type {
  AutoSeoProductPayload,
  SeoContentInput,
  SeoContentResult,
  SeoContentRunner,
} from "./seo-content";

export type {
  AutoSeoProductPayload,
  SeoContentInput,
  SeoContentResult,
  SeoContentRunner,
} from "./seo-content";

export interface AutoSeoRunRequest {
  readonly workflowId: string;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly products: readonly AutoSeoProductPayload[];
}

export interface AutoSeoRunResult {
  readonly workflowId: string;
  readonly backedUpCount: number;
  readonly backupIds: readonly string[];
  readonly downstreamStatus: "SENT" | "FAILED";
  readonly downstreamHttpStatus?: number | null;
  readonly downstreamError?: string | null;
}

export interface AutoSeoHandlerOptions {
  readonly db?: Database.Database;
  readonly seoContentRunner?: SeoContentRunner;
}

function formatIsoDateTime(dateStr?: string): string | null {
  if (!dateStr) {
    return null;
  }
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) {
    return null;
  }
  return d.toISOString();
}

export class AutoSeoValidationError extends Error {
  public constructor(
    message: string,
    public readonly code: "AUTO_SEO_INVALID_INPUT" | "AUTO_SEO_INCOMPLETE_SNAPSHOT",
  ) {
    super(message);
    this.name = "AutoSeoValidationError";
  }
}

export class AutoSeoStatusUpdateError extends Error {
  public constructor(
    message: string,
    public readonly code: "AUTO_SEO_STATUS_UPDATE_FAILED" = "AUTO_SEO_STATUS_UPDATE_FAILED",
  ) {
    super(message);
    this.name = "AutoSeoStatusUpdateError";
  }
}

export function validateAutoSeoRunInput(body: unknown): AutoSeoRunRequest {
  if (!body || typeof body !== "object") {
    throw new AutoSeoValidationError("Request body must be a JSON object", "AUTO_SEO_INVALID_INPUT");
  }

  const req = body as Partial<AutoSeoRunRequest>;

  if (typeof req.workflowId !== "string" || req.workflowId.trim() === "") {
    throw new AutoSeoValidationError("workflowId is required", "AUTO_SEO_INVALID_INPUT");
  }
  if (typeof req.storeId !== "string" || req.storeId.trim() === "") {
    throw new AutoSeoValidationError("storeId is required", "AUTO_SEO_INVALID_INPUT");
  }
  if (typeof req.shopDomain !== "string" || req.shopDomain.trim() === "") {
    throw new AutoSeoValidationError("shopDomain is required", "AUTO_SEO_INVALID_INPUT");
  }
  if (!Array.isArray(req.products) || req.products.length === 0) {
    throw new AutoSeoValidationError("products must be a non-empty array", "AUTO_SEO_INVALID_INPUT");
  }

  const seenIds = new Set<string>();
  for (const product of req.products) {
    if (!product || typeof product !== "object") {
      throw new AutoSeoValidationError("Each product must be an object", "AUTO_SEO_INVALID_INPUT");
    }
    if (typeof product.id !== "string" || product.id.trim() === "") {
      throw new AutoSeoValidationError("Each product must have a non-empty id", "AUTO_SEO_INVALID_INPUT");
    }

    const trimmedId = product.id.trim();
    if (seenIds.has(trimmedId)) {
      throw new AutoSeoValidationError(
        `Duplicate product id found in request: ${trimmedId}`,
        "AUTO_SEO_INVALID_INPUT",
      );
    }
    seenIds.add(trimmedId);

    if (product.hasMoreImages === true) {
      throw new AutoSeoValidationError(
        `Product ${trimmedId} has incomplete images (hasMoreImages=true)`,
        "AUTO_SEO_INCOMPLETE_SNAPSHOT",
      );
    }
    if (product.hasMoreVariants === true) {
      throw new AutoSeoValidationError(
        `Product ${trimmedId} has incomplete variants (hasMoreVariants=true)`,
        "AUTO_SEO_INCOMPLETE_SNAPSHOT",
      );
    }
  }

  return {
    workflowId: req.workflowId.trim(),
    storeId: req.storeId.trim(),
    shopDomain: req.shopDomain.trim(),
    products: req.products,
  };
}

export function executeAutoSeoBackup(
  db: Database.Database,
  request: AutoSeoRunRequest,
): { readonly backupIds: string[]; readonly productIds: string[] } {
  const backupIds: string[] = [];
  const productIds: string[] = [];

  const insertStmt = db.prepare(`
    INSERT INTO auto_seo_product_backups (
      backup_id,
      workflow_id,
      store_id,
      shop_domain,
      product_id,
      product_handle,
      product_title,
      shopify_updated_at,
      snapshot_json,
      snapshot_sha256,
      downstream_status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'NOT_SENT')
  `);

  for (const product of request.products) {
    const canonicalJson = canonicalizeJson(product);
    const sha256 = calculateSha256(canonicalJson);
    const backupId = crypto.randomUUID();
    const formattedUpdatedAt = formatIsoDateTime(product.updatedAt);

    insertStmt.run(
      backupId,
      request.workflowId,
      request.storeId,
      request.shopDomain,
      product.id,
      product.handle ?? "",
      product.title ?? "",
      formattedUpdatedAt,
      canonicalJson,
      sha256,
    );

    backupIds.push(backupId);
    productIds.push(product.id);
  }

  return { backupIds, productIds };
}

export function updateDownstreamStatus(
  db: Database.Database,
  workflowId: string,
  backupIds: readonly string[],
  status: "SENT" | "FAILED",
  httpStatus?: number | null,
  error?: string | null,
): void {
  if (backupIds.length === 0) {
    return;
  }

  const placeholders = backupIds.map(() => "?").join(",");
  const updateSql = `
    UPDATE auto_seo_product_backups
    SET downstream_status = ?,
        downstream_http_status = ?,
        downstream_error = ?,
        downstream_sent_at = ?
    WHERE workflow_id = ? AND backup_id IN (${placeholders})
  `;

  const truncatedError = error ? error.slice(0, 1000) : null;
  const sentAt = new Date().toISOString();
  const stmt = db.prepare(updateSql);
  stmt.run(
    status,
    httpStatus ?? null,
    truncatedError,
    sentAt,
    workflowId,
    ...backupIds,
  );
}

export async function handleAutoSeoRun(
  body: unknown,
  options?: AutoSeoHandlerOptions,
): Promise<AutoSeoRunResult> {
  const request = validateAutoSeoRunInput(body);
  const db = options?.db ?? getAutoSeoDb();
  const runner = options?.seoContentRunner ?? runSeoContent;

  // Execute backup in a single transaction
  const backupTx = db.transaction((req: AutoSeoRunRequest) => {
    return executeAutoSeoBackup(db, req);
  });

  let backupIds: string[] = [];
  try {
    const backupResult = backupTx(request);
    backupIds = [...backupResult.backupIds];
  } catch (dbError) {
    // Transaction rolled back automatically by better-sqlite3; stop here with no downstream call
    throw dbError;
  }

  // Only after successful COMMIT may the system hand off the same products to SEO content runner
  let downstreamStatus: "SENT" | "FAILED" = "FAILED";
  let downstreamError: string | null = null;

  try {
    const seoResult = await runner({
      workflowId: request.workflowId,
      storeId: request.storeId,
      shopDomain: request.shopDomain,
      products: request.products,
    });

    if (seoResult && seoResult.success === true) {
      downstreamStatus = "SENT";
    } else {
      downstreamStatus = "FAILED";
      downstreamError =
        seoResult && typeof seoResult.message === "string" && seoResult.message
          ? seoResult.message
          : "SEO content generation failed";
    }
  } catch (err: unknown) {
    downstreamStatus = "FAILED";
    if (err instanceof Error) {
      downstreamError = err.message;
    } else if (
      typeof err === "object" &&
      err !== null &&
      "message" in err &&
      typeof (err as { message: unknown }).message === "string"
    ) {
      downstreamError = (err as { message: string }).message;
    } else {
      downstreamError = String(err);
    }
  }

  // Update backup rows with downstream status (failure does not roll back committed backups)
  try {
    updateDownstreamStatus(
      db,
      request.workflowId,
      backupIds,
      downstreamStatus,
      null,
      downstreamError,
    );
  } catch (updateErr: unknown) {
    const message = updateErr instanceof Error ? updateErr.message : String(updateErr);
    throw new AutoSeoStatusUpdateError(
      `Failed to update downstream status in backups table: ${message}`,
    );
  }

  return {
    workflowId: request.workflowId,
    backedUpCount: backupIds.length,
    backupIds,
    downstreamStatus,
    downstreamHttpStatus: null,
    downstreamError,
  };
}

export interface AutoSeoHttpRequestOptions extends AutoSeoHandlerOptions {
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

export async function handleAutoSeoHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: AutoSeoHttpRequestOptions,
): Promise<void> {
  const maxBodyBytes =
    options?.maxBodyBytes && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_BODY_BYTES;

  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: { code: "AUTO_SEO_INVALID_INPUT", message: "Method Not Allowed" },
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
          code: "AUTO_SEO_AUTH_FAILED",
          message: "Unauthorized: Invalid or missing Gateway authentication token",
        },
      }),
    );
    return;
  }

  try {
    const clHeader = req.headers["content-length"];
    if (clHeader) {
      const cl = Number.parseInt(clHeader, 10);
      if (!Number.isNaN(cl) && cl > maxBodyBytes) {
        req.destroy();
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: "AUTO_SEO_INVALID_INPUT",
              message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
            },
          }),
        );
        return;
      }
    }

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += buf.length;
      if (totalBytes > maxBodyBytes) {
        req.destroy();
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(
          JSON.stringify({
            success: false,
            error: {
              code: "AUTO_SEO_INVALID_INPUT",
              message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit`,
            },
          }),
        );
        return;
      }
      chunks.push(buf);
    }

    const bodyBuffer = Buffer.concat(chunks);
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(bodyBuffer.toString("utf8"));
    } catch {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: { code: "AUTO_SEO_INVALID_INPUT", message: "Invalid JSON body" },
        }),
      );
      return;
    }

    const result = await handleAutoSeoRun(parsedBody, options);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (err: unknown) {
    if (err instanceof AutoSeoValidationError) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: { code: err.code, message: err.message },
        }),
      );
      return;
    }

    if (err instanceof AutoSeoStatusUpdateError) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          success: false,
          error: { code: err.code, message: err.message },
        }),
      );
      return;
    }

    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        success: false,
        error: {
          code: "AUTO_SEO_BACKUP_FAILED",
          message: err instanceof Error ? err.message : "Auto SEO Backup Failed",
        },
      }),
    );
  }
}
