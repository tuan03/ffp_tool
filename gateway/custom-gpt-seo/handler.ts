import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

import { validateExternalSeoAnalysis, researchExternalSeo, checkExternalSeoKeywords, bindExternalSeoProduct } from "../../src/modules/seo-content";
import type { GptSeoEnqueue, GptSeoInput } from "../../src/modules/custom-gpt-seo";
import type { CustomGptQueue } from "./queue";
import { signImage, verifyImageSignature, downloadProductImage } from "./images";

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
  let windowStart = 0; let requestCount = 0;
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
    const actionStoreId = isAdmin ? undefined : resolveActionStoreId(bearer);
    if (!signedImage && !(isAdmin ? authorized(gatewayKey || bearer, options.adminKey) : actionStoreId)) { send(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid credentials" } }); return; }
    if (!isAdmin) {
      if (Date.now() - windowStart > 60_000) { windowStart = Date.now(); requestCount = 0; }
      if (++requestCount > 120) { res.setHeader("Retry-After", "60"); send(res, 429, { error: { code: "RATE_LIMITED", message: "Retry after 60 seconds" } }); return; }
    }
    try {
      if (!["GET", "POST"].includes(req.method || "")) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      const body = req.method === "POST" ? await readBody(req, isAdmin ? 8_000_000 : 90_000) : {};
      const authenticatedStoreId = signedImage ? signedImageStoreId : actionStoreId;
      const storeId = String(body.storeId || url.searchParams.get("storeId") || authenticatedStoreId || options.storeId);
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(storeId) || (!isAdmin && storeId !== authenticatedStoreId)) { send(res, 403, { error: { code: "STORE_FORBIDDEN" } }); return; }
      const jobId = String(body.jobId || url.searchParams.get("jobId") || "");
      const batchId = String(body.batchId || url.searchParams.get("batchId") || "");
      const leaseToken = String(body.leaseToken || "");
      const requestId = String(body.requestId || "");
      const offset = Math.max(0, Math.trunc(Number(url.searchParams.get("offset")) || 0));
      const readRoutes = ["capabilities", "context", "queue", "batch", "job", "images", "image-content", "media", "result", "admin/settings", "admin/jobs", "admin/job", "admin/image", "admin/review-state", "admin/sync-state"];
      if (req.method === "GET" && !readRoutes.includes(route)) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      if (req.method === "POST" && readRoutes.includes(route) && !["admin/settings", "admin/review-state"].includes(route)) { send(res, 405, { error: { code: "METHOD_NOT_ALLOWED" } }); return; }
      if (["analysis", "research", "keywords", "submit"].includes(route)) {
        required(requestId, "requestId");
        queue.assertLease(storeId, batchId, leaseToken, jobId);
        const replay = queue.replayMutation(jobId, requestId, { route, body });
        if (replay) {
          send(res, 200, { jobId, replayed: true, saved: true, checkpoint: replay.payload, status: queue.get(storeId, jobId).status });
          return;
        }
      }
      let result: unknown;
      switch (route) {
        case "capabilities": result = { version: 1, batchSize: queue.settings(storeId).batchSize, maxBatchSize: 10, leaseMinutes: 30, imageMode: "public_url_or_manual_attachment", stages: ["analysis", "research", "keywords", "submission"], nextAction: "getSeoQueueStatus" }; break;
        case "context": result = { storeId, ...queue.settings(storeId), nextAction: "claimSeoBatch" }; break;
        case "queue": result = { counts: queue.counts(storeId), activeBatch: queue.activeBatch(storeId), nextAction: queue.activeBatch(storeId) ? "getSeoBatch" : "claimSeoBatch" }; break;
        case "claim": result = queue.claim(storeId, required(requestId, "requestId")); break;
        case "batch": result = queue.batch(storeId, batchId); break;
        case "renew": result = queue.renew(storeId, batchId, leaseToken); break;
        case "release": queue.release(storeId, batchId, leaseToken); result = { released: true }; break;
        case "job": {
          const job = queue.get(storeId, jobId);
          result = { ...job, original: undefined, input: { ...job.input, images: undefined }, imageCount: job.input.images.length, nextAction: "getSeoJobImages" }; break;
        }
        case "images": {
          const job = queue.get(storeId, jobId);
          result = { jobId, images: job.input.images.slice(offset, offset + 5).map((image, index) => {
            const id = image.id || `image-${offset + index + 1}`;
            const actionKey = actionKeys[storeId];
            if (!options.publicUrl || !actionKey) return { ...image, id };
            const expires = Date.now() + 10 * 60_000;
            const media = new URL("/api/v1/gpt-seo/media", options.publicUrl);
            media.search = new URLSearchParams({ storeId, jobId, imageId: id, expires: String(expires), signature: signImage(actionKey, jobId, id, expires) }).toString();
            return { id, url: media.href, alt: image.alt };
          }), nextOffset: offset + 5 < job.input.images.length ? offset + 5 : null, instructions: "Call getSeoJobImageContent with jobId and each imageId. Use the returned imageUrl, never imageId, as the public image URL. If the image cannot be viewed, ask the operator to attach it. Do not infer evidence from URLs or filenames." }; break;
        }
        case "image-content": {
          const job = queue.get(storeId, jobId);
          const imageId = url.searchParams.get("imageId");
          const image = job.input.images.find((entry, index) => (entry.id || `image-${index + 1}`) === imageId);
          if (!image) throw new Error("Image not found");
          const imageUrl = new URL(image.url);
          if (imageUrl.protocol !== "https:") throw new Error("Image URL is not public HTTPS");
          result = {
            imageId,
            imageUrl: imageUrl.href,
            instructions: "Use imageUrl as the public image URL. Do not use imageId as a URL.",
          };
          break;
        }
        case "media":
        case "admin/image": {
          if (route === "media" && !signedImage) { send(res, 401, { error: { code: "INVALID_IMAGE_SIGNATURE" } }); return; }
          if (isDownloadingImage) { res.setHeader("Retry-After", "2"); send(res, 429, { error: { code: "IMAGE_BUSY" } }); return; }
          const job = queue.get(storeId, jobId);
          const imageId = url.searchParams.get("imageId");
          const image = job.input.images.find((entry, index) => (entry.id || `image-${index + 1}`) === imageId);
          if (!image) throw new Error("Image not found");
          isDownloadingImage = true;
          try {
            const downloaded = await downloadProductImage(image.url);
            res.setHeader("Content-Type", downloaded.contentType);
            res.setHeader("Content-Disposition", `${isAdmin ? "attachment" : "inline"}; filename="${job.id}-${String(imageId).replace(/[^a-zA-Z0-9_-]/g, "_")}.${downloaded.extension}"`);
            res.setHeader("Cache-Control", "private, no-store");
            res.setHeader("X-Content-Type-Options", "nosniff");
            res.end(downloaded.bytes); return;
          } finally { isDownloadingImage = false; }
        }
        case "analysis": {
          const job = queue.get(storeId, jobId);
          validateExternalSeoAnalysis({ ...job.input, storeId }, body.payload);
          result = queue.checkpoint(storeId, jobId, { batchId, leaseToken, requestId, stage: "analysis", payload: body.payload, requestPayload: { route, body } }); break;
        }
        case "research": {
          queue.assertLease(storeId, batchId, leaseToken, jobId);
          if (!queue.get(storeId, jobId).checkpoints.analysis) throw new Error("Save analysis first");
          if (!Array.isArray(body.seeds) || body.seeds.some(seed => typeof seed !== "string")) throw new Error("Invalid seeds");
          const suggestions = await (options.research ?? researchExternalSeo)(body.seeds as string[], queue.get(storeId, jobId).settings.language);
          queue.checkpoint(storeId, jobId, { batchId, leaseToken, requestId, stage: "research", payload: { suggestions, source: "google_suggest" }, requestPayload: { route, body } });
          result = { suggestions, nextAction: "checkSeoKeywords" }; break;
        }
        case "check-keywords": {
          queue.assertLease(storeId, batchId, leaseToken, jobId);
          const job = queue.get(storeId, jobId);
          if (!job.checkpoints.research) throw new Error("Complete research first");
          if (!Array.isArray(body.keywords) || body.keywords.some(keyword => typeof keyword !== "string")) throw new Error("Invalid keywords");
          result = await (options.checkKeywords ?? checkExternalSeoKeywords)({ ...job.input, storeId }, body.keywords as string[]); break;
        }
        case "keywords": {
          const job = queue.get(storeId, jobId);
          if (!job.checkpoints.research) throw new Error("Complete research first");
          const payload = asObject(body.payload);
          if (!Array.isArray(payload.keywords) || payload.keywords.some(keyword => typeof keyword !== "string")) throw new Error("Invalid keywords");
          required(payload.reason, "reason");
          const check = await (options.checkKeywords ?? checkExternalSeoKeywords)({ ...job.input, storeId }, payload.keywords as string[]);
          if (check.conflicts.some(conflict => conflict.matches.length)) throw new Error("Keyword conflict");
          result = queue.checkpoint(storeId, jobId, { batchId, leaseToken, requestId, stage: "keywords", payload: { ...payload, check }, requestPayload: { route, body } }); break;
        }
        case "submit": {
          const job = queue.get(storeId, jobId);
          if (!job.checkpoints.analysis || !job.checkpoints.research || !job.checkpoints.keywords) throw new Error("Complete analysis, research and keywords first");
          queue.checkpoint(storeId, jobId, { batchId, leaseToken, requestId, stage: "submission", payload: body.payload, requestPayload: { route, body } });
          result = { jobId, status: "VALIDATING", nextAction: "getSeoJobResult" }; break;
        }
        case "result": { const job = queue.get(storeId, jobId); result = { jobId, status: job.status, result: job.result, error: job.error }; break; }
        case "issue": queue.issue(storeId, jobId, batchId, leaseToken, required(body.message, "message")); result = { status: "WAITING_INPUT" }; break;
        case "admin/settings": {
          if (req.method === "POST") {
            if (body.provider !== "gemini" && body.provider !== "custom_gpt") throw new Error("Invalid provider");
            result = queue.configure(storeId, { provider: body.provider, batchSize: Number(body.batchSize), ...(typeof body.language === "string" ? { language: body.language } : {}), ...(typeof body.instructions === "string" ? { instructions: body.instructions.slice(0, 4000) } : {}) });
          } else result = queue.settings(storeId);
          break;
        }
        case "admin/jobs": result = { jobs: queue.list(storeId, url.searchParams.get("status") === "REVIEW_READY" ? "REVIEW_READY" : undefined, offset).map(job => ({ ...job, original: null, checkpoints: {}, result: undefined, settings: { ...job.settings, instructions: "" }, input: { title: job.input.title.slice(0, 300), description: "", handle: job.input.handle, niche: "", productId: job.input.productId, images: [] } })), counts: queue.counts(storeId), activeBatch: queue.activeBatch(storeId), nextOffset: offset + 50 }; break;
        case "admin/job": result = queue.get(storeId, jobId); break;
        case "admin/enqueue": {
          if (queue.settings(storeId).provider !== "custom_gpt") throw new Error("Provider changed; retry the handoff using the current provider");
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
          if (body.provider !== "gemini" && body.provider !== "custom_gpt") throw new Error("Invalid provider");
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
