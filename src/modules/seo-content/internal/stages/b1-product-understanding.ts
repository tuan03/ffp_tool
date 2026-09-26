import type { ProviderRequestOptions } from "../provider-runtime";
import { evolveContext } from "../pipeline-context";
import { buildProductUnderstanding } from "../product-understanding/product-understanding-builder";
import { heuristicProductImageAnalyzer } from "../product-understanding/heuristic-product-image-analyzer";
import { extractTextProductSignals } from "../product-understanding/text-product-signals";
import { GeminiProductImageAnalyzer } from "../product-understanding/gemini-product-image-analyzer";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";
import { FallbackProductImageAnalyzer } from "../product-understanding/fallback-product-image-analyzer";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import { resolveStoreProfile } from "../store-profiles";
import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
} from "../product-understanding/product-image-analyzer";

export interface B1ProductUnderstandingDependencies {
  readonly imageAnalyzer?: ProductImageAnalyzer;
  readonly maxImages?: number;
}

/**
 * Creates the default product image analyzer.
 * If Google Cloud / Vertex AI environment configuration is present,
 * creates GeminiProductImageAnalyzer wrapped with FallbackProductImageAnalyzer
 * falling back to HeuristicProductImageAnalyzer with an observability warning log.
 * If not configured, uses HeuristicProductImageAnalyzer directly.
 */
export function createDefaultProductImageAnalyzer(options?: ProviderRequestOptions & {
  readonly onFallback?: (error: unknown) => void;
  readonly maxImages?: number;
}): ProductImageAnalyzer {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    return heuristicProductImageAnalyzer;
  }

  const location = env?.GOOGLE_CLOUD_LOCATION || "global";
  const model =
    env?.GEMINI_ANALYSIS_MODEL ||
    env?.GEMINI_MODEL ||
    "gemini-2.5-flash";

  const generator = new GoogleGenAIVertexContentGenerator({
    ...options,
    projectId,
    location,
    defaultModel: model,
  });

  const geminiAnalyzer = new GeminiProductImageAnalyzer({
    signal: options?.signal,
    generator,
    model,
    maxImages: options?.maxImages,
  });

  return new FallbackProductImageAnalyzer({
    primary: geminiAnalyzer,
    fallback: heuristicProductImageAnalyzer,
    onFallback: (error, input) => {
      options?.onFallback?.(error);
      const errMsg = error instanceof Error ? error.message : String(error);
      const target = input.images[0]?.url || input.images[0]?.localFilePath || "unknown";
      console.warn(
        `[SEO B1 Fallback] Gemini analysis failed for image '${target}'. Falling back to heuristic analyzer. Cause: ${errMsg}`,
      );
    },
  });
}

export function createB1ProductUnderstandingStage(
  dependencies?: B1ProductUnderstandingDependencies,
): SeoPipelineStage {
  const imageAnalyzer =
    dependencies?.imageAnalyzer ??
    createDefaultProductImageAnalyzer({ maxImages: dependencies?.maxImages });

  return {
    name: "b1",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const source = context.source;
      const storeProfile =
        context.storeProfile ??
        resolveStoreProfile({
          storeId: source.storeId,
          siteDomain: source.siteDomain ?? source.url,
        });
      const niche = context.effectiveNiche ?? storeProfile?.niche ?? source.niche;
      const rawImages = source.images ?? [];
      const images =
        typeof dependencies?.maxImages === "number" && dependencies.maxImages > 0
          ? rawImages.slice(0, dependencies.maxImages)
          : rawImages;

      const textSignals = extractTextProductSignals({
        title: source.title ?? "",
        description: source.description ?? "",
        niche,
      });

      let imageAnalysis: ProductImageAnalysis | undefined;
      if (images.length > 0) {
        try {
          imageAnalysis = await imageAnalyzer.analyze({
            images,
            title: source.title ?? "",
            description: source.description ?? "",
            niche,
            maxImages: dependencies?.maxImages,
          });
        } catch (error) {
          if (error instanceof Error && error.name === "AbortError") throw error;
          // Do not promote source metadata into visual evidence when all image reads fail.
        }
      }

      const productUnderstanding = buildProductUnderstanding(
        imageAnalysis,
        textSignals,
      );

      return evolveContext(context, {
        productUnderstanding,
        ...(storeProfile ? { storeProfile } : {}),
      });
    },
  };
}

export const b1ProductUnderstandingStage: SeoPipelineStage = {
  name: "b1",
  execute: context => createB1ProductUnderstandingStage().execute(context),
};

export async function executeB1ProductUnderstanding(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  return b1ProductUnderstandingStage.execute(context);
}
