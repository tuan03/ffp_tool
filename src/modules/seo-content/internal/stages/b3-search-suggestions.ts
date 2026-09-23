import { evolveContext } from "../pipeline-context";
import { FallbackSearchSuggestionsCollector } from "../search-suggestions/fallback-search-suggestions-collector";
import { GeminiSearchQueryVariantGenerator } from "../search-suggestions/gemini-search-query-variant-generator";
import { GoogleSearchSuggestionsCollector } from "../search-suggestions/google-search-suggestions-collector";
import { UnofficialGoogleSuggestClient } from "../search-suggestions/google-suggest-client";
import { NoopSearchQueryVariantGenerator } from "../search-suggestions/search-query-variant-generator";
import { GoogleGenAIVertexContentGenerator } from "../product-understanding/gemini-content-generator";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type {
  SearchSuggestionsCollector,
} from "../search-suggestions/search-suggestions-collector";
import type { GoogleSuggestClient } from "../search-suggestions/google-suggest-client";
import type {
  SearchQueryVariantGenerator,
} from "../search-suggestions/search-query-variant-generator";

export interface B3SearchSuggestionsDependencies {
  readonly collector?: SearchSuggestionsCollector;
  readonly searchSuggestionsCollector?: SearchSuggestionsCollector;
}

/**
 * Creates default search suggestions collector based on explicit configuration.
 *
 * Controlled via:
 * - SEO_SEARCH_PROVIDER: "google" | "offline" | "fallback"
 * - SEO_SEARCH_SUGGESTIONS_ENABLED: "false" | "true"
 *
 * In automated test environments (NODE_ENV === "test" or test runner execution),
 * defaults safely to FallbackSearchSuggestionsCollector to preserve the zero-network
 * determinism invariant unless SEO_SEARCH_PROVIDER="google" is explicitly configured.
 */
export function createDefaultSearchSuggestionsCollector(options?: {
  readonly client?: GoogleSuggestClient;
  readonly onPartialFailure?: (failedCount: number, totalCount: number) => void;
}): SearchSuggestionsCollector {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;

  const provider = env?.SEO_SEARCH_PROVIDER?.toLowerCase();
  const isExplicitlyDisabled =
    env?.SEO_SEARCH_SUGGESTIONS_ENABLED === "false" ||
    provider === "offline" ||
    provider === "fallback";

  if (isExplicitlyDisabled && !options?.client) {
    return new FallbackSearchSuggestionsCollector();
  }

  const isTestRunner =
    typeof process !== "undefined" &&
    ((process.execArgv && process.execArgv.includes("--test")) ||
      (process.argv &&
        process.argv.some(
          (arg) =>
            arg === "--test" ||
            arg.endsWith(".test.ts") ||
            arg.endsWith(".test.js") ||
            arg.endsWith(".test.mjs"),
        )));

  const isTestEnvironment = env?.NODE_ENV === "test" || isTestRunner;

  if (isTestEnvironment && provider !== "google" && !options?.client) {
    return new FallbackSearchSuggestionsCollector();
  }

  const client = options?.client ?? new UnofficialGoogleSuggestClient();
  return new GoogleSearchSuggestionsCollector({
    client,
    onPartialFailure: options?.onPartialFailure,
    variantGenerator: createDefaultSearchQueryVariantGenerator(),
  });
}

function createDefaultSearchQueryVariantGenerator(): SearchQueryVariantGenerator {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;
  const projectId = env?.GOOGLE_CLOUD_PROJECT;
  if (!projectId) {
    return new NoopSearchQueryVariantGenerator();
  }

  const model =
    env?.GEMINI_ANALYSIS_MODEL ||
    env?.GEMINI_MODEL ||
    "gemini-2.5-flash";
  const generator = new GoogleGenAIVertexContentGenerator({
    projectId,
    location: env?.GOOGLE_CLOUD_LOCATION || "global",
    defaultModel: model,
  });

  return new GeminiSearchQueryVariantGenerator({ generator, model });
}

export function createB3SearchSuggestionsStage(
  dependencies?: B3SearchSuggestionsDependencies,
): SeoPipelineStage {
  return {
    name: "b3",
    async execute(context: SeoPipelineContext): Promise<SeoPipelineContext> {
      const collector =
        dependencies?.collector ??
        dependencies?.searchSuggestionsCollector ??
        createDefaultSearchSuggestionsCollector();

      const source = context.source;
      const niche = context.effectiveNiche ?? source.niche;

      const searchResearch = await collector.collect({
        source: {
          niche,
          title: source.title,
          description: source.description,
          handle: source.handle,
        },
        productUnderstanding: context.productUnderstanding,
        shoppingContext: context.shoppingContext,
      });

      return evolveContext(context, { searchResearch });
    },
  };
}

export const b3SearchSuggestionsStage: SeoPipelineStage =
  createB3SearchSuggestionsStage();

export async function executeB3SearchSuggestions(
  context: SeoPipelineContext,
  dependencies?: B3SearchSuggestionsDependencies,
): Promise<SeoPipelineContext> {
  const stage = createB3SearchSuggestionsStage(dependencies);
  return stage.execute(context);
}
