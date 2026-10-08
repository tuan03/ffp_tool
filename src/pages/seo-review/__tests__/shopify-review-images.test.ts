import assert from "node:assert/strict";
import test from "node:test";

import { restoreShopifyReviewImageIds } from "../shopify-review-images";
import type { SeoImageUiViewModel } from "../types";

function image(id: string, url: string): SeoImageUiViewModel {
  const field = (value: string) => ({ value, source: "real" as const });
  return { id, previewUrl: field(url), alt: field("Approved ALT"), webpUrl: field(url), webpFilename: field("image.webp") };
}

test("restores legacy IDs by source URL, preserving approved edits and image order", () => {
  const images = [image("img-0-old", "https://cdn.shopify.com/b.jpg?width=600"), image("img-1-old", "https://cdn.shopify.com/a.jpg")];
  const restored = restoreShopifyReviewImageIds(images, [
    { id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/a.jpg" },
    { id: "gid://shopify/MediaImage/2", url: "https://cdn.shopify.com/b.jpg" },
  ]);
  assert.deepEqual(restored.map(entry => entry.id), ["gid://shopify/MediaImage/2", "gid://shopify/MediaImage/1"]);
  assert.equal(restored[0]?.alt, images[0]?.alt);
  assert.equal(images[0]?.id, "img-0-old");
});

test("does not guess IDs by array position or accept ambiguous URL matches", () => {
  const images = [image("img-old", "https://cdn.shopify.com/a.jpg")];
  assert.equal(restoreShopifyReviewImageIds(images, [{ id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/b.jpg" }])[0]?.id, "img-old");
  assert.equal(restoreShopifyReviewImageIds(images, [
    { id: "gid://shopify/MediaImage/1", url: "https://cdn.shopify.com/a.jpg" },
    { id: "gid://shopify/MediaImage/2", url: "https://cdn.shopify.com/a.jpg" },
  ])[0]?.id, "img-old");
});

test("preserves real IDs and rejects unknown or non-media source IDs", () => {
  const images = [image("gid://shopify/MediaImage/9", "https://cdn.shopify.com/a.jpg"), image("img-old", "https://cdn.shopify.com/b.jpg")];
  const restored = restoreShopifyReviewImageIds(images, [null, { id: "gid://shopify/ProductImage/2", url: "https://cdn.shopify.com/b.jpg" }]);
  assert.deepEqual(restored.map(entry => entry.id), images.map(entry => entry.id));
});
