import { canonicalKey } from "./search-suggestions-normalizer";
import { QUERY_SOURCE, type QuerySource } from "./query-source";

import type { ProductUnderstanding, ShoppingContext } from "../domain-types";

export interface SearchSeed {
  readonly query: string;
  readonly source: QuerySource;
}

export interface SearchSeedSelectionInput {
  readonly source: {
    readonly niche?: string;
    readonly title?: string;
    readonly description?: string;
    readonly handle?: string;
  };
  readonly productUnderstanding?: ProductUnderstanding;
  readonly shoppingContext?: ShoppingContext;
}

export const MAX_SEARCH_SEEDS = 6;
export const MAX_B2_SEEDS = 4;

function cleanPhrase(text: string): string {
  return text.normalize("NFKC").replace(/\s+/g, " ").trim();
}

const INVALID_CATEGORY_NAMES = new Set([
  "unknown",
  "unspecified",
  "none",
  "n/a",
  "null",
  "undefined",
]);

function isValidCategory(category: string): boolean {
  if (!category) return false;
  const lower = category.trim().toLowerCase();
  return !INVALID_CATEGORY_NAMES.has(lower);
}

export function selectSearchSeeds(
  input: SearchSeedSelectionInput,
): readonly SearchSeed[] {
  const seeds: SearchSeed[] = [];
  const seenKeys = new Set<string>();

  function tryAddSeed(rawText: string | undefined, source: QuerySource): boolean {
    if (!rawText) return false;
    const cleaned = cleanPhrase(rawText);
    if (!cleaned) return false;
    const key = canonicalKey(cleaned);
    if (seenKeys.has(key)) return false;

    seenKeys.add(key);
    seeds.push({ query: cleaned, source });
    return true;
  }

  // Priority 1: Top buyerIntentKeywords from B2 (up to 4)
  const b2Keywords = input.shoppingContext?.buyerIntentKeywords ?? [];
  let b2Added = 0;
  for (const kw of b2Keywords) {
    if (b2Added >= MAX_B2_SEEDS || seeds.length >= MAX_SEARCH_SEEDS) {
      break;
    }
    if (tryAddSeed(kw, QUERY_SOURCE.BUYER_INTENT_SEED)) {
      b2Added++;
    }
  }

  // Priority 2: Category + strongest entity/theme from B1 if available and not yet covered
  if (seeds.length < MAX_SEARCH_SEEDS) {
    const category = cleanPhrase(input.productUnderstanding?.productCategory ?? "");
    const entities = input.productUnderstanding?.detectedEntities ?? [];
    const firstEntity = entities.length > 0 ? cleanPhrase(entities[0]) : "";

    if (isValidCategory(category) && firstEntity) {
      const catLower = category.toLowerCase();
      const entityLower = firstEntity.toLowerCase();
      let combined: string;
      if (entityLower.includes(catLower)) {
        combined = firstEntity;
      } else if (catLower.includes(entityLower)) {
        combined = category;
      } else {
        combined = `${firstEntity} ${category}`;
      }
      tryAddSeed(combined, QUERY_SOURCE.CATEGORY_SEED);
    } else if (isValidCategory(category)) {
      tryAddSeed(category, QUERY_SOURCE.CATEGORY_SEED);
    }
  }

  // Priority 3: Niche if useful and not duplicate
  if (seeds.length < MAX_SEARCH_SEEDS) {
    const niche = cleanPhrase(input.source.niche ?? "");
    if (niche) {
      tryAddSeed(niche, QUERY_SOURCE.NICHE_SEED);
    }
  }

  // Priority 4: Title-derived clean phrase only if still sparse (< 3)
  if (seeds.length < 3) {
    const rawTitle = input.source.title ?? "";
    if (rawTitle) {
      const cleanTitle = cleanPhrase(rawTitle.replace(/[-_#|]/g, " "));
      const tokens = cleanTitle.split(/\s+/).filter(Boolean);
      if (tokens.length > 0) {
        const titlePhrase = tokens.slice(0, 6).join(" ");
        tryAddSeed(titlePhrase, QUERY_SOURCE.TITLE_SEED);
      }
    }
  }

  // Priority 5: Safe category fallback if still empty (0 seeds)
  if (seeds.length === 0) {
    const category = cleanPhrase(input.productUnderstanding?.productCategory ?? "");
    const fallbackNoun = isValidCategory(category) ? category : "product";
    tryAddSeed(fallbackNoun, QUERY_SOURCE.FALLBACK_SEED);
  }

  return seeds.slice(0, MAX_SEARCH_SEEDS);
}
