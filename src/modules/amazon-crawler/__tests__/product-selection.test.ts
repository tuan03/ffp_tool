import assert from "node:assert/strict";
import test from "node:test";

import { amazonCrawlerMockOutput } from "../mocks/data";
import { firstProductMediaUrl, resolveSelectedProduct } from "../ui/product-selection";

test("product selection resolves the requested product and falls back after a new job", () => {
  const products = amazonCrawlerMockOutput.products;
  assert.equal(resolveSelectedProduct(products, "mock-matrix-ocean")?.id, "mock-matrix-ocean");
  assert.equal(resolveSelectedProduct(products, "missing-from-new-job")?.id, products[0]?.id);
  assert.equal(resolveSelectedProduct([], "missing"), null);
});

test("product gallery chooses the first image and supports products without media", () => {
  const productWithMedia = amazonCrawlerMockOutput.products.find((product) => product.media.length > 0) ?? null;
  const productWithoutMedia = amazonCrawlerMockOutput.products.find((product) => product.media.length === 0) ?? null;
  assert.equal(firstProductMediaUrl(productWithMedia), productWithMedia?.media[0]?.url ?? null);
  assert.equal(firstProductMediaUrl(productWithoutMedia), null);
});
