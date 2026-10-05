import type { GptSeoEnqueue, GptSeoInput, GptSeoSettings } from "../custom-gpt-seo";
import type { RecommendationInput } from "../seo-performance";

export interface PerformanceRevisionRequest {
  readonly storeId: string; readonly recommendationId: string; readonly recommendation: RecommendationInput;
  readonly source: Readonly<Record<string, unknown>>;
}
export async function createPerformanceRevision(request: PerformanceRevisionRequest, dependencies: {
  readonly loadProduct: (storeId: string, productId: string) => Promise<Record<string, unknown>>;
  readonly settings: (storeId: string) => Promise<GptSeoSettings>;
  readonly prepareInput: (product: Readonly<Record<string, unknown>>, storeId: string) => GptSeoInput;
  readonly enqueue: (input: GptSeoEnqueue) => Promise<{ readonly id: string }>;
}): Promise<{ readonly jobId: string }> {
  const productId = request.source.id;
  if (typeof productId !== "string" || typeof request.source.updatedAt !== "string") throw new Error("PRODUCT_VERSION_REQUIRED");
  const product = await dependencies.loadProduct(request.storeId, productId);
  if (product.updatedAt !== request.source.updatedAt) throw new Error("STALE_SHOPIFY_SOURCE");
  if (product.hasMoreImages === true || product.hasMoreVariants === true) throw new Error("PRODUCT_EVIDENCE_INCOMPLETE");
  const settings = await dependencies.settings(request.storeId);
  const input = dependencies.prepareInput(product, request.storeId);
  const revisionId = `performance:${request.recommendationId}`;
  const job = await dependencies.enqueue({
    performanceRecommendationId: request.recommendationId,
    input,
    execution: {
      storeId: request.storeId,
      productId,
      source: "auto_seo",
      sourceIdentity: productId,
      sourceRevision: revisionId,
      shopifyUpdatedAt: request.source.updatedAt,
      providerId: "codex_mcp",
      pipelineVersion: "seo-content-input-v2",
      originalSnapshot: { ...product, storeId: request.storeId },
    },
    settings: { ...settings, provider: "codex_mcp" },
  });
  return { jobId: job.id };
}
