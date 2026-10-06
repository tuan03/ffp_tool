import assert from "node:assert/strict";
import test from "node:test";

import { runMockSeoContent } from "../mocks/runner";
import { seoContentMockInput } from "../mocks/data";
import { createFallbackProcessedImages } from "../internal/pipeline-context";

test("SEO mock runner conforms to the V2 input without reading a source handle", async () => {
  const result = await runMockSeoContent(seoContentMockInput);
  assert.ok(result.productTitle);
  assert.equal(result.images.length, 2);
  assert.equal(Object.keys(seoContentMockInput).sort().join(","), "images,niche,storeProfile");
});

test("fallback image output never reads old alt text or handle", () => {
  const images = createFallbackProcessedImages({
    images: [{ id: "stable-image-id", url: "https://cdn.example.test/hero.webp" }],
    niche: "rugs",
    storeProfile: seoContentMockInput.storeProfile,
  }, {
    productTitle: "Grounded Rug",
    productDescription: "<p>Grounded.</p>",
    productSeoTitle: "Grounded Rug",
    productSeoDescription: "Grounded rug.",
  });
  assert.equal(images[0].alt, "Grounded Rug - View 1");
  assert.equal(images[0].webp.filename, "stable-image-id.webp");
});
