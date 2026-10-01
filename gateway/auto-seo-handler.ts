import crypto from "node:crypto";
import { getCustomGptRuntime } from "./custom-gpt-seo/runtime";
import type { CustomGptQueue } from "./custom-gpt-seo/queue";
import type http from "node:http";
import type { DatabaseSync } from "node:sqlite";

import {
  getAutoSeoDb,
  INSERT_AUTO_SEO_BACKUP_SQL,
  INSERT_AUTO_SEO_BACKUP_UPSERT_SQL,
} from "./auto-seo-db";
import { calculateSha256, canonicalizeJson } from "./canonical-json";
import {
  AutoSeoEligibilityValidationError,
  getAutoSeoEligibility,
  validateAutoSeoEligibilityRequest,
} from "./auto-seo-eligibility";
import { calculateAutoSeoInputHash } from "./auto-seo-input-hash";
import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import { runSeoContent } from "./seo-content";
import { executeSeoReviewSaveLifecycle } from "./seo-review-lifecycle";
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
  readonly onConflict?: "error" | "update";
}

export interface AutoSeoRunResult {
  readonly seoProvider?: "gemini" | "custom_gpt" | "codex_mcp";
  readonly workflowId: string;
  readonly backedUpCount: number;
  readonly backupIds: readonly string[];
  readonly downstreamStatus: "SENT" | "FAILED";
  readonly downstreamHttpStatus?: number | null;
  readonly downstreamError?: string | null;
  readonly reviewPersistedCount: number;
  readonly acceptedProductIds: readonly string[];
  readonly acceptedCount: number;
  readonly skippedProducts: readonly AutoSeoSkippedProduct[];
  readonly skippedCount: number;
  readonly seoDispatch?:
    | {
        readonly provider: "gemini";
        readonly status: "review_ready";
        readonly reviewPersistedCount: number;
      }
    | {
        readonly provider: "custom_gpt" | "codex_mcp";
        readonly status: "queued";
        readonly jobIds: readonly string[];
      };
}

export interface AutoSeoSkippedProduct {
  readonly productId: string;
  readonly reason: "UNCHANGED" | "ACTIVE_DUPLICATE";
}

export interface AutoSeoHandlerOptions {
  readonly db?: DatabaseSync;
  readonly queue?: CustomGptQueue;
  readonly seoContentRunner?: SeoContentRunner;
  readonly onConflict?: "error" | "update";
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
    onConflict:
      req.onConflict === "update" || req.onConflict === "error"
        ? req.onConflict
        : undefined,
  };
}

export function executeAutoSeoBackup(
  db: DatabaseSync,
  request: AutoSeoRunRequest,
  options?: {
    readonly onConflict?: "error" | "update";
    readonly inputHashes?: ReadonlyMap<string, string>;
  },
): { readonly backupIds: string[]; readonly productIds: string[] } {
  const backupIds: string[] = [];
  const productIds: string[] = [];

  const shouldUpsert = request.onConflict === "update" || options?.onConflict === "update";
  const insertStmt = db.prepare(
    shouldUpsert ? INSERT_AUTO_SEO_BACKUP_UPSERT_SQL : INSERT_AUTO_SEO_BACKUP_SQL,
  );

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
      options?.inputHashes?.get(product.id) ?? calculateAutoSeoInputHash(product),
    );

    backupIds.push(backupId);
    productIds.push(product.id);
  }

  return { backupIds, productIds };
}

export function updateDownstreamStatus(
  db: DatabaseSync,
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
  const selectedSettings = options?.seoContentRunner ? undefined : getCustomGptRuntime().queue.settings(request.storeId);

  let backupIds: string[] = [];
  const acceptedProducts: AutoSeoProductPayload[] = [];
  const inputHashes = new Map<string, string>();
  const skippedProducts: AutoSeoSkippedProduct[] = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const matchingRevisionStatement = db.prepare(`
      SELECT downstream_status
      FROM auto_seo_product_backups
      WHERE store_id = ? AND product_id = ? AND seo_input_sha256 = ?
      ORDER BY CASE downstream_status
        WHEN 'NOT_SENT' THEN 0
        WHEN 'SENT' THEN 1
        ELSE 2
      END, id DESC
      LIMIT 1
    `);

    for (const product of request.products) {
      const inputHash = calculateAutoSeoInputHash(product);
      const matchingRevision = matchingRevisionStatement.get(
        request.storeId,
        product.id,
        inputHash,
      ) as { downstream_status: "NOT_SENT" | "SENT" | "FAILED" } | undefined;

      if (matchingRevision?.downstream_status === "NOT_SENT") {
        skippedProducts.push({ productId: product.id, reason: "ACTIVE_DUPLICATE" });
        continue;
      }
      if (matchingRevision?.downstream_status === "SENT") {
        skippedProducts.push({ productId: product.id, reason: "UNCHANGED" });
        continue;
      }

      acceptedProducts.push(product);
      inputHashes.set(product.id, inputHash);
    }

    if (acceptedProducts.length > 0) {
      const acceptedRequest = { ...request, products: acceptedProducts };
      const backupResult = executeAutoSeoBackup(db, acceptedRequest, {
        onConflict: options?.onConflict ?? request.onConflict,
        inputHashes,
      });
      backupIds = [...backupResult.backupIds];
    }
    if (backupIds.length > 0 && selectedSettings && selectedSettings.provider !== "gemini") {
      db.prepare("UPDATE auto_seo_product_backups SET gpt_settings_json=? WHERE workflow_id=? AND store_id=?").run(JSON.stringify(selectedSettings), request.workflowId, request.storeId);
    }
    db.exec("COMMIT");
  } catch (dbError) {
    db.exec("ROLLBACK");
    throw dbError;
  }

  // Only after successful COMMIT may the system hand off the same products to SEO content runner
  let downstreamStatus: "SENT" | "FAILED" = "FAILED";
  let downstreamError: string | null = null;
  let seoProvider: "gemini" | "custom_gpt" | "codex_mcp" | undefined;
  let reviewPersistedCount = 0;
  let seoDispatch: AutoSeoRunResult["seoDispatch"];

  if (acceptedProducts.length === 0) {
    return {
      workflowId: request.workflowId,
      backedUpCount: 0,
      backupIds: [],
      downstreamStatus: "SENT",
      downstreamHttpStatus: null,
      downstreamError: null,
      reviewPersistedCount: 0,
      acceptedProductIds: [],
      acceptedCount: 0,
      skippedProducts,
      skippedCount: skippedProducts.length,
    };
  }

  const dispatchedProducts = acceptedProducts.length === request.products.length
    ? request.products
    : acceptedProducts;

  try {
    const seoResult = await runner({
      workflowId: request.workflowId,
      storeId: request.storeId,
      shopDomain: request.shopDomain,
      products: dispatchedProducts,
    }, { providerSettings: selectedSettings });

    seoProvider = seoResult.provider;
    if (seoResult && seoResult.success === true) {
      if (seoProvider === "custom_gpt" || seoProvider === "codex_mcp") {
        seoDispatch = {
          provider: seoProvider,
          status: "queued",
          jobIds: seoResult.jobIds ?? [],
        };
      }
      const isExternalQueueProvider =
        seoProvider === "custom_gpt" || seoProvider === "codex_mcp";
      if (
        !isExternalQueueProvider &&
        Array.isArray(seoResult.seoOutputs) &&
        seoResult.seoOutputs.length > 0
      ) {
        for (let i = 0; i < seoResult.seoOutputs.length; i++) {
          const output = seoResult.seoOutputs[i];
          if (!output) continue;
          const outRecord =
            typeof output === "object" && output !== null
              ? (output as Record<string, unknown>)
              : undefined;
          const outHandle =
            typeof outRecord?.productHandle === "string"
              ? outRecord.productHandle
              : typeof outRecord?.handle === "string"
                ? outRecord.handle
                : undefined;
          const outId =
            typeof outRecord?.productId === "string"
              ? outRecord.productId
              : typeof outRecord?.id === "string"
                ? outRecord.id
                : undefined;

          let matchedProduct = acceptedProducts.find(
            (p) => (outId && p.id === outId) || (outHandle && p.handle === outHandle),
          );
          if (!matchedProduct && i < acceptedProducts.length) {
            matchedProduct = acceptedProducts[i];
          }

          if (matchedProduct) {
            await executeSeoReviewSaveLifecycle(
              {
                storeId: request.storeId,
                productId: matchedProduct.id,
                handle: matchedProduct.handle,
                title: matchedProduct.title,
                shopifyUpdatedAt: matchedProduct.updatedAt ?? null,
                generatedOutput: output,
              },
              {
                db,
              },
            );
            reviewPersistedCount++;
          }
        }
      }
      if (reviewPersistedCount > 0 && (seoProvider === "gemini" || !seoProvider)) {
        seoProvider = "gemini";
        seoDispatch = {
          provider: "gemini",
          status: "review_ready",
          reviewPersistedCount,
        };
      }
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
    ...(seoProvider ? { seoProvider } : {}),
    backedUpCount: backupIds.length,
    backupIds,
    downstreamStatus,
    downstreamHttpStatus: null,
    downstreamError,
    reviewPersistedCount,
    acceptedProductIds: acceptedProducts.map(product => product.id),
    acceptedCount: acceptedProducts.length,
    skippedProducts,
    skippedCount: skippedProducts.length,
    ...(seoDispatch ? { seoDispatch } : {}),
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

export async function handleAutoSeoEligibilityHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: AutoSeoHttpRequestOptions,
): Promise<void> {
  const maxBodyBytes = options?.maxBodyBytes && options.maxBodyBytes > 0
    ? options.maxBodyBytes
    : MAX_BODY_BYTES;
  if (req.method !== "POST") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: { code: "AUTO_SEO_INVALID_INPUT", message: "Method Not Allowed" },
    }));
    return;
  }
  if (options?.authToken && !isGatewayAuthorized(req.headers, options.authToken)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: { code: "AUTO_SEO_AUTH_FAILED", message: "Unauthorized: Invalid or missing Gateway authentication token" },
    }));
    return;
  }

  try {
    const contentLength = req.headers["content-length"];
    if (contentLength && Number.parseInt(contentLength, 10) > maxBodyBytes) {
      req.destroy();
      res.statusCode = 413;
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({
        success: false,
        error: { code: "AUTO_SEO_INVALID_INPUT", message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit` },
      }));
      return;
    }
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      totalBytes += buffer.length;
      if (totalBytes > maxBodyBytes) {
        req.destroy();
        res.statusCode = 413;
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({
          success: false,
          error: { code: "AUTO_SEO_INVALID_INPUT", message: `Payload Too Large: request body exceeds ${maxBodyBytes} bytes limit` },
        }));
        return;
      }
      chunks.push(buffer);
    }
    let body: unknown;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new AutoSeoEligibilityValidationError("Invalid JSON body");
    }
    const request = validateAutoSeoEligibilityRequest(body);
    const db = options?.db ?? getAutoSeoDb();
    const queue = options?.queue ?? getCustomGptRuntime().queue;
    const result = getAutoSeoEligibility(db, request, queue);
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ success: true, data: result }));
  } catch (error: unknown) {
    const isValidation = error instanceof AutoSeoEligibilityValidationError;
    res.statusCode = isValidation ? 400 : 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      success: false,
      error: {
        code: isValidation ? error.code : "AUTO_SEO_ELIGIBILITY_FAILED",
        message: error instanceof Error ? error.message : "Failed to load Auto SEO eligibility",
      },
    }));
  }
}
