import type { IncomingMessage, ServerResponse } from "node:http";

import { z } from "zod";

import { SeoWorkerError } from "./protocol";
import type { SeoWorkerRepository } from "./repository";
import type { SeoPublishRepository } from "./publish-repository";

function send(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" });
  res.end(JSON.stringify(value));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 8192) throw new SeoWorkerError("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

export async function handleSeoAgentHttp(req: IncomingMessage, res: ServerResponse, options: {
  readonly operator?: string;
  readonly hasStore: (storeId: string) => boolean;
  readonly repository: () => Promise<SeoWorkerRepository>;
  readonly publisher?: () => Promise<Pick<SeoPublishRepository, "status" | "enqueue" | "requestReconciliation">>;
  readonly createRevision?: (request: import("./revision-repository").RevisionRequest) => Promise<{ jobId: string; previousJobId: string }>;
  readonly history?: (storeId: string, jobId: string, offset: number) => Promise<import("../../src/modules/custom-gpt-seo").WorkerReviewHistory>;
}): Promise<void> {
  if (!options.operator) { send(res, 401, { error: { code: "OPERATOR_REQUIRED" } }); return; }
  if (req.method !== "GET" && req.method !== "POST") { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
  // Custom headers cannot be sent by HTML forms; this endpoint never enables CORS.
  if (req.method === "POST" && (req.headers["x-ffp-agent"] !== "1" ||
    req.headers["sec-fetch-site"] === "cross-site" || !req.headers["content-type"]?.startsWith("application/json"))) {
    send(res, 403, { error: { code: "CSRF_CHECK_FAILED" } }); return;
  }
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const storeId = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/).parse(url.searchParams.get("storeId"));
    if (!options.hasStore(storeId)) { send(res, 404, { error: { code: "STORE_NOT_FOUND" } }); return; }
    if (url.pathname === "/api/seo-agent/review-history" && req.method === "GET") {
      if (!options.history) { send(res, 503, { error: { code: "HISTORY_UNAVAILABLE" } }); return; }
      const jobId = z.string().min(1).max(200).parse(url.searchParams.get("jobId"));
      const offset = z.coerce.number().int().min(0).max(1_000_000).parse(url.searchParams.get("offset") ?? 0);
      send(res, 200, await options.history(storeId, jobId, offset)); return;
    }
    if (url.pathname === "/api/seo-agent/revisions") {
      if (req.method !== "POST") { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      if (!options.createRevision) { send(res, 503, { error: { code: "REVISION_DISABLED" } }); return; }
      const input = z.object({ jobId: z.string().min(1).max(200), requestId: z.string().uuid(), instructions: z.string().trim().max(4000).optional() }).strict().parse(await readBody(req));
      send(res, 201, await options.createRevision({ ...input, storeId, operator: options.operator })); return;
    }
    if (url.pathname === "/api/seo-agent/publish" || url.pathname === "/api/seo-agent/publish-reconcile") {
      if (!options.publisher) { send(res, 503, { error: { code: "PUBLISH_DISABLED" } }); return; }
      const publisher = await options.publisher();
      if (url.pathname.endsWith("publish-reconcile")) {
        if (req.method !== "POST") { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
        const input = z.object({ jobId: z.string().min(1).max(200) }).strict().parse(await readBody(req));
        send(res, 202, publicReceipt(await publisher.requestReconciliation(storeId, input.jobId, options.operator))); return;
      }
      if (req.method === "GET") {
        const jobId = z.string().min(1).max(200).parse(url.searchParams.get("jobId"));
        const status = await publisher.status(storeId, jobId);
        send(res, 200, { managed: status.managed, operation: status.operation ? publicReceipt(status.operation) : null }); return;
      }
      const input = z.object({ jobId: z.string().min(1).max(200), reviewUpdatedAt: z.number().int(), requestId: z.string().min(1).max(200) }).strict().parse(await readBody(req));
      send(res, 202, publicReceipt(await publisher.enqueue({ ...input, storeId, operator: options.operator }))); return;
    }
    const offset = z.coerce.number().int().min(0).max(1_000_000).parse(url.searchParams.get("offset") ?? 0);
    const repository = await options.repository();
    if (req.method === "GET") {
      if (url.pathname === "/api/seo-agent/tokens") { send(res, 200, await repository.listAccess(storeId, offset)); return; }
      if (url.pathname === "/api/seo-agent/runs") { send(res, 200, await repository.listRuns(storeId, offset)); return; }
    } else {
      const body = await readBody(req);
      if (url.pathname === "/api/seo-agent/tokens") {
        const input = z.object({ workerId: z.string().trim().min(1).max(100).regex(/^[\p{L}\p{N} ._-]+$/u) }).strict().parse(body);
        send(res, 201, await repository.issueToken({ storeId, workerId: input.workerId, createdBy: options.operator })); return;
      }
      if (url.pathname === "/api/seo-agent/revoke") {
        const input = z.object({ tokenId: z.string().uuid() }).strict().parse(body);
        await repository.revoke(storeId, input.tokenId); send(res, 200, { revoked: true }); return;
      }
    }
    send(res, 404, { error: { code: "NOT_FOUND" } });
  } catch (error) {
    const code = error instanceof z.ZodError || error instanceof SyntaxError ? "INVALID_REQUEST" : error instanceof SeoWorkerError ? error.code : "SEO_AGENT_UNAVAILABLE";
    send(res, code === "SEO_AGENT_UNAVAILABLE" ? 503 : code === "REQUEST_TOO_LARGE" ? 413 : 400, { error: { code } });
  }
}

function publicReceipt(operation: Awaited<ReturnType<SeoPublishRepository["get"]>>) {
  return { id: operation.id, jobId: operation.jobId, state: operation.state, errorCode: operation.errorCode, seoVersion: operation.seoVersion };
}
