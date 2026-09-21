import assert from "node:assert/strict";
import test from "node:test";

import { getAutoSeoRunner, runAutoSeo } from "..";
import { runMockAutoSeo } from "../mocks/runner";
import type { AutoSeoProductCandidate, AutoSeoSelectionInput } from "../types";

const sampleProducts: readonly AutoSeoProductCandidate[] = [
  {
    productId: "gid://shopify/Product/1001",
    handle: "pod-ceramic-mug",
    title: "  POD Ceramic Coffee Mug  ",
    descriptionHtml: "<p>Durable 11oz ceramic mug with <strong>vibrant</strong> finish.</p>\n<div>Do not bleach.</div>",
    niche: "drinkware",
    images: [
      {
        url: "https://example.com/mug-front.jpg",
        altText: "Front view of ceramic mug",
        position: 1,
      },
      {
        url: "https://example.com/mug-back.jpg",
        altText: "Back view of ceramic mug",
        position: 2,
      },
    ],
  },
  {
    productId: "gid://shopify/Product/1002",
    handle: "pod-cotton-tshirt",
    title: " Heavyweight Cotton T-Shirt\t",
    descriptionHtml: "<span>100% ringspun cotton.<br/>Classic unisex fit.</span>",
    images: [
      {
        url: "https://example.com/shirt.jpg",
        altText: "Shirt on model",
        position: 1,
      },
    ],
  },
  {
    productId: "gid://shopify/Product/1003",
    handle: "pod-canvas-tote",
    title: "Eco Canvas Tote Bag",
    descriptionHtml: "<div class=\"spec-details\">Eco-friendly canvas material.</div>",
    images: [],
  },
];

test("1. runAutoSeo selects all products when no selection is provided", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-select-all",
    products: sampleProducts,
    niche: "custom-print",
  };

  const output = await runAutoSeo(input);

  assert.equal(output.workflowId, "wf-select-all");
  assert.equal(output.selectedCount, 3);
  assert.equal(output.seoContentInputs.length, 3);
});

test("2. runAutoSeo selects one product by productId", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-select-by-id",
    products: sampleProducts,
    niche: "custom-print",
    selectedProductIds: ["gid://shopify/Product/1002"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 1);
  assert.equal(output.seoContentInputs.length, 1);
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/1002");
  assert.equal(output.seoContentInputs[0]?.handle, "pod-cotton-tshirt");
});

test("3. runAutoSeo selects multiple products by handle", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-select-by-handle",
    products: sampleProducts,
    niche: "custom-print",
    selectedHandles: ["pod-ceramic-mug", "pod-canvas-tote"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 2);
  const handles = output.seoContentInputs.map((item) => item.handle);
  assert.deepEqual(handles, ["pod-ceramic-mug", "pod-canvas-tote"]);
});

test("4. runAutoSeo maps selected products into seoContentInputs", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-map-inputs",
    products: sampleProducts,
    niche: "custom-merch",
    selectedProductIds: ["gid://shopify/Product/1001", "gid://shopify/Product/1003"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 2);
  assert.equal(output.seoContentInputs.length, 2);
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/1001");
  assert.equal(output.seoContentInputs[1]?.productId, "gid://shopify/Product/1003");
});

test("5. Each seoContentInputs item maps required fields correctly", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-field-mapping",
    products: sampleProducts,
    niche: "custom-merch",
    selectedProductIds: ["gid://shopify/Product/1001"],
  };

  const output = await runAutoSeo(input);
  const item = output.seoContentInputs[0];
  assert.ok(item !== undefined);

  assert.equal(item.productId, "gid://shopify/Product/1001");
  assert.equal(item.handle, "pod-ceramic-mug");
  assert.equal(item.sourceTitle, "POD Ceramic Coffee Mug");
  assert.equal(
    item.sourceDescriptionHtml,
    "<p>Durable 11oz ceramic mug with <strong>vibrant</strong> finish.</p>\n<div>Do not bleach.</div>",
  );
  assert.deepEqual(item.images, sampleProducts[0]?.images);
});

test("6. runAutoSeo preserves descriptionHtml exactly without stripping, sanitizing, or rewriting", async () => {
  const rawHtmlWithComplexTags =
    '<div id="main" class="product-body"><p>Test paragraph with &quot;special characters&quot; &amp; tags.</p><script>alert("keep")</script><style>.test{color:red}</style></div>';

  const productWithRawHtml: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/9999",
    handle: "raw-html-product",
    title: "Raw HTML Product",
    descriptionHtml: rawHtmlWithComplexTags,
    images: [],
  };

  const input: AutoSeoSelectionInput = {
    workflowId: "wf-preserve-html",
    products: [productWithRawHtml],
    niche: "gifts",
  };

  const output = await runAutoSeo(input);
  const item = output.seoContentInputs[0];
  assert.ok(item !== undefined);

  assert.equal(item.sourceDescriptionHtml, rawHtmlWithComplexTags);
});

test("7. Missing selected productId creates a warning and does not crash", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-missing-id",
    products: sampleProducts,
    niche: "custom-merch",
    selectedProductIds: ["gid://shopify/Product/non-existent-9999"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 0);
  assert.equal(output.seoContentInputs.length, 0);
  assert.ok(output.warnings.length > 0);
  assert.ok(
    output.warnings.some((warning) => warning.includes("gid://shopify/Product/non-existent-9999")),
  );
});

test("8. Missing selected handle creates a warning and does not crash", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-missing-handle",
    products: sampleProducts,
    niche: "custom-merch",
    selectedHandles: ["non-existent-handle-foo"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 0);
  assert.equal(output.seoContentInputs.length, 0);
  assert.ok(output.warnings.length > 0);
  assert.ok(
    output.warnings.some((warning) => warning.includes("non-existent-handle-foo")),
  );
});

test("9. Empty product list returns selectedCount 0 and warning", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-empty-products",
    products: [],
    niche: "general",
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 0);
  assert.equal(output.seoContentInputs.length, 0);
  assert.ok(output.warnings.length > 0);
  assert.ok(output.warnings.some((warning) => warning.toLowerCase().includes("empty")));
});

test("10. Empty niche returns warning but still maps products", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-empty-niche",
    products: [sampleProducts[1] as AutoSeoProductCandidate],
    niche: "   ",
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 1);
  assert.equal(output.seoContentInputs.length, 1);
  assert.ok(output.warnings.length > 0);
  assert.ok(output.warnings.some((warning) => warning.toLowerCase().includes("niche")));
});

test("11. Product-level niche overrides input niche", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-niche-override",
    products: [
      sampleProducts[0] as AutoSeoProductCandidate, // Has niche: "drinkware"
      sampleProducts[1] as AutoSeoProductCandidate, // Has no product-level niche
    ],
    niche: "fallback-niche",
  };

  const output = await runAutoSeo(input);

  assert.equal(output.seoContentInputs[0]?.niche, "drinkware");
  assert.equal(output.seoContentInputs[1]?.niche, "fallback-niche");
});

test("12. Selection should be deduplicated by productId when the same product is selected by both ID and handle", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-dedup",
    products: sampleProducts,
    niche: "custom-merch",
    selectedProductIds: ["gid://shopify/Product/1001"],
    selectedHandles: ["pod-ceramic-mug"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 1);
  assert.equal(output.seoContentInputs.length, 1);
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/1001");
});

test("13. Mock runner returns AutoSeoOutput using deterministic mock data", async () => {
  const output = await runMockAutoSeo({
    workflowId: "mock-wf",
    products: [],
    niche: "",
  });

  assert.equal(output.workflowId, "mock-wf");
  assert.equal(output.selectedCount, 3);
  assert.equal(output.seoContentInputs.length, 3);
  assert.ok(Array.isArray(output.warnings));
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/100001");
  assert.equal(
    output.seoContentInputs[0]?.sourceDescriptionHtml,
    "<p>Premium 11oz ceramic mug with <strong>glossy</strong> finish.</p>\n<div>Microwave and dishwasher safe.</div>",
  );
});

test("14. getAutoSeoRunner selects mock or real runner based on environment", async () => {
  const mockRunner = getAutoSeoRunner("mock");
  const devRunner = getAutoSeoRunner("development");
  const prodRunner = getAutoSeoRunner("production");

  assert.equal(mockRunner, runMockAutoSeo);
  assert.equal(devRunner, runAutoSeo);
  assert.equal(prodRunner, runAutoSeo);
});

