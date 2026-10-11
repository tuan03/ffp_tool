import assert from "node:assert/strict";
import test from "node:test";

import { createDryRunGateway, fromCustomizationNormalizerProduct, prepareShopifySyncProduct, syncSingleProduct } from "../index";
import type { ShopifyGateway } from "../index";
import type { CrawlProduct } from "../../customization-normalizer";

function productWithOptions(): CrawlProduct & { variants: { sku: string; price: number; options: Record<string, string> }[] } {
  const variants: { sku: string; price: number; options: Record<string, string> }[] = [];
  for (const size of ["Small", "Medium", "Large"]) {
    for (const print of ["1", "2", "3", "4", "5", "6"]) {
      for (const confirmation of ["Yes", "No"]) {
        for (const extra of ["None", "Matching"]) {
          variants.push({ sku: `sku-${variants.length}`, price: confirmation === "Yes" ? 17.95 : 18.95,
            options: { Size: size, Print: print, Confirmation: confirmation, Extra: extra } });
        }
      }
    }
  }
  return { id: "sample", title: "Sample", canonicalUrl: "https://amazon.com/dp/B012345678",
    parentAsin: "B012345678", variants };
}

test("four axes retain all 72 unique variants, prices and SKUs using three Shopify options", () => {
  const source = productWithOptions();
  const adapted = fromCustomizationNormalizerProduct(source);
  assert.equal(adapted.variants?.length, 72);
  const selections = adapted.variants?.map(v => JSON.stringify(v.optionValues));
  assert.equal(new Set(selections).size, 72);
  for (const [index, variant] of (adapted.variants ?? []).entries()) {
    assert.equal(variant.optionValues?.length, 3);
    assert.equal(variant.sku, `sku-${index}`);
    assert.equal(variant.price, source.variants[index].price.toFixed(2));
    assert.deepEqual(JSON.parse(variant.optionValues?.[2].name ?? "null"), [source.variants[index].options.Confirmation, source.variants[index].options.Extra]);
  }
  assert.equal(Object.keys(source.variants[0].options).length, 4);
});

test("three or fewer axes preserve the original names and values", () => {
  const adapted = fromCustomizationNormalizerProduct({ ...productWithOptions(), variants: [{ price: 10, options: { Size: "S", Color: "Red" } }] });
  assert.deepEqual(adapted.variants?.[0].optionValues, [{ optionName: "Size", name: "S" }, { optionName: "Color", name: "Red" }]);
});

test("projection refuses missing axes and overlong combined values without discarding choices", () => {
  const source = productWithOptions();
  assert.throws(() => fromCustomizationNormalizerProduct({ ...source, variants: [source.variants?.[0] ?? {}, { price: 10, options: { Size: "S" } }] }), /SHOPIFY_OPTION_PROJECTION_INVALID/);
  assert.throws(() => fromCustomizationNormalizerProduct({ ...source, variants: [{ price: 10, options: { A: "a", B: "b", C: "c".repeat(255), D: "d" } }] }), /SHOPIFY_OPTION_PROJECTION_INVALID/);
});

test("direct sync projects excessive options too", async () => {
  const dryRunGateway = createDryRunGateway();
  const gateway: ShopifyGateway = { ...dryRunGateway, createProduct: async input => {
    assert.equal(input.variants?.[0].optionValues?.length, 3);
    return dryRunGateway.createProduct(input);
  } };
  const result = await syncSingleProduct({ title: "Sample", descriptionHtml: "", amazonAsin: "B012345678", amazonParentAsin: "B012345678",
    variants: [{ price: "10.00", optionValues: ["A", "B", "C", "D"].map(optionName => ({ optionName, name: "Yes" })) }] }, { gateway, dryRun: true });
  assert.equal(result.success, true);
});

test("preflight validates required metadata and AEO before a worker obtains any write permit", () => {
  assert.throws(() => prepareShopifySyncProduct({ title: "Sample", descriptionHtml: "" }), /amazon_asin/);
  assert.throws(() => prepareShopifySyncProduct({ title: "Sample", descriptionHtml: "", amazonAsin: "B012345678", amazonParentAsin: "B012345678",
    aeo: { quickSummary: "Sample", faq: [{ question: "Sample?", answer: "Sample." }], jsonLd: "{}" } }), /AEO Schema.org/);
});

test("projection preserves the full customizer and handles more than four axes without delimiter collisions", () => {
  const source = productWithOptions();
  const customization = { hasCustomization: true, optionGroups: [{ id: "extra", label: "Extra", options: [] }], pricing: { currencyCode: "USD" } };
  const adapted = fromCustomizationNormalizerProduct({ ...source, customization, variants: [
    { price: 10, options: { A: "a", B: "b", C: "x | y", D: "z", E: "end" } },
    { price: 20, options: { A: "a", B: "b", C: "x", D: "y | z", E: "end" } },
  ] });
  assert.notEqual(adapted.variants?.[0].optionValues?.[2].name, adapted.variants?.[1].optionValues?.[2].name);
  assert.deepEqual(adapted.customization?.optionGroups, customization.optionGroups);
  assert.deepEqual(adapted.customization?.pricing, customization.pricing);
  assert.deepEqual(adapted.customization?.shopifyOptionProjection, { version: 1, retainedAxes: ["A", "B"], combinedAxes: ["C", "D", "E"], combinedOptionName: "Additional choices", encoding: "json-array" });
});

test("sync distinguishes a proven no-write rejection from timeout and partial write", async () => {
  for (const [failure, didNotWrite, requiresReconciliation] of [
    [Object.assign(new Error("Invalid input"), { details: { productWriteNotStarted: true } }), true, false],
    [new Error("Connection timed out"), false, true],
    [Object.assign(new Error("Partial write"), { code: "SHOPIFY_PARTIAL_WRITE", details: { productId: "gid://shopify/Product/1" } }), false, true],
  ] as const) {
    const gateway: ShopifyGateway = { ...createDryRunGateway(), createProduct: async () => { throw failure; } };
    const result = await syncSingleProduct({ title: "Sample", descriptionHtml: "", amazonAsin: "B012345678", amazonParentAsin: "B012345678" }, { gateway });
    assert.equal(result.success, false);
    assert.equal(result.productWriteNotStarted, didNotWrite);
    assert.equal(result.reconciliationRequired, requiresReconciliation);
  }
});
