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

import type { AutocompleteProbe, SearchResearchResult } from "../domain-types";
import type { GoogleSuggestClient } from "./google-suggest-client";
import type {
  SearchQueryVariantGenerator,
  SearchQueryVariantGroup,
} from "./search-query-variant-generator";
import type {
  SearchSuggestionsCollector,
  SearchSuggestionsCollectorInput,
} from "./search-suggestions-collector";

export interface GoogleSearchSuggestionsCollectorOptions {
  readonly client: GoogleSuggestClient;
  readonly variantGenerator?: SearchQueryVariantGenerator;
  readonly interRequestDelayMs?: number;
  readonly onPartialFailure?: (failedCount: number, totalCount: number) => void;
  readonly onVariantGenerationFailure?: (error: unknown) => void;
}

export const DEFAULT_INTER_REQUEST_DELAY_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GoogleSearchSuggestionsCollector
  implements SearchSuggestionsCollector
{
  private readonly client: GoogleSuggestClient;
  private readonly variantGenerator?: SearchQueryVariantGenerator;
  private readonly interRequestDelayMs: number;
  private readonly onPartialFailure?: (
    failedCount: number,
    totalCount: number,
  ) => void;
  private readonly onVariantGenerationFailure?: (error: unknown) => void;

  constructor(options: GoogleSearchSuggestionsCollectorOptions) {
    this.client = options.client;
    this.variantGenerator = options.variantGenerator;
    this.interRequestDelayMs =
      options.interRequestDelayMs ?? DEFAULT_INTER_REQUEST_DELAY_MS;
    this.onPartialFailure = options.onPartialFailure;
    this.onVariantGenerationFailure = options.onVariantGenerationFailure;
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

    const generatedVariants = await this.generateVariants(input, selectedSeeds);
    const probes = this.buildProbes(selectedSeeds, generatedVariants);
    const suggestedQueries: string[] = [];
    const seenSuggestionKeys = new Set<string>();
    const autocompleteProbes: AutocompleteProbe[] = [];

    let failedCount = 0;

    for (let i = 0; i < probes.length; i++) {
      const probe = probes[i];
      const parentSeed = selectedSeeds.find((seed) => seed.query === probe.parentSeed);
      if (!parentSeed) {
        continue;
      }

      if (i > 0 && this.interRequestDelayMs > 0) {
        await sleep(this.interRequestDelayMs);
      }

      let rawSuggestions: readonly string[];
      try {
        autocompleteProbes.push(probe);
        rawSuggestions = await this.client.getSuggestions(probe.query);
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
        // Preserve scene provenance through Google expansion so B4 can reject a
        // suggestion that has no source/product/design evidence beyond the setting.
        querySources[normalized] = parentSeed.source === QUERY_SOURCE.SCENE_CONTEXT_SEED
          ? QUERY_SOURCE.SCENE_CONTEXT_SEED
          : QUERY_SOURCE.GOOGLE_AUTOCOMPLETE;
        seedAcceptedCount++;
      }
    }

    if (failedCount > 0) {
      if (this.onPartialFailure) {
        this.onPartialFailure(failedCount, probes.length);
      } else {
        console.warn(
          `[SEO B3] Google Suggest partial failure: ${failedCount}/${probes.length} probes failed.`,
        );
      }
    }

    return {
      seedKeywords,
      suggestedQueries,
      querySources,
      autocompleteProbes,
    };
  }

  private async generateVariants(
    input: SearchSuggestionsCollectorInput,
    selectedSeeds: ReturnType<typeof selectSearchSeeds>,
  ): Promise<readonly SearchQueryVariantGroup[]> {
    if (!this.variantGenerator) {
      return [];
    }

    try {
      return await this.variantGenerator.generate({ ...input, seeds: selectedSeeds });
    } catch (error) {
      if (this.onVariantGenerationFailure) {
        this.onVariantGenerationFailure(error);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[SEO B3] Gemini query-variant fallback: ${message}`);
      }
      return [];
    }
  }

  private buildProbes(
    selectedSeeds: ReturnType<typeof selectSearchSeeds>,
    generatedVariants: readonly SearchQueryVariantGroup[],
  ): readonly AutocompleteProbe[] {
    const probes: AutocompleteProbe[] = [];
    const seenKeys = new Set<string>();

    const tryAdd = (query: string, parentSeed: string, kind: AutocompleteProbe["kind"]): void => {
      const normalized = normalizeSuggestionQuery(query);
      if (!normalized) {
        return;
      }
      const key = canonicalKey(normalized);
      if (seenKeys.has(key)) {
        return;
      }
      seenKeys.add(key);
      probes.push({ query: normalized, parentSeed, kind });
    };

    for (const seed of selectedSeeds) {
      tryAdd(seed.query, seed.query, "original");
    }

    const variantsByParentSeed = new Map(
      generatedVariants.map((group) => [canonicalKey(group.seedQuery), group.variants]),
    );
    for (const parentSeed of selectedSeeds) {
      if (parentSeed.source === QUERY_SOURCE.SCENE_CONTEXT_SEED) {
        continue;
      }
      const variants = variantsByParentSeed.get(canonicalKey(parentSeed.query)) ?? [];
      for (const variant of variants.slice(0, 2)) {
        tryAdd(variant, parentSeed.query, "gemini_variant");
      }
    }

    return probes;
  }
}
