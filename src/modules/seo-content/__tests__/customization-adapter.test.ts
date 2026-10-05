import assert from "node:assert/strict";
import test from "node:test";

import type { CrawlProduct } from "../../customization-normalizer";
import {
  applySeoContentToCustomizationProduct,
  fromCustomizationBatch,
  fromCustomizationProduct,
  runCustomizationSeoPipeline,
} from "../customization-adapter";

import { TEST_SEO_OUTPUT, TEST_STORE_PROFILE } from "./test-profile";

const PRODUCT = {
  id: "product-1",
  title: "FORBIDDEN TITLE",
  description: "FORBIDDEN DESCRIPTION",
  handle: "existing-handle",
  categories: ["FORBIDDEN CATEGORY"],
  variants: [{ title: "FORBIDDEN VARIANT" }],
  media: [
    { id: "hero", kind: "image", url: "https://cdn.example.test/hero.webp", alt: "FORBIDDEN ALT" },
    { id: "video", kind: "video", url: "https://cdn.example.test/video.mp4" },
  ],
} as unknown as CrawlProduct;

test("Customization adapter emits exactly the V2 semantic contract", () => {
  const input = fromCustomizationProduct(PRODUCT, "bedding", TEST_STORE_PROFILE);
  assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
  assert.deepEqual(input.images, [{ id: "hero", url: "https://cdn.example.test/hero.webp" }]);
  assert.equal(JSON.stringify(input).includes("FORBIDDEN"), false);
});

test("Customization batch requires an explicit profile and preserves order", () => {
  const inputs = fromCustomizationBatch([PRODUCT, { ...PRODUCT, id: "product-2" }], "rugs", TEST_STORE_PROFILE);
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every((input) => input.storeProfile === TEST_STORE_PROFILE));
});

test("Customization output application preserves operational handle and does not inject variants", () => {
  const applied = applySeoContentToCustomizationProduct(PRODUCT, TEST_SEO_OUTPUT);
  assert.equal(applied.handle, "existing-handle");
  assert.equal(applied.title, TEST_SEO_OUTPUT.productTitle);
  assert.equal(JSON.stringify(applied).includes("FORBIDDEN VARIANT"), true);
  assert.equal(applied.seo?.title, TEST_SEO_OUTPUT.productSeoTitle);
});

test("Customization runner gives its runner V2-only inputs", async () => {
  const result = await runCustomizationSeoPipeline([PRODUCT], {
    storeProfile: TEST_STORE_PROFILE,
    defaultNiche: "bedding",
    runner: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
      return TEST_SEO_OUTPUT;
    },
  });
  assert.equal(result.successful, 1);
  assert.equal(result.failed, 0);
});
