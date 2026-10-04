import assert from "node:assert/strict";
import test from "node:test";

import { createB2ShoppingContextStage } from "../internal/stages/b2-shopping-context";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";
import { JEMINISE_BEDDING_PROFILE } from "../service";

function createInput(niche: string) {
  return {
    images: [{ id: "hero", url: "https://example.com/product.jpg" }],
    niche,
    storeProfile: JEMINISE_BEDDING_PROFILE,
  };
}

test("B2 keeps scene-derived discovery hints separate from grounded shopping facts", async () => {
  const result = await createB2ShoppingContextStage({
    analyzer: { async analyze() { return { targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor", "music studios floor decor"], buyerIntentKeywords: ["personalized music rug", "music studio rug"] }; } },
  }).execute(evolveContext(createInitialContext(createInput("personalized rug")), {
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: ["Song Title", "Artist"], styleSummary: "white media-player labels" },
      visualEntities: "Media player interface with a surreal cloud-head portrait.",
      sceneContext: "Home studio with guitars, vinyl shelf and monitor speakers.",
    },
  }));

  assert.ok(result.shoppingContext?.buyerIntentKeywords.some((keyword) => keyword.includes("rug")));
  assert.deepEqual(result.shoppingContext?.sceneSearchSeeds, ["home studio area rug"]);
  assert.deepEqual(result.shoppingContext?.contextualAudienceHints, ["home studio decorators"]);
  assert.ok(!result.shoppingContext?.useCases.some((value) => value.includes("studio")));
  assert.ok(!result.shoppingContext?.buyerIntentKeywords.some((value) => value.includes("studio")));
});

test("B2 preserves a studio phrase when it is grounded by the niche and visual evidence", async () => {
  const result = await createB2ShoppingContextStage({
    analyzer: { async analyze() { return { targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["music studio floor decor"], buyerIntentKeywords: ["music studio area rug"] }; } },
  }).execute(evolveContext(createInitialContext(createInput("music studio rugs")), {
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Music player interface", sceneContext: "Home studio with guitars and monitor speakers.",
    },
  }));

  assert.deepEqual(result.shoppingContext?.useCases, ["music studio floor decor"]);
  assert.deepEqual(result.shoppingContext?.buyerIntentKeywords, ["music studio area rug"]);
});

test("B2 creates bounded discovery hints for a non-studio scene", async () => {
  const result = await createB2ShoppingContextStage({
    analyzer: { async analyze() { return { targetAudience: ["gift buyers"], suitableOccasions: ["gifting"], useCases: ["floor decor"], buyerIntentKeywords: ["personalized area rug"] }; } },
  }).execute(evolveContext(createInitialContext(createInput("personalized rug")), {
    productUnderstanding: {
      physicalProductIdentity: "area rug",
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "Custom portrait design", sceneContext: "Cozy bedroom with bedside tables and warm lighting.",
    },
  }));

  assert.deepEqual(result.shoppingContext?.contextualAudienceHints, ["bedroom decorators"]);
  assert.deepEqual(result.shoppingContext?.sceneSearchSeeds, ["bedroom area rug"]);
});
