export const QUERY_SOURCE = {
  BUYER_INTENT_SEED: "buyer_intent_seed",
  CATEGORY_SEED: "category_seed",
  NICHE_SEED: "niche_seed",
  TITLE_SEED: "title_seed",
  SCENE_CONTEXT_SEED: "scene_context_seed",
  FALLBACK_SEED: "fallback_seed",
  GOOGLE_AUTOCOMPLETE: "google_autocomplete",
} as const;

export type QuerySource = (typeof QUERY_SOURCE)[keyof typeof QUERY_SOURCE];

/**
 * Precedence hierarchy for query provenance:
 * google_autocomplete > buyer_intent_seed > category_seed > niche_seed > title_seed > fallback_seed
 */
const SOURCE_PRECEDENCE: Readonly<Record<QuerySource, number>> = {
  [QUERY_SOURCE.GOOGLE_AUTOCOMPLETE]: 6,
  [QUERY_SOURCE.BUYER_INTENT_SEED]: 5,
  [QUERY_SOURCE.CATEGORY_SEED]: 4,
  [QUERY_SOURCE.NICHE_SEED]: 3,
  [QUERY_SOURCE.TITLE_SEED]: 2,
  [QUERY_SOURCE.SCENE_CONTEXT_SEED]: 1,
  [QUERY_SOURCE.FALLBACK_SEED]: 0,
};

export function shouldUpgradeSource(
  existingSource: string | undefined,
  newSource: QuerySource,
): boolean {
  if (!existingSource) return true;
  const existingRank =
    SOURCE_PRECEDENCE[existingSource as QuerySource] ?? 0;
  const newRank = SOURCE_PRECEDENCE[newSource] ?? 0;
  return newRank > existingRank;
}
