import type { ProviderRequestOptions } from "../provider-runtime";
import { evolveContext } from "../pipeline-context";
import { buildProductUnderstanding } from "../product-understanding/product-understanding-builder";
import { GeminiProductImageAnalyzer } from "../product-understanding/gemini-product-image-analyzer";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";
import { SeoStageError } from "../pipeline-errors";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type {
  ProductImageAnalysis,
  ProductImageAnalyzer,
} from "../product-understanding/product-image-analyzer";

export interface B1ProductUnderstandingDependencies {
  readonly imageAnalyzer?: ProductImageAnalyzer;
  /** @deprecated V2 always analyzes every supplied image. */
  readonly maxImages?: number;
}

/**
 * Creates the default product image analyzer.
 * If Google Cloud / Vertex AI environment configuration is present,
 * creates a Gemini pixel analyzer. Without pixel-analysis configuration the
 * stage fails closed; niche-only heuristics are forbidden by the V2 contract.
 */
export function createDefaultProductImageAnalyzer(options?: ProviderRequestOptions & {
  readonly onFallback?: (error: unknown) => void;
}): ProductImageAnalyzer {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    return {
      async analyze(): Promise<ProductImageAnalysis> {
        throw new SeoStageError("b1", "IMAGE_EVIDENCE_UNAVAILABLE: pixel analyzer is not configured");
      },
    };
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
  });

  return geminiAnalyzer;
}

export function createB1ProductUnderstandingStage(
  dependencies?: B1ProductUnderstandingDependencies,
): SeoPipelineStage {
  const imageAnalyzer =
    dependencies?.imageAnalyzer ??
    createDefaultProductImageAnalyzer();

  return {
    name: "b1",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const source = context.source;
      const storeProfile = context.storeProfile;
      const niche = context.effectiveNiche ?? source.niche;
      const images = source.images;

      if (images.length === 0) {
        throw new SeoStageError("b1", "IMAGE_EVIDENCE_UNAVAILABLE: at least one product image is required");
      }

      let imageAnalysis: ProductImageAnalysis;
      try {
        imageAnalysis = await imageAnalyzer.analyze({
          images,
          niche,
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        if (error instanceof SeoStageError) throw error;
        throw new SeoStageError("b1", "IMAGE_EVIDENCE_UNAVAILABLE: product pixels could not be analyzed", false, error);
      }

      const productUnderstanding = buildProductUnderstanding(imageAnalysis);
      const identity = productUnderstanding.physicalProductIdentity.trim().toLowerCase();
      const confidence = productUnderstanding.confidence;
      const candidates = productUnderstanding.identityCandidates ?? [];
      if (
        !identity
        || identity === "unknown"
        || confidence === undefined
        || confidence < 0.75
        || productUnderstanding.reviewRequired
        || candidates.length !== 1
      ) {
        throw new SeoStageError("b1", "PRODUCT_IDENTITY_AMBIGUOUS: image evidence does not identify one sold product");
      }

      return evolveContext(context, {
        productUnderstanding,
        storeProfile,
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
