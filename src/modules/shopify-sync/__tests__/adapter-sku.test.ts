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
  assert.match(product.variants?.[0].sku ?? "", /^AMZ-B011111111-[A-F0-9]{8}$/);
  assert.match(product.variants?.[1].sku ?? "", /^AMZ-B022222222-[A-F0-9]{8}$/);
  assert.match(product.variants?.[2].sku ?? "", /^AMZ-B012345678-[A-F0-9]{8}$/);
  assert.deepEqual(product.variants?.map(variant => variant.price), ["10.00", "12.00", "14.00"]);
});

test("customized variants from the same Amazon product have distinct stable SKUs", () => {
  const product = fromCustomizationNormalizerProduct({
    customization: { source: { asin: "B012345678" } },
    variants: [{ price: 10, options: { Print: "Yes" } }, { price: 12, options: { Print: "No" } }],
  });
  assert.match(product.variants?.[0].sku ?? "", /^AMZ-B012345678-[A-F0-9]{8}$/);
  assert.match(product.variants?.[1].sku ?? "", /^AMZ-B012345678-[A-F0-9]{8}$/);
  assert.notEqual(product.variants?.[0].sku, product.variants?.[1].sku);
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

test("Jeminise bedding preset restores option order after JSONB reorders object keys", () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678",
    preset: "jeminise_bedding_v3",
    variants: [{
      price: 64.9,
      options: {
        Size: "Twin (173 x 218 cm)",
        "Set Options": "No Pillowcases",
        "Bedding Type": "Comforter",
      },
    }],
  });

  assert.deepEqual(product.variants?.[0].optionValues, [
    { optionName: "Bedding Type", name: "Comforter" },
    { optionName: "Size", name: "Twin (173 x 218 cm)" },
    { optionName: "Set Options", name: "No Pillowcases" },
  ]);
});

test("legacy Jeminise bedding preset normalizes Comforter size labels", () => {
  const legacySizes = [
    'Twin (68" x 86")',
    'Full (79" x 90")',
    'Queen (90" x 90")',
    'King (90" x 104")',
  ];
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678",
    preset: "jeminise_bedding_v2",
    variants: legacySizes.map((size) => ({
      price: 64.9,
      options: {
        Size: size,
        "Set Options": "No Pillowcases",
        "Bedding Type": "Comforter",
      },
    })),
  });

  assert.deepEqual(
    product.variants?.map((variant) => variant.optionValues?.[1].name),
    ["Twin (173 x 218 cm)", "Full (200 x 230 cm)", "Queen (228 x 228 cm)", "King (228 x 264 cm)"],
  );
  assert.ok(product.variants?.every((variant) =>
    variant.optionValues?.[0].optionName === "Bedding Type" &&
    variant.optionValues[1].optionName === "Size" &&
    variant.optionValues[2].optionName === "Set Options"
  ));
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
  assert.ok(product.variants?.every(variant => variant.sku?.startsWith("AMZ-B012345678-") && variant.optionValues?.length === 3));
  assert.notEqual(product.variants?.[0].sku, product.variants?.[1].sku);
});

test("create and update sync writes receive the generated AMZ SKU", async () => {
  const product = fromCustomizationNormalizerProduct({
    asin: "B012345678", parentAsin: "B087654321", title: "Sample",
    variants: [
      { sourceAsin: "B011111111", price: 10, options: { Size: "M" } },
      { sourceAsin: "B011111111", price: 12, options: { Size: "L" } },
    ],
  });
  const dryRunGateway = createDryRunGateway();
  let creates = 0;
  let updates = 0;
  const gateway: ShopifyGateway = {
    ...dryRunGateway,
    createProduct: async input => {
      creates += 1;
      assert.deepEqual(input.variants?.map(variant => variant.sku), product.variants?.map(variant => variant.sku));
      assert.equal(new Set(input.variants?.map(variant => variant.sku)).size, 2);
      return dryRunGateway.createProduct(input);
    },
    updateProduct: async input => {
      updates += 1;
      assert.deepEqual(input.variants?.map(variant => variant.sku), product.variants?.map(variant => variant.sku));
      assert.equal(new Set(input.variants?.map(variant => variant.sku)).size, 2);
      return { productId: input.productId, productHandle: "sample", createdVariantsCount: input.variants?.length ?? 0 };
    },
  };
  assert.equal((await syncSingleProduct(product, { gateway, dryRun: true })).success, true);
  assert.equal((await syncSingleProduct(product, { gateway, dryRun: true, existingProductId: "gid://shopify/Product/1" })).success, true);
  assert.equal(creates, 1);
  assert.equal(updates, 1);
});
