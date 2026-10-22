import { z } from "zod";

import { getAutoSeoDatabaseUrl } from "./auto-seo-database-url";
import { loadLocalEnv } from "./store-config-loader";
import { ReviewTextJobs } from "./review-text-jobs";
import { PostgresReviewTextRepository } from "./review-text-repository";
import { createBridgeReviewGenerator } from "./review-text-provider";

const contextSchema = z.object({ asin: z.string().regex(/^[A-Z0-9]{10}$/), reviewData: z.object({ context: z.object({
  title: z.string().optional(), description: z.string().optional(), bullets: z.array(z.string()).optional(), details: z.record(z.string(), z.string()).optional(),
}) }), samples: z.array(z.object({ reviewId: z.string(), author: z.string(), body: z.string() })) });
let runtime: Promise<ReviewTextJobs> | undefined;
export function getReviewTextRuntime(): Promise<ReviewTextJobs> {
  if (!runtime) runtime = createRuntime().catch(error => { runtime = undefined; throw error; });
  return runtime;
}
async function createRuntime(): Promise<ReviewTextJobs> {
  const env = loadLocalEnv();
  const databaseUrl = getAutoSeoDatabaseUrl(env);
  if (!databaseUrl) throw new Error("REVIEW_DATABASE_REQUIRED");
  const baseUrl = env.REVIEW_IMAGE_BRIDGE_URL || "http://127.0.0.1:8766";
  const token = env.REVIEW_IMAGE_BRIDGE_TOKEN;
  if (!token) throw new Error("REVIEW_BRIDGE_NOT_CONFIGURED");
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (env.FFP_OPERATOR_USERNAME && env.FFP_OPERATOR_PASSWORD) headers.Authorization = `Basic ${Buffer.from(`${env.FFP_OPERATOR_USERNAME}:${env.FFP_OPERATOR_PASSWORD}`).toString("base64")}`;
  const repository = new PostgresReviewTextRepository(databaseUrl);
  try { await repository.initialize(); await repository.recover(); } catch (error) { await repository.close(); throw error; }
  return new ReviewTextJobs(repository, {
    async readContext(contextJobId) {
      const response = await fetch(new URL(`/api/v1/review-jobs/${encodeURIComponent(contextJobId)}`, baseUrl), { headers, signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error("REVIEW_CONTEXT_UNAVAILABLE");
      const job = contextSchema.parse(await response.json());
      const lastIndex = Math.max(0, ...job.samples.map(sample => Number(sample.reviewId.split("-").at(-1)) || 0));
      return { asin: job.asin, count: 1, product: job.reviewData.context, priorSamples: job.samples, sourceReviews: [], startIndex: lastIndex + 1 };
    },
    async checkBridge() {
      const response = await fetch(new URL("/api/review-images/health", baseUrl), { headers: { "X-Bridge-Token": token }, signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error("REVIEW_BRIDGE_UNAVAILABLE");
      const health = z.object({ extensionConnected: z.boolean(), textCapable: z.boolean().optional() }).parse(await response.json());
      if (!health.extensionConnected) throw new Error("REVIEW_EXTENSION_OFFLINE");
      if (!health.textCapable) throw new Error("REVIEW_EXTENSION_UPDATE_REQUIRED");
    },
    generate: createBridgeReviewGenerator({ baseUrl, token }),
    async save(contextJobId, result) {
      const response = await fetch(new URL(`/api/v1/review-jobs/${encodeURIComponent(contextJobId)}/samples`, baseUrl), {
        method: "POST", headers, body: JSON.stringify({ samples: result.samples }), signal: AbortSignal.timeout(20_000),
      });
      if (!response.ok) throw new Error("REVIEW_SAVE_FAILED");
    },
    async cancelBridge(id) {
      const response = await fetch(new URL(`/api/review-images/text/${encodeURIComponent(id)}/cancel`, baseUrl), {
        method: "POST", headers: { "X-Bridge-Token": token }, signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error("REVIEW_CANCEL_UNCONFIRMED");
    },
  });
}
export async function closeReviewTextRuntime(): Promise<void> {
  const previous = runtime; runtime = undefined;
  if (previous) await (await previous).close();
}
