import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { DefaultKeywordConflictAnalyzer } from "../internal/conflict-control/keyword-conflict-analyzer";
import { LocalTfidfVectorizer } from "../internal/conflict-control/local-tfidf-vectorizer";
import { FileSeoConflictCorpus } from "../internal/conflict-control/file-seo-conflict-corpus";
import { computeProductKey } from "../internal/conflict-control/seo-conflict-corpus";

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

test("computeProductKey isolates product keys by storeId", () => {
  const withStore = computeProductKey({ storeId: "store-alpha", productId: "prod-101" });
  assert.equal(withStore, "store:store-alpha:id:prod-101");

  const withoutStore = computeProductKey({ productId: "prod-101" });
  assert.equal(withoutStore, "id:prod-101");

  const handleWithStore = computeProductKey({ storeId: "store-beta", handle: "custom-mug" });
  assert.equal(handleWithStore, "store:store-beta:handle:custom-mug");
});

test("FileSeoConflictCorpus isolates corpus files and conflict lookups by storeId", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "seo-corpus-test-"));
  try {
    const corpus1 = new FileSeoConflictCorpus({ storeId: "store-us" });
    const corpus2 = new FileSeoConflictCorpus({ storeId: "store-uk" });

    assert.ok(corpus1.filePath.endsWith(".runtime/seo-conflict-corpus-store-us.json"));
    assert.ok(corpus2.filePath.endsWith(".runtime/seo-conflict-corpus-store-uk.json"));

    // Test conflict isolation within a shared corpus file
    const sharedFile = join(tempDir, "shared-corpus.json");
    const sharedCorpus = new FileSeoConflictCorpus({ filePath: sharedFile });

    // Store US registers "custom coffee mug"
    await sharedCorpus.upsertProduct({
      identity: { storeId: "store-us", productId: "prod-us-1", handle: "custom-mug" },
      title: "US Custom Mug",
      approvedKeywords: ["custom coffee mug"],
    });

    // Store UK checks for conflict on "custom coffee mug" -> MUST NOT CONFLICT
    const ukConflicts = await sharedCorpus.findConflicts({
      keyword: "custom coffee mug",
      owner: { storeId: "store-uk", productId: "prod-uk-1", handle: "uk-custom-mug" },
    });
    assert.equal(ukConflicts.length, 0);

    // Another product in Store US checks for conflict on "custom coffee mug" -> MUST CONFLICT
    const usConflicts = await sharedCorpus.findConflicts({
      keyword: "custom coffee mug",
      owner: { storeId: "store-us", productId: "prod-us-2", handle: "us-mug-2" },
    });
    assert.equal(usConflicts.length, 1);
    assert.equal(usConflicts[0]?.productId, "prod-us-1");

    // Same product in Store US checks -> self conflict ignored
    const selfConflicts = await sharedCorpus.findConflicts({
      keyword: "custom coffee mug",
      owner: { storeId: "store-us", productId: "prod-us-1", handle: "custom-mug" },
    });
    assert.equal(selfConflicts.length, 0);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});
