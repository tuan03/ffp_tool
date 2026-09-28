import type { SeoContentInput, SeoContentOutput } from "../types";
import type { SeoPipelineContext, SeoPipelineStage } from "./domain-types";
import { createInitialContext, evolveContext, finalizePipelineOutput } from "./pipeline-context";
import { SeoStageError, SeoTimeoutError, wrapStageError } from "./pipeline-errors";
import { b1ProductUnderstandingStage } from "./stages/b1-product-understanding";
import { b2ShoppingContextStage } from "./stages/b2-shopping-context";
import { b3SearchSuggestionsStage } from "./stages/b3-search-suggestions";
import { b4ConflictControlStage } from "./stages/b4-conflict-control";
import { b5ContentGenerationStage, buildB5ContentInput } from "./stages/b5-content-generation";
import { b6ImageProcessingStage } from "./stages/b6-image-processing";
import type { SiteNicheResolver } from "./site-niche/site-niche-resolver";
import { resolveStoreProfile } from "./store-profiles";
import type { SeoCheckpoint, SeoCheckpointStore } from "./checkpoint";
import { FileSeoCheckpointStore, SeoCheckpointManager } from "./checkpoint";

export type { SeoPipelineStage };

export const DEFAULT_STAGE_TIMEOUTS_MS: Readonly<Record<string, number>> = Object.freeze({
  b1: 60_000,
  b2: 90_000,
  b3: 45_000,
  b4: 45_000,
  b5: 120_000,
  b6: 45_000,
});

export const DEFAULT_OVERALL_TIMEOUT_MS = 420_000;

export function getStageTimeoutMs(
  stageName: string,
  stageTimeouts?: Partial<Record<string, number>>,
): number {
  const normalized = stageName.toLowerCase();
  if (stageTimeouts) {
    if (typeof stageTimeouts[stageName] === "number") return stageTimeouts[stageName]!;
    if (typeof stageTimeouts[normalized] === "number") return stageTimeouts[normalized]!;
    for (const [key, val] of Object.entries(stageTimeouts)) {
      if (key.toLowerCase() === normalized && typeof val === "number") {
        return val;
      }
    }
  }
  return DEFAULT_STAGE_TIMEOUTS_MS[normalized] ?? 60_000;
}


/**
 * Extracts updated fields between two consecutive pipeline contexts,
 * excluding the immutable source field.
 */
export function extractContextUpdates(
  previousContext: SeoPipelineContext,
  nextContext: SeoPipelineContext,
): Partial<Omit<SeoPipelineContext, "source">> {
  const updates: Partial<Omit<SeoPipelineContext, "source">> = {};
  for (const key of Object.keys(nextContext) as Array<keyof SeoPipelineContext>) {
    if (key === "source") continue;
    if (nextContext[key] !== previousContext[key] && nextContext[key] !== undefined) {
      (updates as Record<string, unknown>)[key] = nextContext[key];
    }
  }
  return updates;
}

export interface SeoPipelineExecutionOptions {
  readonly signal?: AbortSignal;
  readonly resume?: SeoPipelineResume;
  readonly onStage?: (stage: string, durationMs: number) => void;
  readonly stageTimeouts?: Partial<Record<string, number>>;
  readonly overallTimeoutMs?: number;
  readonly checkpointManager?: SeoCheckpointManager;
  readonly checkpointStore?: SeoCheckpointStore;
  readonly promptVersions?: Partial<Record<string, string>>;
  readonly stageModels?: Partial<Record<string, string>>;
  readonly skipCache?: boolean;
}

export interface SeoPipelineResume {
  readonly inputKey: string;
  readonly research: SeoPipelineContext;
  readonly researchFallbacks: readonly string[];
  readonly researchWarnings: readonly string[];
  readonly completed: SeoPipelineContext;
  readonly contentKey: string;
  readonly contentFallbacks: readonly string[];
  readonly contentWarnings: readonly string[];
}

export const DEFAULT_SEO_PIPELINE_STAGES: readonly SeoPipelineStage[] = Object.freeze([
  b1ProductUnderstandingStage,
  b2ShoppingContextStage,
  b3SearchSuggestionsStage,
  b4ConflictControlStage,
  b5ContentGenerationStage,
  b6ImageProcessingStage,
]);

export interface SeoPipeline {
  readonly stages: readonly SeoPipelineStage[];
  execute(input: SeoContentInput, options?: SeoPipelineExecutionOptions): Promise<SeoContentOutput>;
  executeDetailed(input: SeoContentInput, options?: SeoPipelineExecutionOptions): Promise<{
    readonly output: SeoContentOutput;
    readonly context: SeoPipelineContext;
    readonly fallbackStages: readonly string[];
    readonly warnings: readonly string[];
    readonly resume?: SeoPipelineResume;
    readonly checkpoint?: SeoCheckpoint;
  }>;
}

function createAbortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error("SEO pipeline execution was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError(signal.reason);
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError(signal.reason));
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(
      (val) => {
        signal.removeEventListener("abort", handleAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener("abort", handleAbort);
        reject(err);
      },
    );
  });
}

export interface SeoPipelineOptions {
  readonly stages?: readonly SeoPipelineStage[];
  /** Structural dependency keeps pipeline tests and alternate server runtimes network-free. */
  readonly siteNicheResolver?: Pick<SiteNicheResolver, "resolve">;
  readonly stageTimeouts?: Partial<Record<string, number>>;
  readonly overallTimeoutMs?: number;
  readonly checkpointManager?: SeoCheckpointManager;
  readonly checkpointStore?: SeoCheckpointStore;
  readonly enableCheckpointing?: boolean;
  readonly promptVersions?: Partial<Record<string, string>>;
  readonly stageModels?: Partial<Record<string, string>>;
}

function isPipelineOptions(
  options: readonly SeoPipelineStage[] | SeoPipelineOptions | undefined,
): options is SeoPipelineOptions {
  return !Array.isArray(options);
}

export function createSeoPipeline(
  options?: readonly SeoPipelineStage[] | SeoPipelineOptions,
): SeoPipeline {
  const pipelineOptions = isPipelineOptions(options) ? options : undefined;
  const customStages = Array.isArray(options) ? options : pipelineOptions?.stages;
  const siteNicheResolver = pipelineOptions?.siteNicheResolver;
  if (customStages && customStages.length === 0) {
    throw new SeoStageError("b1", "Pipeline must contain at least one stage");
  }

  const stages = customStages ?? DEFAULT_SEO_PIPELINE_STAGES;

  async function executeDetailed(input: SeoContentInput, executionOptions: SeoPipelineExecutionOptions = {}) {
    const { signal, resume } = executionOptions;
    if (resume && resume.inputKey !== JSON.stringify(input)) throw new Error("SEO checkpoint belongs to different product input.");
    throwIfAborted(signal);

    const overallTimeoutMs = executionOptions.overallTimeoutMs
      ?? pipelineOptions?.overallTimeoutMs
      ?? DEFAULT_OVERALL_TIMEOUT_MS;

    const overallController = new AbortController();
    let overallTimer: NodeJS.Timeout | number | undefined;

    const onParentAbort = () => {
      overallController.abort(signal?.reason ?? createAbortError());
    };

    if (signal) {
      if (signal.aborted) {
        overallController.abort(signal.reason ?? createAbortError());
      } else {
        signal.addEventListener("abort", onParentAbort, { once: true });
      }
    }

    if (overallTimeoutMs > 0 && Number.isFinite(overallTimeoutMs)) {
      overallTimer = setTimeout(() => {
        overallController.abort(
          new SeoTimeoutError(
            "overall",
            overallTimeoutMs,
            `Overall SEO pipeline timed out after ${overallTimeoutMs}ms`,
          ),
        );
      }, overallTimeoutMs);
      if (typeof (overallTimer as { unref?: () => void })?.unref === "function") {
        (overallTimer as { unref: () => void }).unref();
      }
    }

    const checkpointManager = executionOptions.checkpointManager
      ?? (executionOptions.checkpointStore
        ? new SeoCheckpointManager({ store: executionOptions.checkpointStore })
        : pipelineOptions?.checkpointManager
          ?? (pipelineOptions?.checkpointStore
            ? new SeoCheckpointManager({ store: pipelineOptions.checkpointStore })
            : pipelineOptions?.enableCheckpointing
              ? new SeoCheckpointManager({ store: new FileSeoCheckpointStore() })
              : undefined));

    let checkpoint: SeoCheckpoint | null = null;
    let canReuseFromCache = false;
    const stageHashes = new Map<string, string>();
    const stageUpstreamHashes = new Map<string, string>();

    if (checkpointManager && !resume) {
      const inputHash = checkpointManager.computeProductInputHash(input);
      checkpoint = await checkpointManager.loadCheckpoint(inputHash);

      let lastHash = inputHash;
      for (const stage of stages) {
        const promptVer = executionOptions.promptVersions?.[stage.name]
          ?? pipelineOptions?.promptVersions?.[stage.name]
          ?? checkpointManager.getDefaultPromptVersion(stage.name);
        const model = executionOptions.stageModels?.[stage.name]
          ?? pipelineOptions?.stageModels?.[stage.name]
          ?? checkpointManager.getDefaultModel(stage.name);

        stageUpstreamHashes.set(stage.name, lastHash);
        const sHash = checkpointManager.computeStageHash(
          stage.name,
          inputHash,
          lastHash,
          promptVer,
          model,
        );
        stageHashes.set(stage.name, sHash);
        lastHash = sHash;
      }

      canReuseFromCache = !executionOptions.skipCache && Boolean(checkpoint);
    }

    try {
      throwIfAborted(overallController.signal);
      const isB1Cached = Boolean(
        canReuseFromCache
        && checkpoint?.stages.b1?.status === "completed"
        && checkpoint?.stages.b1?.stageHash === stageHashes.get("b1"),
      );

      const storeProfile = resolveStoreProfile({
        storeId: input.storeId,
        siteDomain: input.siteDomain ?? input.url,
      });
      const resolution = !resume && !isB1Cached && siteNicheResolver
        ? await awaitWithAbort(siteNicheResolver.resolve({
            signal: overallController.signal,
            siteDomain: input.siteDomain ?? "",
            fallbackNiche: input.niche ?? storeProfile?.niche,
          }), overallController.signal)
        : undefined;
      let currentContext = resume?.research ?? createInitialContext(input, resolution?.niche ?? storeProfile?.niche ?? input.niche);
      const fallbackStages: string[] = [...(resume?.researchFallbacks ?? [])];
      const warnings: string[] = [...(resume?.researchWarnings ?? [])];
      let research = resume?.research;
      let researchFallbacks = [...fallbackStages];
      let researchWarnings = [...warnings];
      let contentKey = "";
      let contentWarningStart = 0;
      let contentFallbackStart = 0;
      let reuseContent = false;

      for (const stage of stages) {
        if (resume && ["b1", "b2", "b3"].includes(stage.name)) continue;
        if (stage.name === "b5") {
          contentKey = JSON.stringify(buildB5ContentInput(currentContext));
          contentWarningStart = warnings.length;
          contentFallbackStart = fallbackStages.length;
          reuseContent = Boolean(resume && contentKey === resume.contentKey);
          if (reuseContent && resume) {
            currentContext = Object.freeze({ ...currentContext,
              contentResult: resume.completed.contentResult,
              contentGenerationMetadata: resume.completed.contentGenerationMetadata
                ? { ...resume.completed.contentGenerationMetadata, corpusRevision: currentContext.conflictResult?.corpusRevision } : undefined,
              imageResult: resume.completed.imageResult,
              imageProcessingMetadata: resume.completed.imageProcessingMetadata,
            });
            warnings.push(...resume.contentWarnings);
            fallbackStages.push(...resume.contentFallbacks);
          }
        }
        if (reuseContent && ["b5", "b6"].includes(stage.name)) continue;

        if (checkpointManager && !resume) {
          const expectedStageHash = stageHashes.get(stage.name) ?? "";
          if (canReuseFromCache && checkpoint) {
            const stageCp = checkpoint.stages[stage.name];
            if (stageCp && stageCp.status === "completed" && stageCp.stageHash === expectedStageHash) {
              if (stageCp.contextUpdates) {
                currentContext = evolveContext(currentContext, stageCp.contextUpdates);
              }
              if (stageCp.fallbacks && stageCp.fallbacks.length > 0) {
                fallbackStages.push(...stageCp.fallbacks);
              }
              if (stageCp.warnings && stageCp.warnings.length > 0) {
                warnings.push(...stageCp.warnings);
              }
              executionOptions.onStage?.(stage.name, stageCp.durationMs);
              if (stage.name === "b3") {
                research = currentContext;
                researchFallbacks = [...fallbackStages];
                researchWarnings = [...warnings];
              }
              continue;
            } else {
              canReuseFromCache = false;
            }
          }
        }

        throwIfAborted(overallController.signal);

        const stageStartedAt = Date.now();
        const stageTimeoutMs = getStageTimeoutMs(
          stage.name,
          executionOptions.stageTimeouts ?? pipelineOptions?.stageTimeouts,
        );

        const stageController = new AbortController();
        let stageTimer: NodeJS.Timeout | number | undefined;

        const onOverallAbort = () => {
          stageController.abort(overallController.signal.reason);
        };

        if (overallController.signal.aborted) {
          stageController.abort(overallController.signal.reason);
        } else {
          overallController.signal.addEventListener("abort", onOverallAbort, { once: true });
        }

        if (stageTimeoutMs > 0 && Number.isFinite(stageTimeoutMs)) {
          stageTimer = setTimeout(() => {
            stageController.abort(
              new SeoTimeoutError(
                stage.name,
                stageTimeoutMs,
                `Stage ${stage.name.toUpperCase()} timed out after ${stageTimeoutMs}ms`,
              ),
            );
          }, stageTimeoutMs);
          if (typeof (stageTimer as { unref?: () => void })?.unref === "function") {
            (stageTimer as { unref: () => void }).unref();
          }
        }

        const beforeContext = currentContext;

        try {
          throwIfAborted(stageController.signal);
          const nextContext = await awaitWithAbort<SeoPipelineContext>(stage.execute(currentContext), stageController.signal);
          throwIfAborted(stageController.signal);

          if (!nextContext || typeof nextContext !== "object") {
            throw new SeoStageError(stage.name, "Stage returned an invalid context");
          }

          if (nextContext.source !== currentContext.source) {
            throw new SeoStageError(stage.name, "Stage mutated or lost source input");
          }

          currentContext = nextContext;

          if (checkpointManager && !resume) {
            const expectedStageHash = stageHashes.get(stage.name) ?? "";
            const upstreamHash = stageUpstreamHashes.get(stage.name);
            const promptVersion = executionOptions.promptVersions?.[stage.name]
              ?? pipelineOptions?.promptVersions?.[stage.name]
              ?? checkpointManager.getDefaultPromptVersion(stage.name);
            const model = executionOptions.stageModels?.[stage.name]
              ?? pipelineOptions?.stageModels?.[stage.name]
              ?? checkpointManager.getDefaultModel(stage.name);
            const contextUpdates = extractContextUpdates(beforeContext, nextContext);

            checkpoint = await checkpointManager.recordStageSuccess(input, stage.name, {
              stageHash: expectedStageHash,
              upstreamHash,
              promptVersion,
              model,
              durationMs: Date.now() - stageStartedAt,
              contextUpdates,
            });
          }
        } catch (error: unknown) {
          if (overallController.signal.aborted) {
            throw overallController.signal.reason instanceof Error
              ? overallController.signal.reason
              : createAbortError(overallController.signal.reason);
          }
          if (error instanceof Error && error.name === "AbortError") throw error;

          const expectedStageHash = stageHashes.get(stage.name) ?? "";
          const upstreamHash = stageUpstreamHashes.get(stage.name);
          const promptVersion = executionOptions.promptVersions?.[stage.name]
            ?? pipelineOptions?.promptVersions?.[stage.name]
            ?? checkpointManager?.getDefaultPromptVersion(stage.name);
          const model = executionOptions.stageModels?.[stage.name]
            ?? pipelineOptions?.stageModels?.[stage.name]
            ?? checkpointManager?.getDefaultModel(stage.name);

          if (error instanceof SeoTimeoutError) {
            if (error.isRecoverable) {
              fallbackStages.push(stage.name);
              warnings.push(error.message);
              console.warn(
                `[SEO Pipeline] Non-fatal timeout warning in stage ${stage.name}: ${error.message}`,
              );
              if (checkpointManager && !resume) {
                checkpoint = await checkpointManager.recordStageSuccess(input, stage.name, {
                  stageHash: expectedStageHash,
                  upstreamHash,
                  promptVersion,
                  model,
                  durationMs: Date.now() - stageStartedAt,
                  fallbacks: [stage.name],
                  warnings: [error.message],
                }).catch(() => checkpoint);
              }
              continue;
            }
            if (checkpointManager && !resume) {
              checkpoint = await checkpointManager.recordStageFailure(input, stage.name, {
                stageHash: expectedStageHash,
                upstreamHash,
                promptVersion,
                model,
                durationMs: Date.now() - stageStartedAt,
                error,
              }).catch(() => checkpoint);
            }
            throw error;
          }

          const stageError = wrapStageError(stage.name, error);
          if (stageError.isRecoverable) {
            fallbackStages.push(stage.name);
            warnings.push(stageError.message);
            console.warn(
              `[SEO Pipeline] Non-fatal warning in stage ${stage.name}: ${stageError.message}`,
            );
            if (checkpointManager && !resume) {
              checkpoint = await checkpointManager.recordStageSuccess(input, stage.name, {
                stageHash: expectedStageHash,
                upstreamHash,
                promptVersion,
                model,
                durationMs: Date.now() - stageStartedAt,
                fallbacks: [stage.name],
                warnings: [stageError.message],
              }).catch(() => checkpoint);
            }
          } else {
            if (checkpointManager && !resume) {
              checkpoint = await checkpointManager.recordStageFailure(input, stage.name, {
                stageHash: expectedStageHash,
                upstreamHash,
                promptVersion,
                model,
                durationMs: Date.now() - stageStartedAt,
                error: stageError,
              }).catch(() => checkpoint);
            }
            throw stageError;
          }
        } finally {
          if (stageTimer !== undefined) {
            clearTimeout(stageTimer);
          }
          overallController.signal.removeEventListener("abort", onOverallAbort);
          executionOptions.onStage?.(stage.name, Date.now() - stageStartedAt);
        }
        if (stage.name === "b3") {
          research = currentContext;
          researchFallbacks = [...fallbackStages];
          researchWarnings = [...warnings];
        }
      }

      return {
        output: finalizePipelineOutput(currentContext),
        context: currentContext,
        fallbackStages,
        warnings,
        resume: research ? {
          inputKey: JSON.stringify(input), research, researchFallbacks, researchWarnings,
          completed: currentContext, contentKey,
          contentFallbacks: fallbackStages.slice(contentFallbackStart),
          contentWarnings: warnings.slice(contentWarningStart),
        } : undefined,
        checkpoint: checkpoint ?? undefined,
      };
    } finally {
      if (overallTimer !== undefined) {
        clearTimeout(overallTimer);
      }
      if (signal) {
        signal.removeEventListener("abort", onParentAbort);
      }
    }
  }

  return {
    stages,
    async execute(input: SeoContentInput, executionOptions?: SeoPipelineExecutionOptions): Promise<SeoContentOutput> {
      return (await executeDetailed(input, executionOptions)).output;
    },
    executeDetailed,
  };
}

