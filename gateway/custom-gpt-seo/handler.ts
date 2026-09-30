import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { researchExternalSeo, checkExternalSeoKeywords, bindExternalSeoProduct } from "../../src/modules/seo-content";
import type { GptSeoEnqueue, GptSeoInput } from "../../src/modules/custom-gpt-seo";
import type { CustomGptQueue } from "./queue";
import { verifyImageSignature, downloadProductImage } from "./images";
import { createExternalSeoWorkflow } from "./workflow";

export interface CustomGptHandlerOptions {
  readonly queue: CustomGptQueue;
  readonly actionKey?: string;
  readonly actionKeys?: Readonly<Record<string, string>>;
  readonly adminKey?: string;
  readonly storeId: string;
  readonly research?: typeof researchExternalSeo;
  readonly checkKeywords?: typeof checkExternalSeoKeywords;
  readonly publicUrl?: string;
}
function authorized(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const left = Buffer.from(actual); const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}
export function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected object");
  return value as Record<string, unknown>;
}
function required(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) throw new Error(`Invalid ${name}`);
  return value;
}
export function parseGptInput(raw: unknown): GptSeoInput {
  const input = asObject(raw);
  if (!Array.isArray(input.images) || input.images.length > 100) throw new Error("Invalid images");
  return {
    title: required(input.title, "title"), description: typeof input.description === "string" ? input.description.slice(0, 30000) : "",
    handle: typeof input.handle === "string" ? input.handle : "", niche: required(input.niche, "niche"),
    productId: typeof input.productId === "string" ? input.productId.replace(/^gid:\/\/shopify\/Product\//, "") : undefined,
    siteDomain: typeof input.siteDomain === "string" ? input.siteDomain : undefined,
    url: typeof input.url === "string" ? input.url : undefined,
    images: input.images.map((rawImage, index) => {
      const image = asObject(rawImage); const url = new URL(required(image.url, "image url"));
      if (!["https:", "http:"].includes(url.protocol)) throw new Error("Invalid image protocol");
      return { id: typeof image.id === "string" ? image.id : `image-${index + 1}`, url: url.href, alt: typeof image.alt === "string" ? image.alt : undefined };
    }),
  };
}
async function readBody(req: IncomingMessage, maxBytes: number): Promise<Record<string, unknown>> {
  let size = 0; const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Payload too large");
    chunks.push(buffer);
  }
  return chunks.length ? asObject(JSON.parse(Buffer.concat(chunks).toString("utf8"))) : {};
}
function send(res: ServerResponse, status: number, payload: unknown, maxLength = 80_000): void {
  const body = JSON.stringify(payload);
  res.statusCode = body.length > maxLength ? 413 : status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(body.length > maxLength ? JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "Use pagination or a smaller source snapshot" } }) : body);
}

export function createCustomGptHandler(options: CustomGptHandlerOptions) {
  const { queue } = options;
  const workflow = createExternalSeoWorkflow({
    queue,
    research: options.research,
    checkKeywords: options.checkKeywords,
  });
  const actionKeys: Readonly<Record<string, string>> = {
    ...(options.actionKey ? { [options.storeId]: options.actionKey } : {}),
    ...options.actionKeys,
  };
  const actionKeyEntries = Object.entries(actionKeys);
  if (new Set(actionKeyEntries.map(([, actionKey]) => actionKey)).size !== actionKeyEntries.length) throw new Error("Custom GPT action keys must be unique per store");
  if (options.adminKey && actionKeyEntries.some(([, actionKey]) => actionKey === options.adminKey)) throw new Error("Custom GPT Action keys must differ from the administration key");
  const resolveActionStoreId = (bearer: string | undefined): string | undefined => {
    let matchedStoreId: string | undefined;
    for (const [storeId, actionKey] of actionKeyEntries) if (authorized(bearer, actionKey)) matchedStoreId = storeId;
    return matchedStoreId;
  };
  let actionWindowStart = 0; let actionRequestCount = 0;
  let publicImageWindowStart = 0; let publicImageRequestCount = 0;
  let isDownloadingImage = false;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = new URL(req.url || "/", "http://localhost");
    const route = url.pathname.replace(/^\/api\/v1\/gpt-seo\//, "");
    const isAdmin = route.startsWith("admin/");
    const bearer = req.headers.authorization?.replace(/^Bearer /, "");
    const gatewayKey = typeof req.headers["x-gateway-key"] === "string" ? req.headers["x-gateway-key"] : undefined;
    const signedImageStoreId = url.searchParams.get("storeId") || "";
    const signedImageKey = actionKeys[signedImageStoreId];
    const signedImage = Boolean(route === "media" && req.method === "GET" && signedImageKey && verifyImageSignature(signedImageKey, url.searchParams.get("jobId") || "", url.searchParams.get("imageId") || "", Number(url.searchParams.get("expires")), url.searchParams.get("signature") || ""));
    const publicImage = route === "public-image" && req.method === "GET";
    const actionStoreId = isAdmin ? undefined : resolveActionStoreId(bearer);
    if (!signedImage && !publicImage && !(isAdmin ? authorized(gatewayKey || bearer, options.adminKey) : actionStoreId)) { send(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } }); return; }
    if (!isAdmin) {
      const now = Date.now();
      if (publicImage) {
        if (now - publicImageWindowStart > 60_000) { publicImageWindowStart = now; publicImageRequestCount = 0; }
        publicImageRequestCount += 1;
      } else {
        if (now - actionWindowStart > 60_000) { actionWindowStart = now; actionRequestCount = 0; }
        actionRequestCount += 1;
      }
      if ((publicImage ? publicImageRequestCount : actionRequestCount) > 120) { res.setHeader("Retry-After", "60"); send(res, 429, { error: { code: "RATE_LIMITED", message: "Retry after 60 seconds" } }); return; }
    }
    try {
      if (!["GET", "POST"].includes(req.method || "")) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      const body = req.method === "POST" ? await readBody(req, isAdmin ? 8_000_000 : 90_000) : {};
      const authenticatedStoreId = signedImage || publicImage ? signedImageStoreId : actionStoreId;
      const storeId = String(body.storeId || url.searchParams.get("storeId") || authenticatedStoreId || options.storeId);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(storeId) || (!isAdmin && storeId !== authenticatedStoreId)) { send(res, 403, { error: { code: "STORE_FORBIDDEN" } }); return; }
      const jobId = String(body.jobId || url.searchParams.get("jobId") || "");
      const batchId = String(body.batchId || url.searchParams.get("batchId") || "");
      const leaseToken = String(body.leaseToken || "");
      const requestId = String(body.requestId || "");
      const offset = Math.max(0, Math.trunc(Number(url.searchParams.get("offset")) || 0));
      const readRoutes = ["capabilities", "context", "queue", "waiting-jobs", "batch", "job", "images", "public-image", "media", "result", "admin/settings", "admin/jobs", "admin/job", "admin/image", "admin/review-state", "admin/sync-state"];
      if (req.method === "GET" && !readRoutes.includes(route)) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      if (req.method === "POST" && readRoutes.includes(route) && !["admin/settings", "admin/review-state"].includes(route)) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      let result: unknown;
      switch (route) {
        case "capabilities": result = { version: 1, batchSize: queue.settings(storeId).batchSize, maxBatchSize: 10, leaseMinutes: 30, imageMode: "public_url_or_manual_attachment", stages: ["analysis", "research", "keywords", "submission"], nextAction: "getSeoQueueStatus" }; break;
        case "context": result = { storeId, ...queue.settings(storeId), nextAction: "claimSeoBatch" }; break;
        case "queue": {
          const work = workflow.getWork(storeId, "custom_gpt", "custom_gpt");
          const { counts, activeBatch } = work;
          const nextAction = activeBatch
            ? "getSeoBatch"
            : work.blockedBy
              ? "getSeoQueueStatus"
            : Number(counts.PENDING || 0) > 0
              ? "claimSeoBatch"
              : Number(counts.WAITING_INPUT || 0) > 0
                ? "listSeoWaitingJobs"
                : "claimSeoBatch";
          result = { counts, activeBatch, blockedBy: work.blockedBy, nextAction };
          break;
        }
        case "waiting-jobs": {
          const waiting = workflow.listWaiting(storeId, "custom_gpt", offset);
          result = {
            ...waiting,
            instructions: "Use jobId with getSeoJob and getSeoJobImages. This read-only action does not claim jobs or change their status.",
          };
          break;
        }
        case "claim": result = workflow.claim(storeId, "custom_gpt", "custom_gpt", required(requestId, "requestId")); break;
        case "batch": result = workflow.getBatch(storeId, "custom_gpt", batchId); break;
        case "renew": result = workflow.renew(storeId, "custom_gpt", { batchId, leaseToken }); break;
        case "release": result = workflow.release(storeId, "custom_gpt", { batchId, leaseToken }); break;
        case "job": {
          const job = workflow.getJob(storeId, "custom_gpt", jobId);
          result = { ...job, imageCount: job.imageIds.length, nextAction: "getSeoJobImages" }; break;
        }
        case "images": {
          result = { ...workflow.listImageReferences(storeId, "custom_gpt", jobId, offset), instructions: "Open each image url directly; never use imageId as a URL. If an image cannot be viewed, ask the operator to attach it. Do not infer evidence from URLs or filenames." }; break;
        }
        case "public-image":
        case "media":
        case "admin/image": {
          if (route === "media" && !signedImage) { send(res, 401, { error: { code: "INVALID_IMAGE_SIGNATURE" } }); return; }
          if (isDownloadingImage) { res.setHeader("Retry-After", "2"); send(res, 429, { error: { code: "IMAGE_BUSY" } }); return; }
          const job = queue.get(storeId, jobId);
          if (!isAdmin && job.settings.provider !== "custom_gpt") throw new Error("Image not found");
          const imageId = url.searchParams.get("imageId");
          const image = job.input.images.find((entry, index) => (entry.id || `image-${index + 1}`) === imageId);
          if (!image) throw new Error("Image not found");
          isDownloadingImage = true;
          try {
            const downloaded = await downloadProductImage(image.url);
            res.setHeader("Content-Type", downloaded.contentType);
            res.setHeader("Content-Disposition", `${isAdmin ? "attachment" : "inline"}; filename="${job.id}-${String(imageId).replace(/[^a-zA-Z0-9_-]/g, "_")}.${downloaded.extension}"`);
            res.setHeader("Cache-Control", route === "public-image" ? "public, max-age=300" : "private, no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(downloaded.bytes); return;
          } finally { isDownloadingImage = false; }
        }
        case "analysis": {
          const job = workflow.saveAnalysis(storeId, "custom_gpt", { jobId, batchId, leaseToken, requestId: required(requestId, "requestId"), analysis: body.payload });
          result = { jobId, saved: true, status: job.status, checkpoint: job.checkpoints.analysis }; break;
        }
        case "research": {
          if (!Array.isArray(body.seeds) || body.seeds.some(seed => typeof seed !== "string")) throw new Error("Invalid seeds");
          const research = await workflow.research(storeId, "custom_gpt", { jobId, batchId, leaseToken, requestId: required(requestId, "requestId"), seeds: body.seeds as string[] });
          result = { ...(research as Record<string, unknown>), nextAction: "checkSeoKeywords" }; break;
        }
        case "check-keywords": {
          if (!Array.isArray(body.keywords) || body.keywords.some(keyword => typeof keyword !== "string")) throw new Error("Invalid keywords");
          result = await workflow.checkKeywordConflicts(storeId, "custom_gpt", { jobId, batchId, leaseToken, keywords: body.keywords as string[] }); break;
        }
        case "keywords": {
          const payload = asObject(body.payload);
          if (!Array.isArray(payload.keywords) || payload.keywords.some(keyword => typeof keyword !== "string")) throw new Error("Invalid keywords");
          const keywordResult = await workflow.chooseKeywords(storeId, "custom_gpt", { jobId, batchId, leaseToken, requestId: required(requestId, "requestId"), keywords: payload.keywords as string[], reason: required(payload.reason, "reason") });
          if (!keywordResult || typeof keywordResult !== "object" || !("saved" in keywordResult) || !keywordResult.saved) throw new Error("Keyword conflict");
          result = keywordResult; break;
        }
        case "submit": {
          result = { ...workflow.submit(storeId, "custom_gpt", { jobId, batchId, leaseToken, requestId: required(requestId, "requestId"), submission: body.payload }), nextAction: "getSeoJobResult" }; break;
        }
        case "result": result = workflow.getResult(storeId, "custom_gpt", jobId); break;
        case "issue": result = workflow.reportIssue(storeId, "custom_gpt", { jobId, batchId, leaseToken, message: required(body.message, "message") }); break;
        case "admin/settings": {
          if (req.method === "POST") {
            if (body.provider !== "gemini" && body.provider !== "custom_gpt" && body.provider !== "codex_mcp") throw new Error("Invalid provider");
            result = queue.configure(storeId, { provider: body.provider, batchSize: Number(body.batchSize), ...(typeof body.language === "string" ? { language: body.language } : {}), ...(typeof body.instructions === "string" ? { instructions: body.instructions.slice(0, 4000) } : {}) });
          } else result = queue.settings(storeId);
          break;
        }
        case "admin/jobs": result = { jobs: queue.list(storeId, url.searchParams.get("status") === "REVIEW_READY" ? "REVIEW_READY" : undefined, offset).map(job => ({ ...job, original: null, checkpoints: {}, result: undefined, settings: { ...job.settings, instructions: "" }, input: { title: job.input.title.slice(0, 300), description: "", handle: job.input.handle, niche: "", productId: job.input.productId, images: [] } })), counts: queue.counts(storeId), activeBatch: queue.activeBatches(storeId)[0] ?? null, nextOffset: offset + 50 }; break;
        case "admin/job": result = queue.get(storeId, jobId); break;
        case "admin/enqueue": {
          const provider = queue.settings(storeId).provider;
          if (provider !== "custom_gpt" && provider !== "codex_mcp") throw new Error("Provider changed; retry the handoff using the current provider");
          const source = body.source;
          if (source !== "amazon" && source !== "auto_seo") throw new Error("Invalid source");
          const input: GptSeoEnqueue = { storeId, source, sourceIdentity: required(body.sourceIdentity, "sourceIdentity"), sourceRevision: typeof body.sourceRevision === "string" ? body.sourceRevision : undefined, input: parseGptInput(body.input), original: body.original };
          result = queue.enqueue(input); break;
        }
        case "admin/retry": queue.retry(storeId, jobId); result = { status: "PENDING" }; break;
        case "admin/bind-product": {
          await bindExternalSeoProduct({ storeId, sourceIdentity: required(body.sourceIdentity, "sourceIdentity"), productId: required(body.productId, "productId") });
          result = { bound: true }; break;
        }
        case "admin/transfer": {
          if (body.provider !== "gemini" && body.provider !== "custom_gpt" && body.provider !== "codex_mcp") throw new Error("Invalid provider");
          queue.transfer(storeId, jobId, body.provider); result = { transferred: true }; break;
        }
        case "admin/begin-sync": result = { token: queue.beginSync(storeId, jobId) }; break;
        case "admin/sync-state": result = queue.syncState(storeId, jobId); break;
        case "admin/reconcile-sync": {
          if (body.outcome !== "SYNCED" && body.outcome !== "NOT_WRITTEN") throw new Error("Invalid reconciliation outcome");
          queue.reconcileSync(storeId, jobId, { token: required(body.token, "token"), outcome: body.outcome, note: required(body.note, "note") });
          result = { reconciled: true }; break;
        }
        case "admin/finish-sync": {
          if (body.status !== "SYNCED" && body.status !== "UNKNOWN" && body.status !== "NOT_STARTED") throw new Error("Invalid sync status");
          queue.finishSync(storeId, jobId, required(body.token, "token"), body.status);
          result = { saved: true }; break;
        }
        case "admin/release": { const batch = queue.batch(storeId, batchId); queue.release(storeId, batch.id, batch.leaseToken); result = { released: true }; break; }
        case "admin/review-state": {
          if (req.method === "POST") queue.saveReviewState(storeId, jobId, asObject(body.state));
          result = queue.reviewState(storeId, jobId); break;
        }
        default: send(res, 404, { error: { code: "NOT_FOUND" } }); return;
      }
      // Large source snapshots are never echoed by mutation Actions.
      if (["analysis", "keywords"].includes(route)) result = { jobId, saved: true, nextAction: route === "analysis" ? "getSearchSuggestions" : "submitSeoResult" };
      send(res, route === "submit" ? 202 : 200, result, isAdmin ? 8_000_000 : 80_000);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Request failed";
      const status = /not found/i.test(message) ? 404 : /lease|conflict|active batch|Idempotency/i.test(message) ? 409 : /too large/i.test(message) ? 413 : 400;
      send(res, status, { error: { code: status === 409 ? "GPT_SEO_CONFLICT" : "GPT_SEO_INVALID_REQUEST", message }, nextAction: status === 409 ? "getSeoQueueStatus" : "Correct the request or reportSeoJobIssue" });
    }
  };
}
