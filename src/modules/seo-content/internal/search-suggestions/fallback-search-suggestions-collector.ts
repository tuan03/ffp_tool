import { selectSearchSeeds } from "./search-seed-selector";

import type { SearchResearchResult } from "../domain-types";
import type {
  SearchSuggestionsCollector,
  SearchSuggestionsCollectorInput,
} from "./search-suggestions-collector";

/**
 * Deterministic fallback collector.
 * Used when Google Autocomplete is disabled or completely unavailable.
 * Invariant: Returns selected seeds with empty suggestedQueries ([]).
 * NEVER fabricates synthetic suggestions or labels external provenance in fallback.
 */
export class FallbackSearchSuggestionsCollector
  implements SearchSuggestionsCollector
{
  async collect(
    input: SearchSuggestionsCollectorInput,
  ): Promise<SearchResearchResult> {
    const selectedSeeds = selectSearchSeeds(input);
    const seedKeywords = selectedSeeds.map((s) => s.query);
    const querySources: Record<string, string> = {};

    for (const seed of selectedSeeds) {
      querySources[seed.query] = seed.source;
    }

    return {
      seedKeywords,
      suggestedQueries: [],
      querySources,
    };
  }
}

export const fallbackSearchSuggestionsCollector =
  new FallbackSearchSuggestionsCollector();
