import assert from "node:assert/strict";
import test from "node:test";

import {
  fromPinterestPodBatch,
  fromPinterestPodItem,
  runPinterestPodSeoPipeline,
  type PodDeliverableItem,
} from "../pinterest-pod-adapter";

import { TEST_SEO_OUTPUT, TEST_STORE_PROFILE } from "./test-profile";

const ITEM: PodDeliverableItem = {
  designId: "design-1",
  productType: "rug",
  originalPinTitle: "FORBIDDEN PIN TITLE",
  trendKeywords: ["FORBIDDEN TREND"],
  composedMockups: [
    { mockupUrl: "https://cdn.example.test/mockup.webp", detectedSceneDescription: "FORBIDDEN SCENE" },
    { mockupUrl: "https://cdn.example.test/mockup.webp" },
    { mockupUrl: "https://cdn.example.test/detail.webp" },
  ],
};

test("Pinterest adapter projects only image IDs/URLs, explicit niche and profile", () => {
  const input = fromPinterestPodItem(ITEM, "area rugs", TEST_STORE_PROFILE);
  assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
  assert.deepEqual(input.images.map((image) => image.url), [
    "https://cdn.example.test/mockup.webp",
    "https://cdn.example.test/detail.webp",
  ]);
  assert.ok(input.images.every((image) => /^image-[a-f0-9]{8}$/.test(image.id)));
  assert.deepEqual(
    fromPinterestPodItem(ITEM, "area rugs", TEST_STORE_PROFILE).images.map((image) => image.id),
    input.images.map((image) => image.id),
  );
  assert.equal(JSON.stringify(input).includes("FORBIDDEN"), false);
});

test("Pinterest batch and runner preserve V2 contract", async () => {
  const deliverables = { workflowId: "workflow", success: true, items: [ITEM] };
  assert.equal(fromPinterestPodBatch(deliverables, "rugs", TEST_STORE_PROFILE).length, 1);
  const result = await runPinterestPodSeoPipeline(deliverables, {
    storeProfile: TEST_STORE_PROFILE,
    defaultNiche: "rugs",
    runner: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
      return TEST_SEO_OUTPUT;
    },
  });
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 0);
});
