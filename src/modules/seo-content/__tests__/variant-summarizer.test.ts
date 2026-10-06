import assert from "node:assert/strict";
import test from "node:test";

import { summarizeVariants } from "../internal/variant-summarizer";
import { buildContentFactSheet } from "../internal/content-generation/content-fact-sheet";
import { JEMINISE_BEDDING_PROFILE } from "../service";
import type { SeoPipelineContext } from "../internal/domain-types";

test("summarizeVariants handles undefined, null, or empty array safely", () => {
  const empty1 = summarizeVariants(undefined);
  assert.equal(empty1.variantCount, 0);
  assert.deepEqual(empty1.optionNames, []);
  assert.deepEqual(empty1.sampleVariants, []);
  assert.equal(empty1.minPrice, undefined);
  assert.equal(empty1.maxPrice, undefined);

  const empty2 = summarizeVariants([]);
  assert.equal(empty2.variantCount, 0);
  assert.deepEqual(empty2.optionNames, []);
  assert.deepEqual(empty2.sampleVariants, []);
  assert.equal(empty2.minPrice, undefined);
  assert.equal(empty2.maxPrice, undefined);
});

test("summarizeVariants gracefully skips non-object and null elements", () => {
  const malformed = summarizeVariants([null, undefined, 123, "invalid", true, {}]);
  // The empty object {} counts as an object record
  assert.equal(malformed.variantCount, 1);
  assert.equal(malformed.sampleVariants.length, 1);
  assert.equal(malformed.sampleVariants[0].title, "Variant 6");
  assert.equal(malformed.minPrice, undefined);
  assert.equal(malformed.maxPrice, undefined);
});

test("summarizeVariants processes a single variant correctly", () => {
  const variants = [
    {
      title: "Default Title",
      price: 24.99,
      sku: "SKU-DEFAULT-001",
      options: { Size: "Standard" },
    },
  ];

  const summary = summarizeVariants(variants);
  assert.equal(summary.variantCount, 1);
  assert.deepEqual(summary.optionNames, ["Size"]);
  assert.equal(summary.minPrice, 24.99);
  assert.equal(summary.maxPrice, 24.99);
  assert.equal(summary.sampleVariants.length, 1);
  assert.equal(summary.sampleVariants[0].title, "Default Title");
  assert.equal(summary.sampleVariants[0].price, "24.99");
  assert.equal(summary.sampleVariants[0].sku, "SKU-DEFAULT-001");
  assert.deepEqual(summary.sampleVariants[0].options, { Size: "Standard" });
});

test("summarizeVariants handles Shopify REST format (option1, option2, option3, string prices)", () => {
  const restVariants = [
    {
      id: 101,
      title: "Small / Blue",
      price: "$19.50",
      sku: "TSHIRT-S-BLU",
      option1: "Small",
      option2: "Blue",
      option3: null,
    },
    {
      id: 102,
      title: "Medium / Blue",
      price: "22.00",
      sku: "TSHIRT-M-BLU",
      option1: "Medium",
      option2: "Blue",
    },
    {
      id: 103,
      title: "Large / Red",
      price: "25.50",
      sku: "TSHIRT-L-RED",
      option1: "Large",
      option2: "Red",
    },
  ];

  const summary = summarizeVariants(restVariants);
  assert.equal(summary.variantCount, 3);
  assert.deepEqual(summary.optionNames, ["Option 1", "Option 2"]);
  assert.equal(summary.minPrice, 19.50);
  assert.equal(summary.maxPrice, 25.50);
  assert.equal(summary.sampleVariants.length, 3);
  assert.equal(summary.sampleVariants[0].title, "Small / Blue");
  assert.equal(summary.sampleVariants[0].price, "19.50");
  assert.equal(summary.sampleVariants[2].title, "Large / Red");
  assert.equal(summary.sampleVariants[2].price, "25.50");
});

test("summarizeVariants handles Shopify GraphQL format (selectedOptions, price object)", () => {
  const gqlVariants = [
    {
      id: "gid://shopify/ProductVariant/1",
      title: "Twin / White",
      price: { amount: "49.99", currencyCode: "USD" },
      sku: "BED-TW-WHT",
      selectedOptions: [
        { name: "Bed Size", value: "Twin" },
        { name: "Color", value: "White" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/2",
      title: "Queen / White",
      price: { amount: "69.99", currencyCode: "USD" },
      sku: "BED-QN-WHT",
      selectedOptions: [
        { name: "Bed Size", value: "Queen" },
        { name: "Color", value: "White" },
      ],
    },
    {
      id: "gid://shopify/ProductVariant/3",
      title: "King / Navy",
      price: { amount: "89.99", currencyCode: "USD" },
      sku: "BED-KG-NVY",
      selectedOptions: [
        { name: "Bed Size", value: "King" },
        { name: "Color", value: "Navy" },
      ],
    },
  ];

  const summary = summarizeVariants(gqlVariants);
  assert.equal(summary.variantCount, 3);
  assert.deepEqual(summary.optionNames, ["Bed Size", "Color"]);
  assert.equal(summary.minPrice, 49.99);
  assert.equal(summary.maxPrice, 89.99);
  assert.equal(summary.sampleVariants.length, 3);
  assert.deepEqual(summary.sampleVariants[0].options, {
    "Bed Size": "Twin",
    "Color": "White",
  });
  assert.equal(summary.sampleVariants[2].sku, "BED-KG-NVY");
});

test("summarizeVariants compacts large 100+ variant matrix into exactly 3 representative samples", () => {
  const largeVariants: Array<{
    title: string;
    price: number;
    sku: string;
    options: Record<string, string>;
  }> = [];

  const sizes = ["XS", "S", "M", "L", "XL"];
  const colors = ["Red", "Green", "Blue", "Black", "White", "Yellow", "Purple", "Orange"];
  const materials = ["Cotton", "Polyester", "Linen"];

  let count = 0;
  for (const size of sizes) {
    for (const color of colors) {
      for (const material of materials) {
        count++;
        largeVariants.push({
          title: `${size} / ${color} / ${material}`,
          price: 10 + count * 0.5,
          sku: `SKU-${count}`,
          options: { Size: size, Color: color, Material: material },
        });
      }
    }
  }

  assert.equal(largeVariants.length, 120);

  const summary = summarizeVariants(largeVariants);
  assert.equal(summary.variantCount, 120);
  assert.deepEqual(summary.optionNames, ["Size", "Color", "Material"]);
  assert.equal(summary.minPrice, 10.5);
  assert.equal(summary.maxPrice, 70);

  // Strictly up to 3 samples: index 0 (first), index 60 (middle), index 119 (last)
  assert.equal(summary.sampleVariants.length, 3);
  assert.equal(summary.sampleVariants[0].title, "XS / Red / Cotton");
  assert.equal(summary.sampleVariants[0].price, "10.50");
  assert.equal(summary.sampleVariants[0].sku, "SKU-1");

  assert.equal(summary.sampleVariants[1].title, largeVariants[60].title);
  assert.equal(summary.sampleVariants[1].sku, "SKU-61");

  assert.equal(summary.sampleVariants[2].title, "XL / Orange / Linen");
  assert.equal(summary.sampleVariants[2].price, "70.00");
  assert.equal(summary.sampleVariants[2].sku, "SKU-120");
});

test("buildContentFactSheet derives facts from V2 visual understanding and store profile", () => {
  const context: SeoPipelineContext = {
    source: {
      niche: "Bedding",
      images: [{ id: "hero", url: "https://example.com/quilt.jpg" }],
      storeProfile: JEMINISE_BEDDING_PROFILE,
    },
    storeProfile: JEMINISE_BEDDING_PROFILE,
    productUnderstanding: {
      physicalProductIdentity: "quilt bedding set",
      typography: { visibleTexts: [], styleSummary: "stitched geometric pattern" },
      visualEntities: "quilt with matching pillow shams",
      sceneContext: "bedroom",
      confidence: 0.95,
    },
  };

  const facts = buildContentFactSheet(context);
  assert.equal(facts.physicalProductIdentity, "quilt bedding set");
  assert.equal(facts.visualEntities, "quilt with matching pillow shams");
  assert.equal(facts.storeProfile?.profileId, "jeminise-bedding");
  assert.equal("variantSummary" in facts, false);
});
