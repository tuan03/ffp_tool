import assert from "node:assert/strict";
import test from "node:test";

import { fromCustomizationNormalizerProduct } from "../index";

const asin = "B012345678";

test("SKU is independent of variant order, option key order, store, price, and title", () => {
  const original = fromCustomizationNormalizerProduct({ asin, variants: [
    { price: 10, options: { Size: "M", Color: "Red" } },
    { price: 12, options: { Size: "L", Color: "Red" } },
  ] }, { vendor: "Store A" });
  const reordered = fromCustomizationNormalizerProduct({ asin, title: "New title", variants: [
    { price: 50, options: { Color: "Red", Size: "L" } },
    { price: 60, options: { Color: "Red", Size: "M" } },
  ] }, { vendor: "Store B" });
  assert.equal(original.variants?.[0].sku, reordered.variants?.[1].sku);
  assert.equal(original.variants?.[1].sku, reordered.variants?.[0].sku);
  assert.equal(original.variants?.[0].sku, "AMZ-B012345678-COLOR-RED-SIZE-M-E1AC7664F1491975", "SKU format must not drift between releases");
});

test("arbitrary store option axes, Unicode, punctuation and long labels produce distinct bounded ASCII SKUs", () => {
  const product = fromCustomizationNormalizerProduct({ asin, variants: [
    { price: 10, options: { "Chất liệu": "Vải mềm", Pattern: "A+B", Size: "x".repeat(200) } },
    { price: 10, options: { "Chất liệu": "Vải mềm", Pattern: "A B", Size: "x".repeat(200) } },
    { price: 10, options: { "Chất liệu": "Vải mềm", Pattern: "A-B", Size: "x".repeat(200) } },
    { price: 10, options: { "Chất liệu": "Vải mềm", Pattern: "🌻", Size: "x".repeat(200) } },
  ] });
  const skus = product.variants?.map(variant => variant.sku) ?? [];
  assert.equal(new Set(skus).size, 4);
  assert.ok(skus.every(sku => sku !== undefined && /^AMZ-B012345678-[A-Z0-9-]+$/.test(sku) && sku.length <= 80));
});

test("adding a punctuation-colliding choice does not change existing multi-variant SKUs", () => {
  const variants = [{ price: 10, options: { Print: "A+B" } }, { price: 10, options: { Print: "No" } }];
  const original = fromCustomizationNormalizerProduct({ asin, variants });
  const extended = fromCustomizationNormalizerProduct({ asin, variants: [...variants, { price: 10, options: { Print: "A B" } }] });
  assert.deepEqual(extended.variants?.slice(0, 2).map(variant => variant.sku), original.variants?.map(variant => variant.sku));
});

test("duplicate or insufficient Amazon variant identity fails before a Shopify write", () => {
  for (const variants of [
    [{ price: 10 }, { price: 12 }],
    [{ price: 10, options: { Size: "M" } }, { price: 12, options: { Size: "M" } }],
    [{ price: 10, options: { Size: " " } }, { price: 12, options: { Size: "L" } }],
  ]) {
    assert.throws(() => fromCustomizationNormalizerProduct({ asin, variants }), /AMAZON_VARIANT_SKU_INVALID/);
  }
});

test("single sellable Amazon variant keeps the base SKU, non-Amazon SKUs remain untouched", () => {
  assert.equal(fromCustomizationNormalizerProduct({ asin, variants: [{ price: 10, options: { Size: "M" } }] }).variants?.[0].sku, `AMZ-${asin}`);
  assert.deepEqual(fromCustomizationNormalizerProduct({ variants: [
    { price: 10, sku: "MERCHANT-M", options: { Size: "M" } },
    { price: 12, sku: "MERCHANT-L", options: { Size: "L" } },
  ] }).variants?.map(variant => variant.sku), ["MERCHANT-M", "MERCHANT-L"]);
});

test("large preset matrices keep distinct SKUs after projecting arbitrary source axes to three Shopify options", () => {
  const variants = Array.from({ length: 100 }, (_, number) => ({ price: 10, options: {
    Material: "Cotton", Size: `Size ${number}`, Print: number % 2 ? "Yes" : "No", Pack: "One", Edge: "Soft",
  } }));
  const product = fromCustomizationNormalizerProduct({ asin, variants });
  assert.equal(product.variants?.length, 100);
  assert.equal(new Set(product.variants?.map(variant => variant.sku)).size, 100);
  assert.ok(product.variants?.every(variant => variant.optionValues?.length === 3));
});

test("Unicode-equivalent option text has stable SKUs and filtered invalid-price rows do not take suffix positions", () => {
  const first = fromCustomizationNormalizerProduct({ asin, variants: [
    { price: 10, options: { Material: "Vải" } }, { price: 12, options: { Material: "Cotton" } },
  ] });
  const second = fromCustomizationNormalizerProduct({ asin, variants: [
    { options: { Material: "Skipped" } },
    { price: 10, options: { Material: "Vải".normalize("NFD") } }, { price: 20, options: { Material: "Cotton" } },
  ] });
  assert.deepEqual(first.variants?.map(variant => variant.sku), second.variants?.map(variant => variant.sku));
});
