import assert from "node:assert/strict";
import test from "node:test";

import { allocateKeywords } from "../internal/content-generation/keyword-allocator";
import type { KeywordCluster } from "../internal/domain-types";

test("B5 keyword allocator selects a safe category-relevant primary keyword", () => {
  const allocation = allocateKeywords({
    approvedKeywords: ["black cat t-shirt", "vintage halloween cat tee", "cute cat gift", "cat shirt amazon"],
    discardedKeywords: [], relevanceScores: { "black cat t-shirt": 0.95, "vintage halloween cat tee": 0.92, "cute cat gift": 0.85, "cat shirt amazon": 0.98 }, productCategory: "t-shirt",
  });
  assert.equal(allocation.primary, "black cat t-shirt");
  assert.ok(allocation.secondary.length > 0);
  assert.ok(!allocation.secondary.includes("cat shirt amazon"));
});

test("B5 keyword allocator excludes discarded keywords from every SEO tier", () => {
  const allocation = allocateKeywords({
    approvedKeywords: ["personalized music rug", "custom spotify carpet", "retro sound mat"],
    discardedKeywords: ["custom spotify carpet"], productCategory: "rug",
  });
  assert.equal(allocation.primary, "personalized music rug");
  assert.ok(!allocation.secondary.includes("custom spotify carpet"));
  assert.ok(!allocation.supportingKeywords.includes("custom spotify carpet"));
  assert.ok(!allocation.targetedKeywords.includes("custom spotify carpet"));
});

test("B5 keyword allocator keeps secondary keywords diverse across semantic clusters", () => {
  const keywordClusters: KeywordCluster[] = [
    { representative: "black cat halloween t-shirt", members: ["black cat halloween shirt", "retro spooky cat tee"] },
    { representative: "gift for cat lovers", members: ["gifts for cat lovers", "cat mom gift"] },
    { representative: "vintage witchy apparel", members: ["goth aesthetic clothing"] },
  ];
  const allocation = allocateKeywords({
    approvedKeywords: ["black cat halloween t-shirt", "black cat halloween shirt", "retro spooky cat tee", "gift for cat lovers", "vintage witchy apparel"],
    discardedKeywords: [], keywordClusters, productCategory: "t-shirt",
  });
  assert.equal(allocation.primary, "black cat halloween t-shirt");
  assert.ok(allocation.secondary.includes("gift for cat lovers"));
  assert.ok(allocation.secondary.includes("vintage witchy apparel"));
  assert.ok(!allocation.secondary.includes("black cat halloween shirt"));
});

test("B5 keyword allocator excludes B2 framing concepts from targeted SEO keywords", () => {
  const allocation = allocateKeywords({
    approvedKeywords: ["personalized music rug", "retro song floor rug"], discardedKeywords: [], productCategory: "rug",
    framingSources: { targetAudience: ["music producers", "audiophiles"], suitableOccasions: ["studio opening", "housewarming"], useCases: ["home studio decor"] },
  });
  assert.deepEqual(allocation.framingConcepts, ["music producers", "audiophiles", "studio opening", "housewarming", "home studio decor"]);
  for (const concept of allocation.framingConcepts) assert.ok(!allocation.targetedKeywords.includes(concept));
});
