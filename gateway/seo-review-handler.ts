import type http from "node:http";
import type { DatabaseSync } from "node:sqlite";

import { getAutoSeoDb } from "./auto-seo-db";
import { isGatewayAuthorized, MAX_BODY_BYTES } from "./http-server";
import {
  getSeoReviewItem,
  listSeoReviewItems,
  updateSeoReviewPayload,
  updateSeoReviewStatus,
  type SeoReviewStatus,
} from "./seo-review-db";

export interface SeoReviewHttpRequestOptions {
  readonly db?: DatabaseSync;
  readonly authToken?: string;
  readonly maxBodyBytes?: number;
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

  const db = options?.db ?? getAutoSeoDb();
  const urlObj = new URL(req.url || "/", "http://localhost");
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
