import test from "node:test";
import assert from "node:assert/strict";

import { allocateKeywords } from "../internal/content-generation/keyword-allocator";
import type { KeywordCluster } from "../internal/domain-types";

test("Keyword Allocator: selects primary keyword matching category and relevance", () => {
  const approvedKeywords = [
    "black cat t-shirt",
    "vintage halloween cat tee",
    "cute cat gift",
    "cat shirt amazon",
  ];
  const relevanceScores = {
    "black cat t-shirt": 0.95,
    "vintage halloween cat tee": 0.92,
    "cute cat gift": 0.85,
    "cat shirt amazon": 0.98, // surface-unsafe phrase
  };

  const allocation = allocateKeywords({
    approvedKeywords,
    discardedKeywords: [],
    relevanceScores,
    productCategory: "t-shirt",
  });

  // "cat shirt amazon" has highest relevance but is surface-unsafe (marketplace)
  // Therefore "black cat t-shirt" must be chosen as Primary
  assert.equal(allocation.primary, "black cat t-shirt");
  assert.ok(allocation.secondary.length > 0);
  assert.ok(!allocation.secondary.includes("cat shirt amazon"));
});

test("Keyword Allocator: excludes discarded keywords strictly from all tiers", () => {
  const approvedKeywords = [
    "personalized music rug",
    "custom spotify carpet",
    "retro sound mat",
  ];
  const discardedKeywords = ["custom spotify carpet"];

  const allocation = allocateKeywords({
    approvedKeywords,
    discardedKeywords,
    productCategory: "rug",
  });

  assert.equal(allocation.primary, "personalized music rug");
  assert.ok(!allocation.secondary.includes("custom spotify carpet"));
  assert.ok(!allocation.supportingKeywords.includes("custom spotify carpet"));
  assert.ok(!allocation.targetedKeywords.includes("custom spotify carpet"));
});

test("Keyword Allocator: enforces cluster diversity for secondary keywords", () => {
  const approvedKeywords = [
    "black cat halloween t-shirt", // primary candidate
    "black cat halloween shirt",  // cluster 1 (duplicate intent)
    "retro spooky cat tee",       // cluster 1 (duplicate intent)
    "gift for cat lovers",        // cluster 2
    "vintage witchy apparel",     // cluster 3
  ];

  const keywordClusters: KeywordCluster[] = [
    {
      representative: "black cat halloween t-shirt",
      members: ["black cat halloween shirt", "retro spooky cat tee"],
    },
    {
      representative: "gift for cat lovers",
      members: ["gifts for cat lovers", "cat mom gift"],
    },
    {
      representative: "vintage witchy apparel",
      members: ["goth aesthetic clothing"],
    },
  ];

  const allocation = allocateKeywords({
    approvedKeywords,
    discardedKeywords: [],
    keywordClusters,
    productCategory: "t-shirt",
  });

  assert.equal(allocation.primary, "black cat halloween t-shirt");
  // Secondary must prefer candidates from distinct clusters
  assert.ok(allocation.secondary.includes("gift for cat lovers"));
  assert.ok(allocation.secondary.includes("vintage witchy apparel"));
  assert.ok(!allocation.secondary.includes("black cat halloween shirt"));
});

test("Keyword Allocator: returns undefined primary when no candidate meets safety criteria", () => {
  const approvedKeywords = [
    "best cheap sale", // unsafe promo
    "amazon coupon discount", // unsafe marketplace
    "shirt", // only 1 word (< 2 words)
    "this is an extremely long keyword query phrase that has way too many words to be a primary", // > 8 words
  ];

  const allocation = allocateKeywords({
    approvedKeywords,
    discardedKeywords: [],
    productCategory: "apparel",
  });

  assert.equal(allocation.primary, undefined);
  // targetedKeywords still functions cleanly
  assert.ok(Array.isArray(allocation.targetedKeywords));
});

test("Keyword Allocator: separates B2 framing concepts from SEO targetedKeywords", () => {
  const approvedKeywords = ["personalized music rug", "retro song floor rug"];

  const allocation = allocateKeywords({
    approvedKeywords,
    discardedKeywords: [],
    productCategory: "rug",
    framingSources: {
      targetAudience: ["music producers", "audiophiles"],
      suitableOccasions: ["studio opening", "housewarming"],
      useCases: ["home studio decor"],
    },
  });

  assert.equal(allocation.primary, "personalized music rug");
  assert.deepEqual(allocation.framingConcepts, [
    "music producers",
    "audiophiles",
    "studio opening",
    "housewarming",
    "home studio decor",
  ]);

  // Framing concepts must NOT be registered as SEO targetedKeywords in corpus
  for (const concept of allocation.framingConcepts) {
    assert.ok(!allocation.targetedKeywords.includes(concept));
  }
});
