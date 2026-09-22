import { QUERY_SOURCE, shouldUpgradeSource } from "./query-source";
import {
  canonicalKey,
  MAX_GLOBAL_SUGGESTIONS,
  MAX_PER_SEED_SUGGESTIONS,
  normalizeSuggestionQuery,
} from "./search-suggestions-normalizer";
import { selectSearchSeeds } from "./search-seed-selector";
import {
  GoogleSuggestBlockedError,
  GoogleSuggestError,
  GoogleSuggestRateLimitError,
} from "./search-suggestion-errors";

import type { SearchResearchResult } from "../domain-types";
import type { GoogleSuggestClient } from "./google-suggest-client";
import type {
  SearchSuggestionsCollector,
  SearchSuggestionsCollectorInput,
} from "./search-suggestions-collector";

export interface GoogleSearchSuggestionsCollectorOptions {
  readonly client: GoogleSuggestClient;
  readonly interRequestDelayMs?: number;
  readonly onPartialFailure?: (failedCount: number, totalCount: number) => void;
}

export const DEFAULT_INTER_REQUEST_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GoogleSearchSuggestionsCollector
  implements SearchSuggestionsCollector
{
  private readonly client: GoogleSuggestClient;
  private readonly interRequestDelayMs: number;
  private readonly onPartialFailure?: (
    failedCount: number,
    totalCount: number,
  ) => void;

  constructor(options: GoogleSearchSuggestionsCollectorOptions) {
    this.client = options.client;
    this.interRequestDelayMs =
      options.interRequestDelayMs ?? DEFAULT_INTER_REQUEST_DELAY_MS;
    this.onPartialFailure = options.onPartialFailure;
  }

  async collect(
    input: SearchSuggestionsCollectorInput,
  ): Promise<SearchResearchResult> {
    const selectedSeeds = selectSearchSeeds(input);
    const seedKeywords = selectedSeeds.map((s) => s.query);
    const querySources: Record<string, string> = {};

    // Build map of seed canonical keys to seed queries
    const seedKeyToQuery = new Map<string, string>();
    for (const seed of selectedSeeds) {
      querySources[seed.query] = seed.source;
      seedKeyToQuery.set(canonicalKey(seed.query), seed.query);
    }

    const suggestedQueries: string[] = [];
    const seenSuggestionKeys = new Set<string>();

    let failedCount = 0;

    for (let i = 0; i < selectedSeeds.length; i++) {
      const seed = selectedSeeds[i];

      if (i > 0 && this.interRequestDelayMs > 0) {
        await sleep(this.interRequestDelayMs);
      }

      let rawSuggestions: readonly string[];
      try {
        rawSuggestions = await this.client.getSuggestions(seed.query);
      } catch (error) {
        failedCount++;

        // Circuit breaker: 403 or repeated 429 terminates remaining batch
        const isBlocked =
          error instanceof GoogleSuggestBlockedError ||
          (error instanceof GoogleSuggestError && error.status === 403);
        const isRateLimited =
          error instanceof GoogleSuggestRateLimitError ||
          (error instanceof GoogleSuggestError && error.status === 429);

        if (isBlocked || isRateLimited) {
          break;
        }

        // Transient errors (network error, timeout, 5xx): continue to next seed
        continue;
      }

      let seedAcceptedCount = 0;
      for (const raw of rawSuggestions) {
        if (
          seedAcceptedCount >= MAX_PER_SEED_SUGGESTIONS ||
          suggestedQueries.length >= MAX_GLOBAL_SUGGESTIONS
        ) {
          break;
        }

        const normalized = normalizeSuggestionQuery(raw);
        if (!normalized) {
          continue;
        }

        const key = canonicalKey(normalized);

        // Case: suggestion matches one of the researched seeds
        if (seedKeyToQuery.has(key)) {
          const originalSeedQuery = seedKeyToQuery.get(key)!;
          if (
            shouldUpgradeSource(
              querySources[originalSeedQuery],
              QUERY_SOURCE.GOOGLE_AUTOCOMPLETE,
            )
          ) {
            querySources[originalSeedQuery] = QUERY_SOURCE.GOOGLE_AUTOCOMPLETE;
          }
          // Do NOT duplicate in suggestedQueries
          continue;
        }

        // Deduplicate globally (first-seen wins)
        if (seenSuggestionKeys.has(key)) {
          continue;
        }

        seenSuggestionKeys.add(key);
        suggestedQueries.push(normalized);
        querySources[normalized] = QUERY_SOURCE.GOOGLE_AUTOCOMPLETE;
        seedAcceptedCount++;
      }
    }

    if (failedCount > 0) {
      if (this.onPartialFailure) {
        this.onPartialFailure(failedCount, selectedSeeds.length);
      } else {
        console.warn(
          `[SEO B3] Google Suggest partial failure: ${failedCount}/${selectedSeeds.length} seeds failed.`,
        );
      }
    }

    return {
      seedKeywords,
      suggestedQueries,
      querySources,
    };
  }
}
