import { evolveContext } from "../pipeline-context";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";
import { FallbackShoppingContextAnalyzer } from "../shopping-context/fallback-shopping-context-analyzer";
import { GeminiShoppingContextAnalyzer } from "../shopping-context/gemini-shopping-context-analyzer";
import { heuristicShoppingContextAnalyzer } from "../shopping-context/heuristic-shopping-context-analyzer";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type {
  ShoppingContextAnalyzer,
} from "../shopping-context/shopping-context-analyzer";

export interface B2ShoppingContextDependencies {
  readonly analyzer?: ShoppingContextAnalyzer;
  /**
   * Optional alias for analyzer to support varied dependency naming in tests
   */
  readonly shoppingContextAnalyzer?: ShoppingContextAnalyzer;
}

/**
 * Creates the default shopping context analyzer.
 * If Google Cloud / Vertex AI environment configuration is present,
 * creates GeminiShoppingContextAnalyzer wrapped with FallbackShoppingContextAnalyzer
 * falling back to HeuristicShoppingContextAnalyzer with an observability warning log.
 * If not configured, uses HeuristicShoppingContextAnalyzer directly.
 */
export function createDefaultShoppingContextAnalyzer(): ShoppingContextAnalyzer {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;

  if (!projectId) {
    return heuristicShoppingContextAnalyzer;
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

  const geminiAnalyzer = new GeminiShoppingContextAnalyzer({
    generator,
    model,
  });

  return new FallbackShoppingContextAnalyzer({
    primary: geminiAnalyzer,
    fallback: heuristicShoppingContextAnalyzer,
    onFallback: (error, input) => {
      const errMsg = error instanceof Error ? error.message : String(error);
      const title = input.source.title || "untitled";
      console.warn(
        `[SEO B2 Fallback] Gemini shopping context analysis failed for product '${title}'. Falling back to heuristic analyzer. Cause: ${errMsg}`,
      );
    },
  });
}

export function createB2ShoppingContextStage(
  dependencies?: B2ShoppingContextDependencies,
): SeoPipelineStage {
  const analyzer =
    dependencies?.analyzer ??
    dependencies?.shoppingContextAnalyzer ??
    createDefaultShoppingContextAnalyzer();

  return {
    name: "b2",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const source = context.source;

      const shoppingContext = await analyzer.analyze({
        source: {
          niche: source.niche ?? "",
          title: source.title ?? "",
          description: source.description ?? "",
          handle: source.handle ?? "",
        },
        productUnderstanding: context.productUnderstanding,
      });

      return evolveContext(context, { shoppingContext });
    },
  };
}

export const b2ShoppingContextStage: SeoPipelineStage =
  createB2ShoppingContextStage();

export async function executeB2ShoppingContext(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  return b2ShoppingContextStage.execute(context);
}
