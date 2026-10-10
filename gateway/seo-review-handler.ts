import type http from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { getAutoSeoReviewRepository } from "./auto-seo-review-postgres";
import type { AutoSeoPostgresReviewRepository } from "./auto-seo-review-postgres";
import { readReviewListQuery } from "./review-list-query";
import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import {
  deleteSeoReviewItem,
  getSeoReviewItem,
  listSeoReviewItems,
  updateSeoReviewPayload,
  updateSeoReviewStatus,
  type SeoReviewStatus,
} from "./seo-review-db";

export interface SeoReviewHttpRequestOptions {
  readonly db?: DatabaseSync;
  readonly autoSeoReviewRepository?: Pick<AutoSeoPostgresReviewRepository, "listHydrated" | "findHydrated" | "updateStatus" | "updatePayload"> &
    Partial<Pick<AutoSeoPostgresReviewRepository, "delete" | "listSummaries">>;
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
}

async function handleAutoSeoReviewRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  urlObj: URL,
  maxBodyBytes: number,
  options?: SeoReviewHttpRequestOptions,
): Promise<void> {
  try {
    const repository = options?.autoSeoReviewRepository ?? getAutoSeoReviewRepository();
    const pathname = urlObj.pathname;
    if (pathname === "/api/seo-review/items") {
      if (req.method !== "GET") {
        sendJsonResponse(res, 405, { success: false, error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } });
        return;
      }
      if (urlObj.searchParams.get("view") === "summary") {
        if (!repository.listSummaries) throw new Error("Review catalog is unavailable");
        const query = readReviewListQuery(urlObj, urlObj.searchParams.get("storeId") ?? "");
        sendJsonResponse(res, 200, { success: true, ...await repository.listSummaries(query) });
        return;
      }
      const limit = Number(urlObj.searchParams.get("limit") ?? "50");
      const offset = Number(urlObj.searchParams.get("offset") ?? "0");
      if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) {
        sendJsonResponse(res, 400, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message: "Invalid pagination" } });
        return;
      }
      const result = await repository.listHydrated({ storeId: urlObj.searchParams.get("storeId") ?? undefined, status: urlObj.searchParams.get("status") ?? undefined, limit, offset });
      sendJsonResponse(res, 200, { success: true, ...result });
      return;
    }
    const rest = pathname.startsWith("/api/seo-review/items/") ? pathname.slice("/api/seo-review/items/".length) : "";
    const action = rest.endsWith("/status") ? "status" : rest.endsWith("/update") ? "update" : "read";
    const rawId = action === "read" ? rest : rest.slice(0, -(action.length + 1));
    let itemId: string;
    try { itemId = decodeURIComponent(rawId); }
    catch { itemId = ""; }
    if (!itemId || rawId.includes("/") || itemId.includes("\\") || itemId.includes("..") || itemId.length > 512) {
      sendJsonResponse(res, 400, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message: "Invalid review item ID" } });
      return;
    }
    if (action === "read") {
      if (req.method === "DELETE") {
        if (!repository.delete) {
          sendJsonResponse(res, 500, { success: false, error: { code: "SEO_REVIEW_DB_ERROR", message: "Review deletion is unavailable" } });
          return;
        }
        const deleted = await repository.delete(itemId);
        sendJsonResponse(res, deleted ? 200 : 404, deleted
          ? { success: true, itemId }
          : { success: false, error: { code: "SEO_REVIEW_ITEM_NOT_FOUND", message: "Review item not found" } });
        return;
      }
      if (req.method !== "GET") {
        sendJsonResponse(res, 405, { success: false, error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } });
        return;
      }
      const item = await repository.findHydrated(itemId);
      sendJsonResponse(res, item ? 200 : 404, item ? { success: true, item } : { success: false, error: { code: "SEO_REVIEW_ITEM_NOT_FOUND", message: "Review item not found" } });
      return;
    }
    if (req.method !== "POST") {
      sendJsonResponse(res, 405, { success: false, error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" } });
      return;
    }
    const parsed = await readJsonBody(req, maxBodyBytes);
    if (!parsed.ok) {
      sendJsonResponse(res, parsed.statusCode, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message: parsed.error } });
      return;
    }
    const body = parsed.body && typeof parsed.body === "object" && !Array.isArray(parsed.body) ? parsed.body as Record<string, unknown> : {};
    if (action === "status") {
      const status = body.status;
      if (status !== "pending" && status !== "approved" && status !== "rejected") {
        sendJsonResponse(res, 400, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message: "Invalid review status" } });
        return;
      }
      const updated = await repository.updateStatus(itemId, status, typeof body.notes === "string" ? body.notes : undefined);
      sendJsonResponse(res, updated ? 200 : 404, updated ? { success: true, itemId, status } : { success: false, error: { code: "SEO_REVIEW_ITEM_NOT_FOUND", message: "Review item not found" } });
      return;
    }
    const payload = body.payload;
    if (payload === undefined || payload === null || (typeof payload === "object" && Object.keys(payload).length === 0)) {
      sendJsonResponse(res, 400, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message: "Payload is required" } });
      return;
    }
    const updated = await repository.updatePayload(itemId, payload);
    sendJsonResponse(res, updated ? 200 : 404, updated ? { success: true, itemId } : { success: false, error: { code: "SEO_REVIEW_ITEM_NOT_FOUND", message: "Review item not found" } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    if (message === "Invalid review list query") {
      sendJsonResponse(res, 400, { success: false, error: { code: "SEO_REVIEW_INVALID_INPUT", message } });
      return;
    }
    const integrity = message.startsWith("AUTO_SEO_REVIEW_INTEGRITY");
    sendJsonResponse(res, 500, { success: false, error: { code: integrity ? "AUTO_SEO_REVIEW_INTEGRITY" : "SEO_REVIEW_DB_ERROR", message: integrity ? message : "Auto SEO review database unavailable" } });
  }
}

function sendJsonResponse(
  res: http.ServerResponse,
  statusCode: number,
  data: Record<string, unknown>,
): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes: number,
): Promise<{ ok: true; body: unknown } | { ok: false; statusCode: number; error: string }> {
  const clHeader = req.headers["content-length"];
  if (clHeader) {
    const cl = Number.parseInt(clHeader, 10);
    if (!Number.isNaN(cl) && cl > maxBytes) {
      req.destroy();
      return {
        ok: false,
        statusCode: 413,
        error: `Payload Too Large: request body exceeds ${maxBytes} bytes limit`,
      };
    }
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      req.destroy();
      return {
        ok: false,
        statusCode: 413,
        error: `Payload Too Large: request body exceeds ${maxBytes} bytes limit`,
      };
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    return { ok: true, body: {} };
  }

  try {
    const parsed = JSON.parse(raw);
    return { ok: true, body: parsed };
  } catch {
    return {
      ok: false,
      statusCode: 400,
      error: "Request body must be valid JSON",
    };
  }
}

export async function handleSeoReviewHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  options?: SeoReviewHttpRequestOptions,
): Promise<void> {
  const maxBodyBytes =
    options?.maxBodyBytes && options.maxBodyBytes > 0
      ? options.maxBodyBytes
      : MAX_BODY_BYTES;

  if (options?.authToken && !isGatewayAuthorized(req.headers, options.authToken)) {
    sendJsonResponse(res, 401, {
      success: false,
      error: {
        code: "SEO_REVIEW_AUTH_FAILED",
        message: "Unauthorized: Invalid or missing Gateway authentication token",
      },
    });
    return;
  }

  const urlObj = new URL(req.url || "/", "http://localhost");
  if (!options?.db || urlObj.searchParams.get("source") === "auto_seo") {
    await handleAutoSeoReviewRequest(req, res, urlObj, maxBodyBytes, options);
    return;
  }
  const db = options.db;
  const pathname = urlObj.pathname;

  // 1. GET /api/seo-review/items
  if (pathname === "/api/seo-review/items") {
    if (req.method !== "GET") {
      sendJsonResponse(res, 405, {
        success: false,
        error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" },
      });
      return;
    }

    const storeId = urlObj.searchParams.get("storeId") || undefined;
    const status = urlObj.searchParams.get("status") || undefined;
    const rawLimit = urlObj.searchParams.get("limit");
    const rawOffset = urlObj.searchParams.get("offset");

    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    const offset = rawOffset ? Number.parseInt(rawOffset, 10) : undefined;

    try {
      const result = listSeoReviewItems(db, {
        storeId,
        status,
        limit: Number.isNaN(limit) ? undefined : limit,
        offset: Number.isNaN(offset) ? undefined : offset,
      });

      sendJsonResponse(res, 200, {
        success: true,
        items: result.items,
        total: result.total,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, {
        success: false,
        error: { code: "SEO_REVIEW_DB_ERROR", message },
      });
    }
    return;
  }

  // Routes under /api/seo-review/items/
  if (pathname.startsWith("/api/seo-review/items/")) {
    const rest = pathname.slice("/api/seo-review/items/".length);

    // 2. POST /api/seo-review/items/:itemId/status
    if (rest.endsWith("/status")) {
      const rawItemId = rest.slice(0, -"/status".length);
      const itemId = decodeURIComponent(rawItemId);

      if (req.method !== "POST") {
        sendJsonResponse(res, 405, {
          success: false,
          error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" },
        });
        return;
      }

      const bodyResult = await readJsonBody(req, maxBodyBytes);
      if (!bodyResult.ok) {
        sendJsonResponse(res, bodyResult.statusCode, {
          success: false,
          error: { code: "SEO_REVIEW_INVALID_INPUT", message: bodyResult.error },
        });
        return;
      }

      const body = bodyResult.body as Record<string, unknown> | null;
      const status = body?.status as SeoReviewStatus | undefined;
      const notes = typeof body?.notes === "string" ? body.notes : undefined;

      if (!status || (status !== "pending" && status !== "approved" && status !== "rejected")) {
        sendJsonResponse(res, 400, {
          success: false,
          error: {
            code: "SEO_REVIEW_INVALID_INPUT",
            message: "Invalid status: must be 'pending', 'approved', or 'rejected'",
          },
        });
        return;
      }

      try {
        const updated = updateSeoReviewStatus(db, itemId, status, notes);
        if (!updated) {
          sendJsonResponse(res, 404, {
            success: false,
            error: {
              code: "SEO_REVIEW_ITEM_NOT_FOUND",
              message: `Review item not found: ${itemId}`,
            },
          });
          return;
        }

        sendJsonResponse(res, 200, {
          success: true,
          itemId,
          status,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendJsonResponse(res, 500, {
          success: false,
          error: { code: "SEO_REVIEW_DB_ERROR", message },
        });
      }
      return;
    }

    // 3. POST /api/seo-review/items/:itemId/update
    if (rest.endsWith("/update")) {
      const rawItemId = rest.slice(0, -"/update".length);
      const itemId = decodeURIComponent(rawItemId);

      if (req.method !== "POST") {
        sendJsonResponse(res, 405, {
          success: false,
          error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" },
        });
        return;
      }

      const bodyResult = await readJsonBody(req, maxBodyBytes);
      if (!bodyResult.ok) {
        sendJsonResponse(res, bodyResult.statusCode, {
          success: false,
          error: { code: "SEO_REVIEW_INVALID_INPUT", message: bodyResult.error },
        });
        return;
      }

      const body = bodyResult.body as Record<string, unknown> | null;
      const payload =
        body && typeof body === "object" && "payload" in body && body.payload !== undefined
          ? body.payload
          : body;

      if (payload === undefined || payload === null || (typeof payload === "object" && Object.keys(payload).length === 0)) {
        sendJsonResponse(res, 400, {
          success: false,
          error: {
            code: "SEO_REVIEW_INVALID_INPUT",
            message: "Payload is required and cannot be empty",
          },
        });
        return;
      }

      try {
        const updated = updateSeoReviewPayload(db, itemId, payload);
        if (!updated) {
          sendJsonResponse(res, 404, {
            success: false,
            error: {
              code: "SEO_REVIEW_ITEM_NOT_FOUND",
              message: `Review item not found: ${itemId}`,
            },
          });
          return;
        }

        sendJsonResponse(res, 200, {
          success: true,
          itemId,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendJsonResponse(res, 500, {
          success: false,
          error: { code: "SEO_REVIEW_DB_ERROR", message },
        });
      }
      return;
    }

    // 4. GET /api/seo-review/items/:itemId
    const itemId = decodeURIComponent(rest);
    if (req.method === "DELETE") {
      try {
        const deleted = deleteSeoReviewItem(db, itemId);
        if (!deleted) {
          sendJsonResponse(res, 404, {
            success: false,
            error: {
              code: "SEO_REVIEW_ITEM_NOT_FOUND",
              message: `Review item not found: ${itemId}`,
            },
          });
          return;
        }

        sendJsonResponse(res, 200, { success: true, itemId });
      } catch {
        sendJsonResponse(res, 500, {
          success: false,
          error: { code: "SEO_REVIEW_DB_ERROR", message: "Unable to delete the review item" },
        });
      }
      return;
    }

    if (req.method !== "GET") {
      sendJsonResponse(res, 405, {
        success: false,
        error: { code: "SEO_REVIEW_METHOD_NOT_ALLOWED", message: "Method Not Allowed" },
      });
      return;
    }

    try {
      const item = getSeoReviewItem(db, itemId);
      if (!item) {
        sendJsonResponse(res, 404, {
          success: false,
          error: {
            code: "SEO_REVIEW_ITEM_NOT_FOUND",
            message: `Review item not found: ${itemId}`,
          },
        });
        return;
      }

      sendJsonResponse(res, 200, {
        success: true,
        item,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      sendJsonResponse(res, 500, {
        success: false,
        error: { code: "SEO_REVIEW_DB_ERROR", message },
      });
    }
    return;
  }

  // Unknown route under /api/seo-review
  sendJsonResponse(res, 404, {
    success: false,
    error: { code: "SEO_REVIEW_NOT_FOUND", message: "Endpoint Not Found" },
  });
}
