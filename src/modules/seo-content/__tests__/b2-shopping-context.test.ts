import assert from "node:assert/strict";
import test from "node:test";

import { createB2ShoppingContextStage } from "../internal/stages/b2-shopping-context";
import { createInitialContext, evolveContext } from "../internal/pipeline-context";

test("B2 keeps scene-derived discovery hints separate from grounded shopping facts", async () => {
  const result = await createB2ShoppingContextStage({
    analyzer: { async analyze() { return { targetAudience: ["music lovers"], suitableOccasions: ["gifting"], useCases: ["home decor", "music studios floor decor"], buyerIntentKeywords: ["personalized music rug", "music studio rug"] }; } },
  }).execute(evolveContext(createInitialContext({ title: "Personalized Music Player Area Rug", description: "", niche: "personalized rug", handle: "music-rug", images: [] }), {
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
