import type { IncomingMessage, ServerResponse } from "node:http";

import { isGatewayAuthorized } from "./http-server";

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8770";

export interface ReviewImageHandlerOptions {
  readonly authToken?: string;
  readonly bridgeToken: string;
  readonly bridgeBaseUrl?: string;
  readonly maxBodyBytes?: number;
}

function sendError(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ ok: false, message }));
}

export async function handleReviewImageHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  options: ReviewImageHandlerOptions,
): Promise<void> {
  if (!isGatewayAuthorized(request.headers, options.authToken)) {
    sendError(response, 401, "Unauthorized");
    return;
  }
  if (request.method !== "GET" && request.method !== "POST") {
    sendError(response, 405, "Method Not Allowed");
    return;
  }

  const route = new URL(request.url || "/", "http://127.0.0.1");
  if (!route.pathname.startsWith("/api/review-images/")) {
    sendError(response, 404, "Not Found");
    return;
  }

  const limit = options.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  const length = Number(request.headers["content-length"] ?? 0);
  if (length > limit) {
    request.resume();
    sendError(response, 413, "Ảnh upload quá lớn.");
    return;
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > limit) {
      sendError(response, 413, "Ảnh upload quá lớn.");
      return;
    }
    chunks.push(bytes);
  }

  try {
    const base = options.bridgeBaseUrl ?? DEFAULT_BRIDGE_URL;
    const upstream = await fetch(new URL(route.pathname + route.search, base), {
      method: request.method,
      headers: {
        "X-Bridge-Token": options.bridgeToken,
        ...(request.method === "POST" ? { "Content-Type": request.headers["content-type"] || "application/json" } : {}),
      },
      body: request.method === "POST" ? Buffer.concat(chunks) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    response.statusCode = upstream.status;
    for (const header of ["content-type", "content-disposition", "cache-control"]) {
      const value = upstream.headers.get(header);
      if (value) response.setHeader(header, value);
    }
    response.setHeader("Cache-Control", "no-store");
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch {
    sendError(response, 503, "Review Image Bridge chưa chạy. Hãy khởi động lại FFP Tool.");
  }
}
