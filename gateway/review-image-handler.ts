import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";

import { isGatewayAuthorized } from "./http-server";
import type { GatewayRequest, GatewayResponse } from "./types";

const DEFAULT_MAX_BODY_BYTES = 8 * 1024 * 1024;
const DEFAULT_BRIDGE_URL = "http://127.0.0.1:8770";

export interface ReviewImageHandlerOptions {
  readonly authToken?: string;
  readonly bridgeToken: string;
  readonly bridgeBaseUrl?: string;
  readonly maxBodyBytes?: number;
  readonly dispatcher?: { dispatch(request: GatewayRequest): Promise<GatewayResponse> };
  readonly reviewImageOutputDir?: string;
  readonly durableUploads?: boolean;
}

function sendError(response: ServerResponse, status: number, message: string): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify({ ok: false, message }));
}

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
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
  if (request.method !== "GET" && request.method !== "POST" && request.method !== "DELETE") {
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

  const requestBody = Buffer.concat(chunks);
  const shopifyUploadMatch = /^\/api\/review-images\/jobs\/([a-f0-9]{32})\/shopify$/.exec(route.pathname);
  if (request.method === "POST" && shopifyUploadMatch && !options.durableUploads) {
    if (!options.dispatcher) {
      sendError(response, 503, "Shopify gateway chưa sẵn sàng.");
      return;
    }
    let storeId = "";
    try {
      const payload = JSON.parse(requestBody.toString("utf8")) as unknown;
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        const value = (payload as Record<string, unknown>).storeId;
        if (typeof value === "string") storeId = value.trim();
      }
    } catch {
      sendError(response, 400, "Yêu cầu upload Shopify không hợp lệ.");
      return;
    }
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(storeId)) {
      sendError(response, 400, "Store ID không hợp lệ.");
      return;
    }
    try {
      const base = options.bridgeBaseUrl ?? DEFAULT_BRIDGE_URL;
      const jobResponse = await fetch(new URL(`/api/review-images/jobs/${shopifyUploadMatch[1]}`, base), {
        headers: { "X-Bridge-Token": options.bridgeToken },
        signal: AbortSignal.timeout(20_000),
      });
      const jobPayload = await jobResponse.json() as { readonly job?: Record<string, unknown>; readonly detail?: string };
      if (!jobResponse.ok) {
        sendError(response, jobResponse.status, jobPayload.detail || "Không tải được job ảnh review.");
        return;
      }
      const job = jobPayload.job;
      if (!job || job.status !== "completed" || job.approved !== true) {
        sendError(response, 409, "Ảnh phải được tạo xong và duyệt trước khi upload Shopify.");
        return;
      }
      if (job.store_id !== storeId) {
        sendError(response, 409, "Ảnh review thuộc một store khác.");
        return;
      }
      const outputName = typeof job.output_name === "string" ? job.output_name : "";
      if (!/^[a-f0-9]{32}\.(?:png|jpe?g|webp)$/.test(outputName)) {
        sendError(response, 409, "Output ảnh review không hợp lệ.");
        return;
      }
      const outputRoot = path.resolve(options.reviewImageOutputDir ?? path.join(process.cwd(), "exports", "review-images"));
      const outputPath = path.resolve(outputRoot, outputName);
      if (!isPathInside(outputRoot, outputPath)) {
        sendError(response, 403, "Đường dẫn output ảnh review không hợp lệ.");
        return;
      }
      const shopifyResponse = await options.dispatcher.dispatch({
        storeId,
        operation: "files.create",
        mode: "apply",
        requestId: `review-image:${storeId}:${shopifyUploadMatch[1]}`,
        payload: {
          originalSource: outputPath,
          filename: `review-${shopifyUploadMatch[1]}${path.extname(outputName).toLowerCase()}`,
          alt: "Customer review photo",
          contentType: "IMAGE",
        },
      });
      if (!shopifyResponse.success) {
        sendError(response, 502, shopifyResponse.error.message);
        return;
      }
      const data = shopifyResponse.data as Record<string, unknown>;
      if (typeof data.fileId !== "string" || typeof data.shopifyCdnUrl !== "string" || typeof data.fileStatus !== "string") {
        sendError(response, 502, "Shopify không trả về file hợp lệ.");
        return;
      }
      sendJson(response, 200, { ok: true, fileId: data.fileId, shopifyCdnUrl: data.shopifyCdnUrl, fileStatus: data.fileStatus });
    } catch {
      sendError(response, 502, "Không upload được ảnh lên Shopify. Kiểm tra kết nối gateway rồi thử lại.");
    }
    return;
  }

  try {
    const base = options.bridgeBaseUrl ?? DEFAULT_BRIDGE_URL;
    const upstream = await fetch(new URL(route.pathname + route.search, base), {
      method: request.method,
      headers: {
        "X-Bridge-Token": options.bridgeToken,
        ...(request.method === "POST" || request.method === "DELETE" ? { "Content-Type": request.headers["content-type"] || "application/json" } : {}),
      },
      body: request.method === "POST" || request.method === "DELETE" ? requestBody : undefined,
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
