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
