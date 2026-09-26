import { loadServerEnvironment } from "../../config/server-environment";

import { AltOnlyImageProcessor } from "./internal/image-processing/image-processor";
import { FileSeoConflictCorpus } from "./internal/conflict-control/file-seo-conflict-corpus";
import { createSeoPipeline, DEFAULT_SEO_PIPELINE_STAGES } from "./internal/pipeline";
import { registerProductKeywords } from "./internal/stages/b4-conflict-control";
import { createB1ProductUnderstandingStage, createDefaultProductImageAnalyzer } from "./internal/stages/b1-product-understanding";
import { heuristicProductImageAnalyzer } from "./internal/product-understanding/heuristic-product-image-analyzer";
import { createB2ShoppingContextStage, createDefaultShoppingContextAnalyzer } from "./internal/stages/b2-shopping-context";
import {
  createB3SearchSuggestionsStage,
  createDefaultSearchSuggestionsCollector,
} from "./internal/stages/b3-search-suggestions";
import { createB4ConflictControlStage } from "./internal/stages/b4-conflict-control";
import { createB5ContentGenerationStage, createDefaultB5Generator } from "./internal/stages/b5-content-generation";
import { createB6ImageProcessingStage } from "./internal/stages/b6-image-processing";
import { getDefaultSiteNicheResolver } from "./internal/site-niche/site-niche-runtime";
import { resolveStoreProfile } from "./internal/store-profiles";
import type {
  SeoContentAltOnlyDetailedOutput,
  SeoContentDetailedOutput,
  SeoContentDetailedResult,
  SeoContentDependencies,
  SeoContentInput,
  SeoContentOutput,
  SeoContentPipelineSummary,
  SeoContentRunOptions,
} from "./types";
import type { SeoConflictCorpus } from "./internal/conflict-control/seo-conflict-corpus";

let defaultPipeline: ReturnType<typeof createSeoPipeline> | undefined;

function getDefaultPipeline(): ReturnType<typeof createSeoPipeline> {
  if (!defaultPipeline) {
    if (typeof window === "undefined") {
      try {
        loadServerEnvironment();
      } catch {
        // Ignore in environments where .env files aren't readable
      }
    }
    defaultPipeline = createSeoPipeline({
      siteNicheResolver: getDefaultSiteNicheResolver(),
    });
  }
  return defaultPipeline;
}

/**
 * Executes the SEO + Content pipeline for a single product.
 *
 * Runs sequential multi-stage processing:
 * B1 (Understanding) -> B2 (Context) -> B3 (Search) -> B4 (Conflict) -> B5 (Content) -> B6 (Images).
 */
export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return getDefaultPipeline().execute(input);
}

export function runSeoContentDetailed(
  input: SeoContentInput,
  options: {
    readonly imageMode: "alt_only";
    readonly dependencies?: SeoContentDependencies;
    readonly signal?: AbortSignal;
  },
): Promise<SeoContentAltOnlyDetailedOutput>;
export function runSeoContentDetailed(
  input: SeoContentInput,
  options?: {
    readonly imageMode?: "full";
    readonly dependencies?: SeoContentDependencies;
    readonly signal?: AbortSignal;
  },
): Promise<SeoContentDetailedOutput>;
export function runSeoContentDetailed(
  input: SeoContentInput,
  options: SeoContentRunOptions,
): Promise<SeoContentDetailedResult>;
export async function runSeoContentDetailed(
  input: SeoContentInput,
  options: SeoContentRunOptions = {},
): Promise<SeoContentDetailedResult> {
  const observedFallbackStages: string[] = [];
  const observedWarnings: string[] = [];
  const observeFallback = (stage: string, error: unknown) => {
    if (!observedFallbackStages.includes(stage)) observedFallbackStages.push(stage);
    observedWarnings.push(error instanceof Error ? error.message : String(error));
  };
  const runtimeStages = [
    createB1ProductUnderstandingStage({
      imageAnalyzer: createDefaultProductImageAnalyzer({
        onFallback: (error) => observeFallback("b1", error),
        maxImages: options.imageMode === "alt_only" ? 1 : undefined,
      }),
      maxImages: options.imageMode === "alt_only" ? 1 : undefined,
    }),
    createB2ShoppingContextStage({
      analyzer: createDefaultShoppingContextAnalyzer({
        onFallback: (error) => observeFallback("b2", error),
      }),
    }),
    createB3SearchSuggestionsStage({
      collector: createDefaultSearchSuggestionsCollector({
        onPartialFailure: (failedCount, totalCount) => {
          throw new Error(`Google Suggest incomplete: ${failedCount}/${totalCount} seed requests failed.`);
        },
      }),
    }),
    createB4ConflictControlStage(
      options.dependencies?.conflictCorpus
        ? { conflictCorpus: options.dependencies.conflictCorpus as SeoConflictCorpus }
        : (input.storeId ? { conflictCorpus: new FileSeoConflictCorpus({ storeId: input.storeId }) } : undefined),
    ),
    createB5ContentGenerationStage({
      generator: createDefaultB5Generator({
        onFallback: (reason, error) => observeFallback("b5", error ?? reason),
      }),
    }),
    options.imageMode === "alt_only"
      ? createB6ImageProcessingStage({ imageProcessor: new AltOnlyImageProcessor() })
      : DEFAULT_SEO_PIPELINE_STAGES[DEFAULT_SEO_PIPELINE_STAGES.length - 1],
  ];
  const pipeline = createSeoPipeline({
    stages: runtimeStages,
    siteNicheResolver: getDefaultSiteNicheResolver(),
  });
  const execution = await pipeline.executeDetailed(input, { signal: options.signal });
  const generator = execution.context.contentGenerationMetadata?.generator ?? "heuristic";
  const hasGeminiConfiguration = typeof process !== "undefined" && Boolean(process.env?.GOOGLE_CLOUD_PROJECT?.trim());
  const configuredEmbeddingProvider = typeof process !== "undefined" ? process.env?.SEO_EMBEDDING_PROVIDER?.trim().toLowerCase() : undefined;
  const fallbackStages = [...new Set([...observedFallbackStages, ...execution.fallbackStages])];
  const usedLocalEmbeddingFallback = hasGeminiConfiguration
    && !["local", "fallback"].includes(configuredEmbeddingProvider ?? "")
    && Object.values(execution.context.conflictResult?.approvedEmbeddings ?? {})
      .some((embedding) => !["vertex", "vertex_ai"].includes(embedding.provider));
  if (usedLocalEmbeddingFallback && !fallbackStages.includes("b4")) {
    fallbackStages.push("b4");
    observedWarnings.push("Vertex embeddings were unavailable; local keyword conflict analysis was used.");
  }
  if (hasGeminiConfiguration && generator === "heuristic" && !fallbackStages.includes("b5")) {
    fallbackStages.push("b5");
  }
  const engine = !hasGeminiConfiguration
    ? "heuristic"
    : generator === "gemini" && fallbackStages.length === 0 && options.imageMode !== "alt_only"
      ? "gemini"
      : "mixed";
  return {
    output: options.imageMode === "alt_only"
      ? {
          ...execution.output,
          images: execution.output.images.map((image) => ({
            sourceUrl: image.sourceUrl,
            alt: image.alt,
          })),
        }
      : execution.output,
    metadata: {
      engine,
      fieldsApplied: ["title", "descriptionHtml", "handle", "seo.title", "seo.description", "media.alt"],
      fallbackStages,
      warnings: [...observedWarnings, ...execution.warnings],
      approvedKeywords: execution.context.conflictResult?.approvedKeywords ?? [],
      approvedEmbeddings: execution.context.conflictResult?.approvedEmbeddings,
      corpusRevision: execution.context.conflictResult?.corpusRevision,
    },
  };
}

export async function registerSeoContentKeywords(
  input: SeoContentInput,
  detailed: SeoContentDetailedResult,
): Promise<{ readonly revision: number }> {
  const corpus = new FileSeoConflictCorpus({ storeId: input.storeId });
  return registerProductKeywords(
    corpus,
    {
      ...input,
      title: detailed.output.productTitle,
      handle: detailed.output.productHandle,
    },
    detailed.metadata.approvedKeywords,
    {
      title: detailed.output.productTitle,
      expectedRevision: detailed.metadata.corpusRevision,
      embeddings: detailed.metadata.approvedEmbeddings,
    },
  );
}

export async function unregisterSeoContentKeywords(
  input: SeoContentInput,
  detailed: SeoContentDetailedResult,
): Promise<void> {
  const corpus = new FileSeoConflictCorpus({ storeId: input.storeId });
  await corpus.removeProduct({
    storeId: input.storeId,
    productId: input.productId,
    handle: detailed.output.productHandle,
    url: input.url ?? `/products/${detailed.output.productHandle}`,
  });
}

export function createSeoContentPipelineSummary(
  detailed: SeoContentDetailedResult,
): SeoContentPipelineSummary {
  return {
    status: "completed",
    engine: detailed.metadata.engine,
    fieldsApplied: detailed.metadata.fieldsApplied,
    fallbackStages: detailed.metadata.fallbackStages,
    warnings: detailed.metadata.warnings,
  };
}

export { resolveStoreProfile, JEMINISE_BEDDING_PROFILE } from "./internal/store-profiles";

