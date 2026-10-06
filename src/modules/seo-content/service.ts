import { loadServerEnvironment } from "../../config/server-environment";

import { AltOnlyImageProcessor } from "./internal/image-processing/image-processor";
import { FileSeoConflictCorpus } from "./internal/conflict-control/file-seo-conflict-corpus";
import type { SeoCheckpointManager, SeoCheckpointStore } from "./internal/checkpoint";
import { FileSeoCheckpointStore, SeoCheckpointManager as DefaultSeoCheckpointManager } from "./internal/checkpoint";
import type { SeoPipelineResume } from "./internal/pipeline";
import { createSeoPipeline, DEFAULT_SEO_PIPELINE_STAGES } from "./internal/pipeline";
import { registerProductKeywords } from "./internal/stages/b4-conflict-control";
import { createB1ProductUnderstandingStage } from "./internal/stages/b1-product-understanding";
import { createB2ShoppingContextStage } from "./internal/stages/b2-shopping-context";
import {
  createB3SearchSuggestionsStage,
  createDefaultSearchSuggestionsCollector,
} from "./internal/stages/b3-search-suggestions";
import { createB4ConflictControlStage } from "./internal/stages/b4-conflict-control";
import { createB5ContentGenerationStage } from "./internal/stages/b5-content-generation";
import { createB6ImageProcessingStage } from "./internal/stages/b6-image-processing";
import { resolveStoreProfile } from "./internal/store-profiles";
import { computeProductInputHash, computeSeoResultCacheKey } from "./internal/checkpoint/checkpoint-hasher";
import {
  getDefaultSeoProviderRegistry,
  prepareSeoProviderInput,
  protectSeoProviderRuntime,
} from "./internal/providers";
import type { SeoProviderCircuitBreaker, SeoProviderRegistry } from "./internal/providers";
import type {
  SeoContentAltOnlyDetailedOutput,
  SeoContentDetailedOutput,
  SeoContentDetailedResult,
  SeoContentDependencies,
  SeoContentInput,
  SeoContentOutput,
  SeoContentPipelineSummary,
  SeoContentRunOptions,
  SeoExecutionEnvelope,
} from "./types";
import type { SeoConflictCorpus } from "./internal/conflict-control/seo-conflict-corpus";
import type { SeoResultCacheRecord } from "./internal/persistence/repositories";

interface SeoResultCache {
  get(cacheKey: string): Promise<unknown | undefined>;
  set(record: SeoResultCacheRecord): Promise<void>;
}

function isDetailedResult(value: unknown): value is SeoContentDetailedResult {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { output?: unknown; metadata?: unknown };
  return Boolean(candidate.output && typeof candidate.output === "object" && candidate.metadata && typeof candidate.metadata === "object");
}

/**
 * Executes the SEO + Content pipeline for a single product.
 *
 * Runs sequential multi-stage processing:
 * B1 (Understanding) -> B2 (Context) -> B3 (Search) -> B4 (Conflict) -> B5 (Content) -> B6 (Images).
 */
export async function runSeoContent(
  input: SeoContentInput,
  options?: SeoContentRunOptions | { readonly signal?: AbortSignal },
): Promise<SeoContentOutput> {
  const result = await createSeoContentSession(input, { ...options, imageMode: "full" }).run();
  return result.output as SeoContentOutput;
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
  return createSeoContentSession(input, options).run();
}

export function createSeoContentSession(input: SeoContentInput, options: SeoContentRunOptions & { readonly imageMode: "alt_only" }): { run(): Promise<SeoContentAltOnlyDetailedOutput> };
export function createSeoContentSession(input: SeoContentInput, options?: SeoContentRunOptions): { run(): Promise<SeoContentDetailedResult> };
export function createSeoContentSession(input: SeoContentInput, options: SeoContentRunOptions = {}): { run(): Promise<SeoContentDetailedResult> } {
  loadServerEnvironment();
  const providerInput = prepareSeoProviderInput(input);
  const executionEnvelope = options.execution;
  let resume: SeoPipelineResume | undefined;
  let running = false;
  let cacheChecked = false;
  let didReturnCachedResult = false;
  const stageDurationsMs: Record<string, number> = {};
  const providerMetrics = { providerQueueMs: 0, providerRequestMs: 0, retryWaitMs: 0, requestCount: 0, retryCount: 0, cacheHits: 0 };
  const requestOptions = { signal: options.signal, onMetric: (metric: import("./internal/provider-runtime").ProviderMetric) => {
    providerMetrics.providerQueueMs += metric.queueMs ?? 0;
    providerMetrics.providerRequestMs += metric.requestMs ?? 0;
    providerMetrics.retryWaitMs += metric.retryWaitMs ?? 0;
    if (metric.requestMs !== undefined) providerMetrics.requestCount++;
    if (metric.retryWaitMs !== undefined) providerMetrics.retryCount++;
    if (metric.cacheHit) providerMetrics.cacheHits++;
  } };
  const observedFallbacks = new Map<string, string[]>();
  const observeFallback = (stage: string, error: unknown) => {
    const warnings = observedFallbacks.get(stage) ?? [];
    warnings.push(error instanceof Error ? error.message : String(error));
    observedFallbacks.set(stage, warnings);
  };
  const providerRegistry = (options.dependencies?.providerRegistry as SeoProviderRegistry | undefined)
    ?? getDefaultSeoProviderRegistry();
  const resultCache = options.dependencies?.resultCache as SeoResultCache | undefined;
  const conflictCorpus = options.dependencies?.conflictCorpus as SeoConflictCorpus | undefined
    ?? (executionEnvelope?.storeId ? new FileSeoConflictCorpus({ storeId: executionEnvelope.storeId }) : undefined);
  const createdProviderRuntime = providerRegistry.create("gemini", {
    imageMode: options.imageMode ?? "full",
    requestOptions,
    onFallback: observeFallback,
    conflictCorpus,
  });
  const providerCircuitBreaker = options.dependencies?.providerCircuitBreaker as SeoProviderCircuitBreaker | undefined;
  const providerRuntime = providerCircuitBreaker
    ? protectSeoProviderRuntime(createdProviderRuntime, providerCircuitBreaker)
    : createdProviderRuntime;
  const runtimeStages = [
    createB1ProductUnderstandingStage({
      imageAnalyzer: providerRuntime.imageAnalyzer,
    }),
    createB2ShoppingContextStage({
      analyzer: providerRuntime.shoppingContextAnalyzer,
    }),
    createB3SearchSuggestionsStage({
      collector: createDefaultSearchSuggestionsCollector({
        ...requestOptions,
        onPartialFailure: (failedCount, totalCount) => {
          throw new Error(`Google Suggest incomplete: ${failedCount}/${totalCount} seed requests failed.`);
        },
      }),
    }),
    createB4ConflictControlStage({
      requestOptions,
      conflictCorpus,
      analyzer: providerRuntime.keywordConflictAnalyzer,
      execution: executionEnvelope,
    }),
    createB5ContentGenerationStage({
      generator: providerRuntime.contentGenerator,
    }),
    options.imageMode === "alt_only"
      ? createB6ImageProcessingStage({ imageProcessor: new AltOnlyImageProcessor() })
      : DEFAULT_SEO_PIPELINE_STAGES[DEFAULT_SEO_PIPELINE_STAGES.length - 1],
  ];
  const checkpointStore = (options.dependencies?.checkpointStore as SeoCheckpointStore | undefined)
    ?? new FileSeoCheckpointStore();
  const checkpointManager = (options.dependencies?.checkpointManager as SeoCheckpointManager | undefined)
    ?? new DefaultSeoCheckpointManager({ store: checkpointStore });
  const pipeline = createSeoPipeline({
    stages: runtimeStages.map(stage => ({
      name: stage.name,
      execute(context) { observedFallbacks.delete(stage.name); return stage.execute(context); },
    })),
    checkpointManager,
    stageModels: {
      b1: providerRuntime.model,
      b2: providerRuntime.model,
      b5: providerRuntime.model,
    },
  });
  async function run(): Promise<SeoContentDetailedResult> {
    if (running) throw new Error("A SEO session cannot run concurrently with itself.");
    running = true;
    try {
      const inputHash = computeProductInputHash(providerInput);
      if (didReturnCachedResult) {
        await checkpointStore.delete(inputHash);
        didReturnCachedResult = false;
      }
      const corpusRevision = conflictCorpus?.getSnapshot
        ? (await conflictCorpus.getSnapshot()).revision
        : 0;
      const promptVersion = ["b1", "b2", "b3", "b4", "b5", "b6"]
        .map(stage => `${stage}:${checkpointManager.getDefaultPromptVersion(stage)}`)
        .join("|");
      const resultCacheKey = computeSeoResultCacheKey({
        inputHash,
        corpusRevision,
        promptVersion,
        model: providerRuntime.model,
        pipelineVersion: executionEnvelope?.pipelineVersion ?? "seo-b1-b6-v2",
      });
      const cachedResult = resultCache && !cacheChecked ? await resultCache.get(resultCacheKey) : undefined;
      cacheChecked = true;
      if (isDetailedResult(cachedResult)) {
        didReturnCachedResult = true;
        return cachedResult;
      }
      const execution = await pipeline.executeDetailed(providerInput, {
        signal: options.signal,
        resume,
        stageTimeouts: options.stageTimeouts,
        overallTimeoutMs: options.overallTimeoutMs,
        onStage: (stage, duration) => { stageDurationsMs[stage] = (stageDurationsMs[stage] ?? 0) + duration; },
      });

      resume = execution.resume;
      const observedFallbackStages = [...observedFallbacks.keys()];
      const observedWarnings = [...observedFallbacks.values()].flat();
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
      const detailedResult: SeoContentDetailedResult = {
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
          fieldsApplied: ["title", "descriptionHtml", "seo.title", "seo.description", "media.alt"],
          fallbackStages,
          warnings: [...observedWarnings, ...execution.warnings],
          approvedKeywords: execution.context.conflictResult?.approvedKeywords ?? [],
          approvedEmbeddings: execution.context.conflictResult?.approvedEmbeddings,
          corpusRevision: execution.context.conflictResult?.corpusRevision,
          inputHash,
          sourceVersion: executionEnvelope?.sourceRevision,
          shopifyUpdatedAt: executionEnvelope?.shopifyUpdatedAt,
          providerId: providerRuntime.providerId,
          pipelineVersion: executionEnvelope?.pipelineVersion ?? "seo-b1-b6-v2",
          performance: { stageDurationsMs: { ...stageDurationsMs }, ...providerMetrics },
        },
      };
      if (resultCache && executionEnvelope) {
        await resultCache.set({
          cacheKey: resultCacheKey,
          storeId: executionEnvelope.storeId,
          productId: executionEnvelope.productId,
          inputHash,
          sourceVersion: executionEnvelope.sourceRevision,
          imageFingerprint: inputHash,
          providerId: providerRuntime.providerId,
          model: providerRuntime.model,
          promptVersion,
          pipelineVersion: executionEnvelope.pipelineVersion,
          result: detailedResult,
          expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
        });
      }
      return detailedResult;
    } finally { running = false; }
  }
  return { run };
}

export async function registerSeoContentKeywords(
  input: SeoContentInput,
  detailed: SeoContentDetailedResult,
  options: {
    readonly execution: SeoExecutionEnvelope;
    readonly conflictCorpus?: SeoConflictCorpus;
  },
): Promise<{ readonly revision: number }> {
  void input;
  const corpus = options.conflictCorpus ?? new FileSeoConflictCorpus({ storeId: options.execution.storeId });
  return registerProductKeywords(
    corpus,
    options.execution,
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
  options: {
    readonly execution: SeoExecutionEnvelope;
    readonly conflictCorpus?: SeoConflictCorpus;
  },
): Promise<void> {
  void input;
  const corpus = options.conflictCorpus ?? new FileSeoConflictCorpus({ storeId: options.execution.storeId });
  if (!corpus.removeProduct) throw new Error("SEO conflict corpus does not support reservation removal");
  await corpus.removeProduct({
    storeId: options.execution.storeId,
    productId: options.execution.productId,
    url: options.execution.sourceIdentity,
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
    performance: detailed.metadata.performance,
  };
}

export { resolveStoreProfile, JEMINISE_BEDDING_PROFILE } from "./internal/store-profiles";

