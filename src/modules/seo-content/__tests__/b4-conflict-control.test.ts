import assert from "node:assert/strict";
import test from "node:test";

import { DefaultKeywordConflictAnalyzer } from "../internal/conflict-control/keyword-conflict-analyzer";
import { LocalTfidfVectorizer } from "../internal/conflict-control/local-tfidf-vectorizer";

test("B4 discards a scene-only discovery candidate lacking product evidence", async () => {
  const result = await new DefaultKeywordConflictAnalyzer({ fallbackEmbeddingProvider: new LocalTfidfVectorizer() }).analyze({
    source: { title: "Personalized Music Player Area Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Media player interface", sceneContext: "Home studio with guitar amplifiers",
    },
    searchResearch: {
      seedKeywords: ["guitar amplifiers"], suggestedQueries: [],
      querySources: { "guitar amplifiers": "scene_context_seed" },
    },
  });
  assert.deepEqual(result.approvedKeywords, []);
  assert.equal(result.conflictReasons["guitar amplifiers"], "scene_context_only");
});

test("B4 keeps a supported area-rug keyword out of the category-conflict path", async () => {
  const result = await new DefaultKeywordConflictAnalyzer({ fallbackEmbeddingProvider: new LocalTfidfVectorizer() }).analyze({
    source: { title: "Personalized Music Player Area Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Media player interface", sceneContext: "unknown",
    },
    searchResearch: {
      seedKeywords: ["personalized music rug"], suggestedQueries: [],
      querySources: { "personalized music rug": "buyer_intent_seed" },
    },
  });

  assert.notEqual(result.conflictReasons["personalized music rug"], "category_conflict");
});

test("B4 rejects a mixed scene seed when its scene claim is unsupported by product evidence", async () => {
  const result = await new DefaultKeywordConflictAnalyzer({ fallbackEmbeddingProvider: new LocalTfidfVectorizer() }).analyze({
    source: { title: "Personalized Music Player Area Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] },
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Media player interface", sceneContext: "Home studio with guitars and monitor speakers",
    },
    searchResearch: {
      seedKeywords: ["home studio area rug"], suggestedQueries: [],
      querySources: { "home studio area rug": "scene_context_seed" },
    },
  });

  assert.deepEqual(result.approvedKeywords, []);
  assert.equal(result.conflictReasons["home studio area rug"], "scene_context_only");
});
