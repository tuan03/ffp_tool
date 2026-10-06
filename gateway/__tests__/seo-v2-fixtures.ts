import type { GptSeoEnqueue, GptSeoInput } from "../../src/modules/custom-gpt-seo";
import type { SeoExecutionEnvelope, SeoStoreProfile } from "../../src/shared/seo-content-contract";

export function createTestStoreProfile(storeId = "jeminise"): SeoStoreProfile {
  return { profileId: `${storeId}-test`, profileVersion: "2.0.0", storeId, storeName: storeId,
    locale: "en-US", language: "English", niche: "Bedding", brandVoice: ["clear"],
    contentRules: ["Ground product facts in image pixels"], prohibitedClaims: ["Unsupported claims"],
    seoConstraints: { maxTitleCharacters: 70, maxDescriptionCharacters: 160, maxAltCharacters: 125 } };
}

export function createTestSeoInput(input: Partial<GptSeoInput> & Pick<GptSeoInput, "images"> = { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }] }, storeId = "jeminise"): GptSeoInput {
  const images = input.images.length > 0 ? input.images : [{ id: "front", url: "https://cdn.shopify.com/front.png" }];
  return { images, niche: input.niche ?? "Bedding", storeProfile: input.storeProfile ?? createTestStoreProfile(storeId) };
}

export function createTestExecution(input: Partial<SeoExecutionEnvelope> = {}): SeoExecutionEnvelope {
  const storeId = input.storeId ?? "jeminise";
  const source = input.source ?? "auto_seo";
  const sourceIdentity = input.sourceIdentity ?? input.productId ?? "123";
  return { storeId, source, sourceIdentity, providerId: input.providerId ?? "codex_mcp",
    pipelineVersion: input.pipelineVersion ?? "seo-worker-v2", originalSnapshot: input.originalSnapshot ?? { updatedAt: "v1" },
    ...(input.productId ? { productId: input.productId } : {}), ...(input.sourceRevision ? { sourceRevision: input.sourceRevision } : {}),
    ...(input.shopifyUpdatedAt ? { shopifyUpdatedAt: input.shopifyUpdatedAt } : {}) };
}

export function createTestEnqueue(options: {
  readonly storeId?: string; readonly source?: "amazon" | "auto_seo"; readonly sourceIdentity?: string;
  readonly productId?: string; readonly sourceRevision?: string; readonly original?: unknown;
  readonly input?: Partial<GptSeoInput> & Pick<GptSeoInput, "images">;
  readonly settings?: GptSeoEnqueue["settings"];
  readonly performanceRecommendationId?: string;
} = {}): GptSeoEnqueue {
  const storeId = options.storeId ?? "jeminise";
  const sourceIdentity = options.sourceIdentity ?? options.productId ?? "123";
  return { input: createTestSeoInput(options.input, storeId), execution: createTestExecution({ storeId,
    source: options.source ?? "auto_seo", sourceIdentity, ...(options.productId ? { productId: options.productId } : {}),
    ...(options.sourceRevision ? { sourceRevision: options.sourceRevision } : {}), originalSnapshot: options.original ?? { updatedAt: "v1" } }),
    ...(options.settings ? { settings: options.settings } : {}),
    ...(options.performanceRecommendationId ? { performanceRecommendationId: options.performanceRecommendationId } : {}) };
}
