import assert from "node:assert/strict";
import test from "node:test";

import { fromAutoSeoBatch, fromAutoSeoProduct, runAutoSeoPipeline } from "../auto-seo-adapter";

import { TEST_SEO_OUTPUT, TEST_STORE_PROFILE } from "./test-profile";

const SOURCE = {
  id: "gid://shopify/Product/1",
  title: "FORBIDDEN TITLE",
  descriptionHtml: "FORBIDDEN DESCRIPTION",
  handle: "forbidden-handle",
  productType: "FORBIDDEN PRODUCT TYPE",
  tags: ["FORBIDDEN TAG"],
  variants: [{ title: "FORBIDDEN VARIANT" }],
  images: [
    { id: "hero", url: "https://cdn.example.test/hero.webp", altText: "FORBIDDEN ALT" },
    { id: "duplicate", url: "https://cdn.example.test/hero.webp" },
    { url: "https://cdn.example.test/detail.webp" },
  ],
};

test("Auto SEO adapter projects exactly images, niche and storeProfile", () => {
  const input = fromAutoSeoProduct(SOURCE, "bedding", TEST_STORE_PROFILE);
  assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
  assert.deepEqual(input.images.map((image) => image.url), [
    "https://cdn.example.test/hero.webp",
    "https://cdn.example.test/detail.webp",
  ]);
  assert.equal(input.images[0]?.id, "hero");
  assert.match(input.images[1]?.id ?? "", /^image-[a-f0-9]{8}$/);
  assert.equal(fromAutoSeoProduct(SOURCE, "bedding", TEST_STORE_PROFILE).images[1]?.id, input.images[1]?.id);
  assert.equal(input.niche, "bedding");
  assert.equal(JSON.stringify(input).includes("FORBIDDEN"), false);
});

test("Auto SEO batch preserves order and explicit profile", () => {
  const inputs = fromAutoSeoBatch([SOURCE, { ...SOURCE, id: "2" }], "rugs", TEST_STORE_PROFILE);
  assert.equal(inputs.length, 2);
  assert.ok(inputs.every((input) => input.storeProfile === TEST_STORE_PROFILE));
});

test("Auto SEO runner keeps every queued input V2-only", async () => {
  const result = await runAutoSeoPipeline([SOURCE, { ...SOURCE, id: "2" }], {
    storeProfile: TEST_STORE_PROFILE,
    defaultNiche: "bedding",
    runner: async (input) => {
      assert.deepEqual(Object.keys(input).sort(), ["images", "niche", "storeProfile"]);
      return TEST_SEO_OUTPUT;
    },
  });
  assert.equal(result.total, 2);
  assert.equal(result.successful, 2);
  assert.equal(result.failed, 0);
});
