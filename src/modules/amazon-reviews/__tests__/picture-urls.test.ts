import assert from "node:assert/strict";
import test from "node:test";

import { mergeReviewPictureUrls } from "../picture-urls";

test("review picture URLs combine generated and manual links without duplicates", () => {
  assert.deepEqual(mergeReviewPictureUrls(
    ["https://cdn.shopify.com/a.png", "https://cdn.shopify.com/a.png"],
    "https://cdn.shopify.com/b.png\ninvalid\nhttps://cdn.shopify.com/a.png",
  ), ["https://cdn.shopify.com/a.png", "https://cdn.shopify.com/b.png"]);
});
