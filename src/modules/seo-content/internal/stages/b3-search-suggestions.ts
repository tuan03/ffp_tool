import { evolveContext } from "../pipeline-context";
import { FallbackSearchSuggestionsCollector } from "../search-suggestions/fallback-search-suggestions-collector";
import { GoogleSearchSuggestionsCollector } from "../search-suggestions/google-search-suggestions-collector";
import { UnofficialGoogleSuggestClient } from "../search-suggestions/google-suggest-client";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type {
  SearchSuggestionsCollector,
} from "../search-suggestions/search-suggestions-collector";

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
export function createDefaultSearchSuggestionsCollector(): SearchSuggestionsCollector {
  const env = typeof process !== "undefined" && process.env ? process.env : undefined;

  const provider = env?.SEO_SEARCH_PROVIDER?.toLowerCase();
  const isExplicitlyDisabled =
    env?.SEO_SEARCH_SUGGESTIONS_ENABLED === "false" ||
    provider === "offline" ||
    provider === "fallback";

  if (isExplicitlyDisabled) {
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

  if (isTestEnvironment && provider !== "google") {
    return new FallbackSearchSuggestionsCollector();
  }

  const client = new UnofficialGoogleSuggestClient();
  return new GoogleSearchSuggestionsCollector({
    client,
  });
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

      const searchResearch = await collector.collect({
        source: {
          niche: source.niche,
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
