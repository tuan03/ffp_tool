import type { SeoContentInput, SeoContentOutput } from "../types";
import type { SeoPipelineContext, SeoPipelineStage } from "./domain-types";
import { createInitialContext, finalizePipelineOutput } from "./pipeline-context";
import { SeoStageError, wrapStageError } from "./pipeline-errors";
import { b1ProductUnderstandingStage } from "./stages/b1-product-understanding";
import { b2ShoppingContextStage } from "./stages/b2-shopping-context";
import { b3SearchSuggestionsStage } from "./stages/b3-search-suggestions";
import { b4ConflictControlStage } from "./stages/b4-conflict-control";
import { b5ContentGenerationStage } from "./stages/b5-content-generation";
import { b6ImageProcessingStage } from "./stages/b6-image-processing";
import type { SiteNicheResolver } from "./site-niche/site-niche-resolver";
import { resolveStoreProfile } from "./store-profiles";

export type { SeoPipelineStage };

export interface SeoPipelineExecutionOptions {
  readonly signal?: AbortSignal;
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
  }>;
}

function createAbortError(): Error {
  const error = new Error("SEO pipeline execution was cancelled.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw createAbortError();
}

async function awaitWithAbort<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (!signal) return promise;
  throwIfAborted(signal);
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createAbortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", handleAbort));
  });
}

export interface SeoPipelineOptions {
  readonly stages?: readonly SeoPipelineStage[];
  /** Structural dependency keeps pipeline tests and alternate server runtimes network-free. */
  readonly siteNicheResolver?: Pick<SiteNicheResolver, "resolve">;
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
    const { signal } = executionOptions;
    throwIfAborted(signal);
    const storeProfile = resolveStoreProfile({
      storeId: input.storeId,
      siteDomain: input.siteDomain ?? input.url,
    });
    const resolution = siteNicheResolver
      ? await awaitWithAbort(siteNicheResolver.resolve({
          siteDomain: input.siteDomain ?? "",
          fallbackNiche: input.niche ?? storeProfile?.niche,
        }), signal)
      : undefined;
    let currentContext = createInitialContext(input, resolution?.niche ?? storeProfile?.niche ?? input.niche);
    const fallbackStages: string[] = [];
    const warnings: string[] = [];

      for (const stage of stages) {
        try {
          throwIfAborted(signal);
          const nextContext = await awaitWithAbort<SeoPipelineContext>(stage.execute(currentContext), signal);
          throwIfAborted(signal);

          if (!nextContext || typeof nextContext !== "object") {
            throw new SeoStageError(stage.name, "Stage returned an invalid context");
          }

          if (nextContext.source !== currentContext.source) {
            throw new SeoStageError(stage.name, "Stage mutated or lost source input");
          }

          currentContext = nextContext;
        } catch (error: unknown) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          const stageError = wrapStageError(stage.name, error);
          if (stageError.isRecoverable) {
            fallbackStages.push(stage.name);
            warnings.push(stageError.message);
            console.warn(
              `[SEO Pipeline] Non-fatal warning in stage ${stage.name}: ${stageError.message}`,
            );
          } else {
            throw stageError;
          }
        }
      }

      return {
        output: finalizePipelineOutput(currentContext),
        context: currentContext,
        fallbackStages,
        warnings,
      };
  }

  return {
    stages,
    async execute(input: SeoContentInput, executionOptions?: SeoPipelineExecutionOptions): Promise<SeoContentOutput> {
      return (await executeDetailed(input, executionOptions)).output;
    },
    executeDetailed,
  };
}
