import assert from "node:assert/strict";
import test from "node:test";

import { prepareShopifySyncProduct, syncSingleProduct, createDryRunGateway } from "../index";
import type { ShopifySyncProductInput } from "../types";

function fixture(): ShopifySyncProductInput {
  return {
    sourcePlatform: "etsy", etsyListingId: "1234567890", title: "Sweater", descriptionHtml: "",
    customizerAuditStatus: "verified_custom",
    variants: Array.from({ length: 8 }, (_, i) => ({
      price: `${24 + i}.00`, compareAtPrice: "50.00", sku: `ETSY-1234567890-SIZE${i}`,
      etsyProductId: `1234567${i}`, inventoryTracked: false,
      optionValues: [{ optionName: "Size", name: `Size ${i}` }],
    })),
    customization: {
      hasCustomization: true,
      optionGroups: ["Color", "Skin tone"].map((label, index) => ({
        id: `question-${index}`, label, required: true,
        options: Array.from({ length: 6 }, (_, i) => ({ id: `value-${i}`, label: `${label} ${i}`, price: { amount: 0 } })),
      })),
      textInputs: [], imageInputs: [], conditionalRules: [],
    },
  };
}

test("Etsy dropdowns expand eight source variants into 288 unique stable variants without mutating the source", () => {
  const source = fixture();
  const before = structuredClone(source);
  const projected = prepareShopifySyncProduct(source);
  assert.equal(projected.variants?.length, 288);
  assert.equal(new Set(projected.variants?.map(v => v.sku)).size, 288);
  assert.deepEqual(projected.options, ["Size", "Color", "Skin tone"]);
  assert.equal(projected.customization, null);
  assert.equal(projected.customizerAuditStatus, "verified_static");
  assert.equal(projected.variants?.filter(v => v.etsyProductId === "12345670").length, 36);
  assert.ok(projected.variants?.filter(v => v.etsyProductId === "12345670").every(v => v.price === "24.00" && v.compareAtPrice === "50.00"));
  assert.deepEqual(source, before);
  assert.deepEqual(prepareShopifySyncProduct(projected), projected);
  const reversed = prepareShopifySyncProduct({ ...source, variants: [...(source.variants ?? [])].reverse(),
    customization: { ...source.customization, hasCustomization: true,
      optionGroups: source.customization?.optionGroups?.map(g => ({ ...g, options: [...(g.options as readonly unknown[])].reverse() })).reverse() } });
  assert.deepEqual(projected.variants?.map(v => v.sku).sort(), reversed.variants?.map(v => v.sku).sort());
});

test("Etsy optional choices include none while freeform fields remain in Customizer", () => {
  const source = fixture();
  const projected = prepareShopifySyncProduct({ ...source, customization: { hasCustomization: true,
    textInputs: [{ id: "name", label: "Name" }], imageInputs: [{ id: "photo" }],
    controlOrder: [{ type: "option", id: "color" }, { type: "text", id: "name" }],
    optionGroups: [{ id: "color", label: "Color", required: false, options: [{ id: "red", label: "Red" }] }],
  } });
  assert.equal(projected.variants?.length, 16);
  assert.equal(projected.customizerAuditStatus, "verified_custom");
  assert.deepEqual(projected.customization?.optionGroups, []);
  assert.equal(projected.customization?.textInputs?.length, 1);
  assert.deepEqual(projected.customization?.controlOrder, [{ type: "text", id: "name" }]);
});

test("Etsy projection blocks excess axes, excess combinations, ambiguous labels, fees and dependent fields", () => {
  const source = fixture();
  const group = { id: "a", label: "Extra", required: true, options: [{ id: "x", label: "X" }] };
  for (const customization of [
    { ...source.customization, optionGroups: [...(source.customization?.optionGroups ?? []), group] },
    { ...source.customization, optionGroups: [{ ...group, label: "Size" }] },
    { ...source.customization, conditionalRules: [{ dependsOn: "a" }] },
    { optionGroups: [{ ...group, options: [{ id: "x", label: "X", price: { amount: 5 } }] }] },
    { optionGroups: [{ ...group, options: [] }] },
    { optionGroups: [{ ...group, options: Array.from({length: 300}, (_, i) => ({ id: String(i), label: String(i) })) }] },
  ]) {
    assert.throws(() => prepareShopifySyncProduct({ ...source, customization: { ...customization, hasCustomization: true } }), /ETSY_PERSONALIZATION/);
  }
});

test("Etsy sync reads store limits before any mutation and does not remove Customizer on rejection", async () => {
  let writes = 0;
  const gateway = { ...createDryRunGateway(),
    async getVariantLimits() { return { maxProductOptions: 3, maxProductVariants: 100 }; },
    async createProduct() { writes++; throw new Error("must not write"); },
    async deleteProductMetafield() { writes++; return {success:true}; },
  };
  const result = await syncSingleProduct(fixture(), { gateway });
  assert.equal(result.success, false);
  assert.equal(result.productWriteNotStarted, true);
  assert.match(result.error ?? "", /288.*100/);
  assert.equal(writes, 0);
});
