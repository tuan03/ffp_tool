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

export type { SeoPipelineStage };

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
  execute(input: SeoContentInput): Promise<SeoContentOutput>;
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

  return {
    stages,
    async execute(input: SeoContentInput): Promise<SeoContentOutput> {
      const resolution = siteNicheResolver
        ? await siteNicheResolver.resolve({
            siteDomain: input.siteDomain ?? "",
            fallbackNiche: input.niche,
          })
        : undefined;
      let currentContext = createInitialContext(input, resolution?.niche ?? input.niche);

      for (const stage of stages) {
        try {
          const nextContext = await stage.execute(currentContext);

          if (!nextContext || typeof nextContext !== "object") {
            throw new SeoStageError(stage.name, "Stage returned an invalid context");
          }

          if (nextContext.source !== currentContext.source) {
            throw new SeoStageError(stage.name, "Stage mutated or lost source input");
          }

          currentContext = nextContext;
        } catch (error: unknown) {
          const stageError = wrapStageError(stage.name, error);
          if (stageError.isRecoverable) {
            console.warn(
              `[SEO Pipeline] Non-fatal warning in stage ${stage.name}: ${stageError.message}`,
            );
          } else {
            throw stageError;
          }
        }
      }

      return finalizePipelineOutput(currentContext);
    },
  };
}
