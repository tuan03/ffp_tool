import { createInitialContext, evolveContext, finalizePipelineOutput } from "./internal/pipeline-context";
import { executeB5ContentGeneration } from "./internal/stages/b5-content-generation";
import { validateDraft } from "./internal/content-generation/content-result-validator";
import { FileSeoConflictCorpus } from "./internal/conflict-control/file-seo-conflict-corpus";
import { isSameProduct } from "./internal/conflict-control/seo-conflict-corpus";
import { UnofficialGoogleSuggestClient } from "./internal/search-suggestions/google-suggest-client";
import type { ProductUnderstanding, ShoppingContext } from "./internal/domain-types";
import type { SeoConflictCorpus } from "./internal/conflict-control/seo-conflict-corpus";
import type { SeoContentDetailedOutput, SeoContentInput } from "./types";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Expected an object");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim() || value.length > 4000) throw new Error(`Missing or invalid ${field}`);
  return value.trim();
}
function strings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length > 20) throw new Error(`Invalid ${field}`);
  return value.map(entry => text(entry, field));
}
/** Called only by the trusted pipeline after Shopify resolves the product identity. */
export async function bindExternalSeoProduct(binding: { readonly storeId: string; readonly sourceIdentity: string; readonly productId: string }, providedCorpus?: FileSeoConflictCorpus): Promise<void> {
  const productId = binding.productId.replace(/^gid:\/\/shopify\/Product\//, "");
  if (!/^[a-zA-Z0-9_-]+$/.test(binding.storeId) || !binding.sourceIdentity || !/^\d+$/.test(productId)) throw new Error("Invalid product identity binding");
  const corpus = providedCorpus ?? new FileSeoConflictCorpus({ storeId: binding.storeId, maxRegisteredKeywordsPerProduct: 1024 });
  await corpus.reassignProduct({ storeId: binding.storeId, productId: `amazon:${binding.sourceIdentity}` }, { storeId: binding.storeId, productId });
}
export function validateExternalSeoAnalysis(input: SeoContentInput, payload: unknown): { understanding: ProductUnderstanding; shopping: ShoppingContext; evidence: readonly { imageId: string; observation: string }[] } {
  const analysis = object(payload);
  const evidence = Array.isArray(analysis.evidence) ? analysis.evidence.map(entry => {
    const item = object(entry);
    return { imageId: text(item.imageId, "imageId"), observation: text(item.observation, "image observation") };
  }) : [];
  const imageIds = input.images.map((image, index) => image.id || `image-${index + 1}`);
  if (imageIds.length === 0 || imageIds.some(id => !evidence.some(entry => entry.imageId === id)) || evidence.some(entry => !imageIds.includes(entry.imageId))) throw new Error("Image evidence must cover exactly the supplied product images; attach missing images before continuing");
  const typography = object(analysis.typography);
  const shopping = object(analysis.shoppingContext);
  return {
    evidence,
    understanding: {
      physicalProductIdentity: text(analysis.physicalProductIdentity, "physicalProductIdentity"),
      visualEntities: text(analysis.visualEntities, "visualEntities"),
      sceneContext: text(analysis.sceneContext, "sceneContext"),
      typography: { visibleTexts: strings(typography.visibleTexts, "visibleTexts"), styleSummary: text(typography.styleSummary, "styleSummary") },
    },
    shopping: {
      targetAudience: strings(shopping.targetAudience, "targetAudience"),
      suitableOccasions: strings(shopping.suitableOccasions, "suitableOccasions"),
      useCases: strings(shopping.useCases, "useCases"),
      buyerIntentKeywords: strings(shopping.buyerIntentKeywords, "buyerIntentKeywords"),
    },
  };
}
export async function researchExternalSeo(seeds: readonly string[], language = "en-US"): Promise<Readonly<Record<string, readonly string[]>>> {
  if (!seeds.length || seeds.length > 5 || seeds.some(seed => !seed.trim() || seed.length > 120)) throw new Error("Provide 1–5 seeds of at most 120 characters");
  const client = new UnofficialGoogleSuggestClient({ language: language.split("-")[0], timeoutMs: 2500, retryDelayMs: 250 });
  const results: Record<string, readonly string[]> = {};
  for (const seed of seeds) results[seed] = await client.getSuggestions(seed, { signal: AbortSignal.timeout(5000) });
  return results;
}
export async function checkExternalSeoKeywords(input: SeoContentInput, keywords: readonly string[], providedCorpus?: SeoConflictCorpus) {
  if (!input.storeId || !/^[a-zA-Z0-9_-]+$/.test(input.storeId)) throw new Error("Valid storeId required");
  if (!keywords.length || keywords.length > 10 || keywords.some(keyword => !keyword.trim() || keyword.length > 120)) throw new Error("Provide 1–10 keywords of at most 120 characters");
  const corpus = providedCorpus ?? new FileSeoConflictCorpus({ storeId: input.storeId, maxRegisteredKeywordsPerProduct: 1024 });
  if (!corpus.getSnapshot) throw new Error("Persistent corpus snapshot required");
  const snapshot = await corpus.getSnapshot();
  const owner = { storeId: input.storeId, productId: input.productId, handle: input.handle, url: input.url };
  const conflicts = await Promise.all(keywords.map(async keyword => ({ keyword, matches: await corpus.findConflicts({ keyword, owner, snapshot }) })));
  const previousKeywords = snapshot.products.filter(product => isSameProduct(product, owner)).flatMap(product => product.keywords.map(keyword => keyword.keyword));
  return { revision: snapshot.revision, previousKeywords, conflicts, semanticMode: "local_with_gpt_review" as const };
}
/** No default provider factories are called: every reasoning result comes from the external draft. */
export async function finalizeExternalSeo(input: SeoContentInput, analysisPayload: unknown, keywordPayload: unknown, submission: unknown, providedCorpus?: SeoConflictCorpus): Promise<SeoContentDetailedOutput> {
  const analysis = validateExternalSeoAnalysis(input, analysisPayload);
  const decision = object(keywordPayload);
  const keywords = strings(decision.keywords, "keywords");
  text(decision.reason, "keyword decision reason");
  const check = await checkExternalSeoKeywords(input, keywords, providedCorpus);
  if (check.conflicts.some(conflict => conflict.matches.length)) throw new Error("Keyword conflict: check keywords again and choose non-conflicting targets");
  const raw = object(submission);
  const draft = validateDraft(raw.draft);
  // Arbitrary JSON-LD from an external model must not bypass fact validation.
  if (draft.aeo_json_ld) throw new Error("Submit structured FAQ fields, not arbitrary JSON-LD");
  const alts = object(raw.alts);
  const imageOutputs = input.images.map((image, index) => {
    const id = image.id || `image-${index + 1}`;
    const alt = text(alts[id], `alt for ${id}`);
    if (alt.length > 125) throw new Error(`Alt for ${id} exceeds 125 characters`);
    return { sourceUrl: image.url, alt, webp: { filename: `${input.handle || "product"}-${index + 1}.webp`, url: image.url } };
  });
  let context = evolveContext(createInitialContext(input), {
    productUnderstanding: analysis.understanding,
    shoppingContext: analysis.shopping,
    conflictResult: { approvedKeywords: keywords, discardedKeywords: [], conflictReasons: {}, corpusRevision: check.revision },
  });
  context = await executeB5ContentGeneration(context, { generator: { generate: async () => draft } });
  context = evolveContext(context, { imageResult: { processedImages: imageOutputs } });
  const corpus = providedCorpus ?? new FileSeoConflictCorpus({ storeId: input.storeId, maxRegisteredKeywordsPerProduct: 1024 });
  if (!corpus.upsertProduct) throw new Error("Persistent corpus registration required");
  // Preserve previously committed keywords while a replacement is only a review draft.
  // Replaying after a crash is harmless: upsert replaces this same owner's union.
  await corpus.upsertProduct({ identity: { storeId: input.storeId, productId: input.productId, handle: input.handle, url: input.url }, title: input.title, approvedKeywords: [...new Set([...keywords, ...check.previousKeywords])], expectedRevision: check.revision });
  return { output: finalizePipelineOutput(context), metadata: { engine: "custom_gpt", fieldsApplied: ["title", "description", "seoTitle", "seoDescription", "alt"], fallbackStages: [], warnings: ["Image evidence is supplied by an external reasoning provider and must be reviewed. Semantic conflict review uses local retrieval, not Vertex embeddings."], approvedKeywords: keywords, corpusRevision: check.revision + 1 } };
}
