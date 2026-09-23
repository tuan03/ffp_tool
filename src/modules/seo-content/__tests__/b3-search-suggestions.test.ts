import assert from "node:assert/strict";
import test from "node:test";

import { QUERY_SOURCE } from "../internal/search-suggestions/query-source";
import { GoogleSearchSuggestionsCollector } from "../internal/search-suggestions/google-search-suggestions-collector";
import { selectSearchSeeds } from "../internal/search-suggestions/search-seed-selector";

test("B3 labels scene context as discovery-only provenance", () => {
  const seeds = selectSearchSeeds({
    source: { title: "Music Player Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Media player interface", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor"],
      buyerIntentKeywords: ["personalized music rug"], sceneSearchSeeds: ["home studio rug"],
    },
  });
  assert.deepEqual(seeds.find((seed) => seed.query === "home studio rug"), {
    query: "home studio rug", source: QUERY_SOURCE.SCENE_CONTEXT_SEED,
  });
});

test("B3 preserves scene-only provenance when Google expands a scene seed", async () => {
  const collector = new GoogleSearchSuggestionsCollector({
    client: { async getSuggestions(seed) { return seed === "guitar amplifier decor" ? ["guitar amplifier wall decor"] : []; } },
    interRequestDelayMs: 0,
  });
  const result = await collector.collect({
    source: { title: "Music Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor"],
      buyerIntentKeywords: [], sceneSearchSeeds: ["guitar amplifier decor"],
    },
  });
  assert.equal(result.querySources["guitar amplifier wall decor"], QUERY_SOURCE.SCENE_CONTEXT_SEED);
});
