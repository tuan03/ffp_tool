import { evolveContext } from "../pipeline-context";

import type {
  SearchResearchResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export async function executeB3SearchSuggestions(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const buyerIntent = context.shoppingContext?.buyerIntentKeywords ?? [];
  const titleTokens = context.source.title.trim().split(/\s+/).filter(Boolean).slice(0, 3);
  const niche = context.source.niche.trim();

  const rawSeeds = [niche, ...titleTokens, ...buyerIntent].filter(Boolean);
  const seedKeywords = Array.from(new Set(rawSeeds));

  const suggestedQueries = seedKeywords.map((keyword) => `${keyword} ideas`);
  const querySources: Record<string, string> = {};
  for (const keyword of seedKeywords) {
    querySources[keyword] = "niche_seed";
  }
  for (const query of suggestedQueries) {
    querySources[query] = "google_suggest";
  }

  const searchResearch: SearchResearchResult = {
    seedKeywords,
    suggestedQueries,
    querySources,
  };

  return evolveContext(context, { searchResearch });
}

export const b3SearchSuggestionsStage: SeoPipelineStage = {
  name: "b3",
  execute: executeB3SearchSuggestions,
};
