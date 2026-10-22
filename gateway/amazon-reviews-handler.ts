import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { isGatewayAuthorized } from "./http-server";
import { getReviewTextRuntime } from "./review-text-runtime";
import type { ReviewTextJobs } from "./review-text-jobs";
import type { ReviewTextJob } from "./review-text-repository";

const requestSchema = z.object({ contextJobId: z.string().min(1).max(128), storeId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/), count: z.number().int().min(1).max(50), requestId: z.string().min(1).max(128) });
function publicJob(job: ReviewTextJob | null): unknown {
  if (!job) return null;
  const { input: _input, result, ...snapshot } = job;
  return { ...snapshot, accepted: result?.samples.length ?? 0, rejected: result?.rejected ?? 0, warnings: result?.warnings ?? [] };
}
function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store"); res.end(JSON.stringify(value));
}
export async function handleAmazonReviewsHttpRequest(req: IncomingMessage, res: ServerResponse,
  options: { readonly authToken?: string; readonly maxBodyBytes: number; readonly jobs?: ReviewTextJobs }): Promise<void> {
  if (options.authToken && !isGatewayAuthorized(req.headers, options.authToken)) { sendJson(res, 401, { error: "Unauthorized" }); return; }
  const route = new URL(req.url || "/", "http://localhost");
  const match = /^\/api\/amazon-reviews\/samples\/([a-zA-Z0-9-]+)(?:\/(cancel|retry-save))?$/.exec(route.pathname);
  if (!match && route.pathname !== "/api/amazon-reviews/samples") { sendJson(res, 404, { error: "Not Found" }); return; }
  try {
    const jobs = options.jobs ?? await getReviewTextRuntime();
    if (req.method === "GET") {
      const job = match ? await jobs.get(match[1] ?? "") : await jobs.latest(route.searchParams.get("contextJobId") ?? "", route.searchParams.get("storeId") ?? "");
      sendJson(res, match && !job ? 404 : 200, { job: publicJob(job) }); return;
    }
    if (req.method !== "POST") { sendJson(res, 405, { error: "Method Not Allowed" }); return; }
    if (match) {
      if (match[2] !== "cancel" && match[2] !== "retry-save") { sendJson(res, 404, { error: "Not Found" }); return; }
      const job = match[2] === "cancel" ? await jobs.cancel(match[1] ?? "") : await jobs.retrySave(match[1] ?? "");
      sendJson(res, 202, { job: publicJob(job) }); return;
    }
    const chunks: Buffer[] = []; let length = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk); length += buffer.length;
      if (length > options.maxBodyBytes) { sendJson(res, 413, { error: "Request too large" }); return; }
      chunks.push(buffer);
    }
    let raw: unknown;
    try { raw = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { sendJson(res, 422, { error: "REVIEW_INVALID_REQUEST" }); return; }
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) { sendJson(res, 422, { error: "REVIEW_INVALID_REQUEST", message: "Hãy reload giao diện để dùng luồng ChatGPT Bridge mới." }); return; }
    sendJson(res, 202, { job: publicJob(await jobs.create(parsed.data)) });
  } catch (error) {
    const code = error instanceof Error && /^REVIEW_[A-Z_]+$/.test(error.message) ? error.message : "REVIEW_SERVICE_UNAVAILABLE";
    sendJson(res, code.includes("CONFLICT") || code.includes("PROGRESS") || code.includes("RETRYABLE") ? 409 : 503, { error: code });
  }
}
