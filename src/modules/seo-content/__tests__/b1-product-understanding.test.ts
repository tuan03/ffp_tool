import assert from "node:assert/strict";
import test from "node:test";

import { createInitialContext } from "../internal/pipeline-context";
import { createB1ProductUnderstandingStage } from "../internal/stages/b1-product-understanding";

import { TEST_STORE_PROFILE } from "./test-profile";

const input = {
  images: [
    { id: "hero", url: "https://cdn.example.test/hero.webp" },
    { id: "detail", url: "https://cdn.example.test/detail.webp" },
  ],
  niche: "area rugs",
  storeProfile: TEST_STORE_PROFILE,
};

test("B1 sends every image plus niche, and accepts one confident grounded identity", async () => {
  let received: unknown;
  const stage = createB1ProductUnderstandingStage({
    maxImages: 1,
    imageAnalyzer: { async analyze(value) {
      received = value;
      return {
        typography: { visibleTexts: ["VALHALLA"], styleSummary: "bold serif" },
        visualEntities: "Viking shield artwork",
        sceneContext: "living room",
        physicalProductIdentity: "area rug",
        identityCandidates: ["area rug"],
        excludedSceneEntities: ["sofa"],
        confidence: 0.96,
        reviewRequired: false,
      };
    } },
  });
  const result = await stage.execute(createInitialContext(input));
  assert.deepEqual(Object.keys(received as object).sort(), ["images", "niche"]);
  assert.equal((received as { readonly images: readonly unknown[] }).images.length, 2);
  assert.equal(result.productUnderstanding?.physicalProductIdentity, "area rug");
});

test("B1 fails closed when pixels are unavailable", async () => {
  const stage = createB1ProductUnderstandingStage({
    imageAnalyzer: { async analyze() { throw new Error("read failed"); } },
  });
  await assert.rejects(stage.execute(createInitialContext(input)), /IMAGE_EVIDENCE_UNAVAILABLE/);
});

test("B1 fails closed when images disagree about sold product", async () => {
  const stage = createB1ProductUnderstandingStage({
    imageAnalyzer: { async analyze() { return {
      typography: { visibleTexts: [], styleSummary: "unknown" },
      visualEntities: "mixed objects",
      sceneContext: "room",
      physicalProductIdentity: "area rug",
      identityCandidates: ["area rug", "wall art"],
      excludedSceneEntities: [],
      confidence: 0.6,
      reviewRequired: true,
    }; } },
  });
  await assert.rejects(stage.execute(createInitialContext(input)), /PRODUCT_IDENTITY_AMBIGUOUS/);
});
