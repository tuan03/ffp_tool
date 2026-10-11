import assert from "node:assert/strict";
import test from "node:test";

import { createDryRunGateway, fromCustomizationNormalizerProduct, syncSingleProduct } from "../index";
import type { ShopifyGateway } from "../index";

test("crawler variants use their own ASIN before the product or family ASIN", () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678", parentAsin: "B087654321",
    variants: [
      { asin: " b011111111 ", price: 10, sku: "old", options: { Size: "S" } },
      { sourceAsin: "b022222222", price: 12, options: { Size: "M" } },
      { price: 14, options: { Size: "L" } },
    ],
  });
  assert.deepEqual(product.variants?.map(variant => variant.sku), [
    "AMZ-B011111111", "AMZ-B022222222", "AMZ-B012345678",
  ]);
  assert.deepEqual(product.variants?.map(variant => variant.price), ["10.00", "12.00", "14.00"]);
});

test("customized variants from the same Amazon product share the requested SKU", () => {
  const product = fromCustomizationNormalizerProduct({
    customization: { source: { asin: "B012345678" } },
    variants: [{ price: 10, options: { Print: "Yes" } }, { price: 12, options: { Print: "No" } }],
  });
  assert.deepEqual(product.variants?.map(variant => variant.sku), ["AMZ-B012345678", "AMZ-B012345678"]);
});

test("source variant ASIN supplies the SKU when product ASIN is missing", () => {
  const product = fromCustomizationNormalizerProduct({
    sourceVariants: [{ asin: "B012345678" }], variants: [{ price: 10 }],
  });
  assert.equal(product.variants?.[0].sku, "AMZ-B012345678");
});

test("invalid variant ASIN falls back to a valid product ASIN", () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678", variants: [{ asin: "invalid", price: 10 }],
  });
  assert.equal(product.variants?.[0].sku, "AMZ-B012345678");
});

test("missing or invalid ASIN preserves existing SKU without using the family ASIN", () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "invalid", parentAsin: "B087654321",
    variants: [{ price: 10, sku: "merchant-sku" }, { price: 12, asin: "invalid" }],
  });
  assert.deepEqual(product.variants?.map(variant => variant.sku), ["merchant-sku", undefined]);
});

test("AMZ SKU survives projection of four axes without dropping variants", () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678",
    variants: ["Yes", "No"].map(print => ({ price: 10, options: { Size: "S", Color: "Red", Print: print, Extra: "None" } })),
  });
  assert.equal(product.variants?.length, 2);
  assert.ok(product.variants?.every(variant => variant.sku === "AMZ-B012345678" && variant.optionValues?.length === 3));
});

test("create and update sync writes receive the generated AMZ SKU", async () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678", parentAsin: "B087654321", title: "Sample",
    variants: [{ sourceAsin: "B011111111", price: 10 }],
  });
  const dryRunGateway = createDryRunGateway();
  let creates = 0;
  let updates = 0;
  const gateway: ShopifyGateway = {
    ...dryRunGateway,
    createProduct: async input => {
      creates += 1;
      assert.equal(input.variants?.[0].sku, "AMZ-B011111111");
      return dryRunGateway.createProduct(input);
    },
    updateProduct: async input => {
      updates += 1;
      assert.equal(input.variants?.[0].sku, "AMZ-B011111111");
      return { productId: input.productId, productHandle: "sample", createdVariantsCount: input.variants?.length ?? 0 };
    },
  };
  assert.equal((await syncSingleProduct(product, { gateway, dryRun: true })).success, true);
  assert.equal((await syncSingleProduct(product, { gateway, dryRun: true, existingProductId: "gid://shopify/Product/1" })).success, true);
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});
