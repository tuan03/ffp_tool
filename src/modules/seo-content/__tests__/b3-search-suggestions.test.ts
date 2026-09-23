import assert from "node:assert/strict";
import test from "node:test";

import { QUERY_SOURCE } from "../internal/search-suggestions/query-source";
import { buildKeywordCandidates } from "../internal/conflict-control/keyword-candidate";
import { GeminiSearchQueryVariantGenerator } from "../internal/search-suggestions/gemini-search-query-variant-generator";
import { GoogleSearchSuggestionsCollector } from "../internal/search-suggestions/google-search-suggestions-collector";
import { FakeGeminiContentGenerator } from "../internal/product-understanding/gemini-content-generator";
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

test("B3 generates only valid prefix probes from each product-grounded seed", async () => {
  const generator = new FakeGeminiContentGenerator();
  generator.setTextHandler(() => ({
    rawText: JSON.stringify({
      variantGroups: [
        {
          seedIndex: 0,
          variants: [
            "personalized music player rug",
            "music moon",
            "music player ru",
            "music player ru",
            "music ru",
          ],
        },
      ],
    }),
  }));
  const variantGenerator = new GeminiSearchQueryVariantGenerator({ generator });

  const variants = await variantGenerator.generate({
    seeds: [{ query: "personalized music player rug", source: QUERY_SOURCE.BUYER_INTENT_SEED }],
    source: { niche: "personalized rug", title: "Personalized Music Player Rug" },
  });

  assert.deepEqual(variants, [{
    seedQuery: "personalized music player rug",
    variants: ["music player ru", "music ru"],
  }]);
});

test("B3 queries original seeds before Gemini probes, excludes scene probes, and keeps probes out of B4 candidates", async () => {
  const calls: string[] = [];
  const collector = new GoogleSearchSuggestionsCollector({
    client: {
      async getSuggestions(query) {
        calls.push(query);
        return query === "music player ru" ? ["music player rug"] : [];
      },
    },
    variantGenerator: {
      async generate() {
        return [
          {
            seedQuery: "personalized music player rug",
            variants: ["music player ru", "personalized rug"],
          },
          {
            seedQuery: "home studio rug",
            variants: ["studio ru"],
          },
          {
            seedQuery: "personalized rug",
            variants: ["music ru"],
          },
        ];
      },
    },
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { title: "Music Player Rug", niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "unknown",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "Home studio",
    },
    shoppingContext: {
      targetAudience: [], suitableOccasions: [], useCases: [],
      buyerIntentKeywords: ["personalized music player rug"],
      sceneSearchSeeds: ["home studio rug"],
    },
  });

  assert.deepEqual(calls, [
    "personalized music player rug",
    "home studio rug",
    "personalized rug",
    "music player ru",
    "music ru",
  ]);
  assert.deepEqual(result.autocompleteProbes, [
    { query: "personalized music player rug", parentSeed: "personalized music player rug", kind: "original" },
    { query: "home studio rug", parentSeed: "home studio rug", kind: "original" },
    { query: "personalized rug", parentSeed: "personalized rug", kind: "original" },
    { query: "music player ru", parentSeed: "personalized music player rug", kind: "gemini_variant" },
    { query: "music ru", parentSeed: "personalized rug", kind: "gemini_variant" },
  ]);
  assert.deepEqual(result.suggestedQueries, ["music player rug"]);
  assert.deepEqual(
    buildKeywordCandidates(result).map((candidate) => candidate.keyword),
    [
      "personalized music player rug",
      "home studio rug",
      "personalized rug",
      "music player rug",
    ],
  );
});

test("B3 falls back to original seeds when Gemini variant generation fails", async () => {
  const calls: string[] = [];
  const collector = new GoogleSearchSuggestionsCollector({
    client: {
      async getSuggestions(query) {
        calls.push(query);
        return [];
      },
    },
    variantGenerator: {
      async generate() {
        throw new Error("Vertex unavailable");
      },
    },
    onVariantGenerationFailure: () => undefined,
    interRequestDelayMs: 0,
  });

  const result = await collector.collect({
    source: { niche: "personalized rug" },
    productUnderstanding: {
      physicalProductIdentity: "unknown",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "unknown", sceneContext: "unknown",
    },
  });

  assert.deepEqual(calls, ["personalized rug"]);
  assert.deepEqual(result.autocompleteProbes, [
    { query: "personalized rug", parentSeed: "personalized rug", kind: "original" },
  ]);
});
