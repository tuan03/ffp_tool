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
import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
} from "../product-understanding/product-image-analyzer";

export interface B1ProductUnderstandingDependencies {
  readonly imageAnalyzer: ProductImageAnalyzer;
}

/**
 * Creates the default product image analyzer.
 * If Google Cloud / Vertex AI environment configuration is present,
 * creates GeminiProductImageAnalyzer wrapped with FallbackProductImageAnalyzer
 * falling back to HeuristicProductImageAnalyzer with an observability warning log.
 * If not configured, uses HeuristicProductImageAnalyzer directly.
 */
export function createDefaultProductImageAnalyzer(): ProductImageAnalyzer {
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
    projectId,
    location,
    defaultModel: model,
  });

  const geminiAnalyzer = new GeminiProductImageAnalyzer({
    generator,
    model,
  });

  return new FallbackProductImageAnalyzer({
    primary: geminiAnalyzer,
    fallback: heuristicProductImageAnalyzer,
    onFallback: (error, input) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      const target = input.image.url || input.image.localFilePath || "unknown";
      console.warn(
        `[SEO B1 Fallback] Gemini analysis failed for image '${target}'. Falling back to heuristic analyzer. Cause: ${errMsg}`,
      );
    },
  });
}

export function createB1ProductUnderstandingStage(
  dependencies?: B1ProductUnderstandingDependencies,
): SeoPipelineStage {
  const imageAnalyzer = dependencies?.imageAnalyzer ?? createDefaultProductImageAnalyzer();

  return {
    name: "b1",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const source = context.source;
      const niche = context.effectiveNiche ?? source.niche;
      const images = source.images ?? [];

      const textSignals = extractTextProductSignals({
        title: source.title ?? "",
        description: source.description ?? "",
        niche,
      });

      const successfulAnalyses: ProductImageAnalysis[] = [];

      if (images.length > 0) {
        const settledResults = await Promise.allSettled(
          images.map((image) =>
            Promise.resolve().then(() =>
              imageAnalyzer.analyze({
                image,
                title: source.title ?? "",
                description: source.description ?? "",
                niche,
              }),
            ),
          ),
        );

        for (const result of settledResults) {
          if (result.status === "fulfilled" && result.value) {
            successfulAnalyses.push(result.value);
          }
        }
      }

      const productUnderstanding = buildProductUnderstanding(
        successfulAnalyses,
        textSignals,
      );

      return evolveContext(context, { productUnderstanding });
    },
  };
}

export const b1ProductUnderstandingStage: SeoPipelineStage =
  createB1ProductUnderstandingStage();

export async function executeB1ProductUnderstanding(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  return b1ProductUnderstandingStage.execute(context);
}
