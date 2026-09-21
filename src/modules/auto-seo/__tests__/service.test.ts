import assert from "node:assert/strict";
import test from "node:test";

import { getAutoSeoRunner, runAutoSeo } from "..";
import { autoSeoMockProducts } from "../mocks/data";
import { runMockAutoSeo } from "../mocks/runner";
import type {
  AutoSeoProductCandidate,
  AutoSeoProductImage,
  AutoSeoSelectionInput,
} from "../types";

const sampleProducts: readonly AutoSeoProductCandidate[] = [
  {
    productId: "gid://shopify/Product/1001",
    handle: "pod-ceramic-mug",
    title: "  POD Ceramic Coffee Mug  ",
    descriptionHtml:
      "<p>Durable 11oz ceramic mug with <strong>vibrant</strong> finish.</p>\n<div>Do not bleach.</div>",
    seoTitle: "POD Ceramic Coffee Mug | Best POD Mugs",
    seoDescription: "Shop our vibrant durable 11oz ceramic mug.",
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
    descriptionHtml:
      "<span>100% ringspun cotton.<br/>Classic unisex fit.</span>",
    seoTitle: null,
    seoDescription: null,
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
    descriptionHtml:
      '<div class="spec-details">Eco-friendly canvas material.</div>',
    images: [],
  },
];

test("1. runAutoSeo selects all products when no selection is provided", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-select-all",
    products: sampleProducts,
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
  assert.equal(item.sourceSeoTitle, "POD Ceramic Coffee Mug | Best POD Mugs");
  assert.equal(item.sourceSeoDescription, "Shop our vibrant durable 11oz ceramic mug.");
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
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 0);
  assert.equal(output.seoContentInputs.length, 0);
  assert.ok(output.warnings.length > 0);
  assert.ok(output.warnings.some((warning) => warning.toLowerCase().includes("empty")));
});

test("10. runAutoSeo maps seoTitle to sourceSeoTitle", async () => {
  const product: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/2001",
    handle: "custom-seo-title-product",
    title: "Custom Title",
    descriptionHtml: "<p>Description</p>",
    seoTitle: "Custom Shopify SEO Title",
    seoDescription: null,
    images: [],
  };

  const output = await runAutoSeo({
    workflowId: "wf-seo-title",
    products: [product],
  });

  assert.equal(output.seoContentInputs[0]?.sourceSeoTitle, "Custom Shopify SEO Title");
});

test("11. runAutoSeo maps seoDescription to sourceSeoDescription", async () => {
  const product: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/2002",
    handle: "custom-seo-desc-product",
    title: "Custom Title",
    descriptionHtml: "<p>Description</p>",
    seoTitle: null,
    seoDescription: "Custom Shopify Meta Description for search engines",
    images: [],
  };

  const output = await runAutoSeo({
    workflowId: "wf-seo-desc",
    products: [product],
  });

  assert.equal(
    output.seoContentInputs[0]?.sourceSeoDescription,
    "Custom Shopify Meta Description for search engines",
  );
});

test("12. missing seoTitle/seoDescription maps to null or undefined consistently", async () => {
  const productWithUndefinedSeo: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/2003",
    handle: "undefined-seo-product",
    title: "Undefined SEO",
    descriptionHtml: "<p>No SEO fields</p>",
    // seoTitle and seoDescription are undefined
    images: [],
  };

  const productWithNullSeo: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/2004",
    handle: "null-seo-product",
    title: "Null SEO",
    descriptionHtml: "<p>Explicit null SEO fields</p>",
    seoTitle: null,
    seoDescription: null,
    images: [],
  };

  const output = await runAutoSeo({
    workflowId: "wf-null-undefined-seo",
    products: [productWithUndefinedSeo, productWithNullSeo],
  });

  assert.equal(output.seoContentInputs[0]?.sourceSeoTitle, null);
  assert.equal(output.seoContentInputs[0]?.sourceSeoDescription, null);

  assert.equal(output.seoContentInputs[1]?.sourceSeoTitle, null);
  assert.equal(output.seoContentInputs[1]?.sourceSeoDescription, null);
});

test("13. output does not include niche", async () => {
  const product: AutoSeoProductCandidate = {
    productId: "gid://shopify/Product/2005",
    handle: "no-niche-product",
    title: "No Niche Product",
    descriptionHtml: "<p>Product without niche</p>",
    seoTitle: "SEO Title",
    seoDescription: "SEO Description",
    images: [],
  };

  const output = await runAutoSeo({
    workflowId: "wf-no-niche",
    products: [product],
  });

  const rawItem = output.seoContentInputs[0] as unknown as Record<string, unknown>;
  assert.equal("niche" in rawItem, false);
  assert.equal(rawItem.niche, undefined);

  const rawOutput = output as unknown as Record<string, unknown>;
  assert.equal("niche" in rawOutput, false);
  assert.equal(
    output.warnings.some((warning) => warning.toLowerCase().includes("niche")),
    false,
  );

  // Verify that even if input or product has obsolete runtime niche properties, it does not leak into output or warnings
  const productWithLingeringNiche = {
    ...product,
    productId: "gid://shopify/Product/2006",
    niche: "apparel",
  } as unknown as AutoSeoProductCandidate;

  const outputWithLingering = await runAutoSeo({
    workflowId: "wf-lingering-niche",
    products: [productWithLingeringNiche],
    ...({ niche: "storewide-niche" } as object),
  });

  const lingeringItem =
    outputWithLingering.seoContentInputs[0] as unknown as Record<string, unknown>;
  assert.equal("niche" in lingeringItem, false);
  assert.equal(lingeringItem.niche, undefined);
  assert.equal(
    "niche" in (outputWithLingering as unknown as Record<string, unknown>),
    false,
  );
  assert.equal(
    outputWithLingering.warnings.some((warning) =>
      warning.toLowerCase().includes("niche"),
    ),
    false,
  );
});

test("14. Selection should be deduplicated by productId when the same product is selected by both ID and handle", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-dedup",
    products: sampleProducts,
    selectedProductIds: ["gid://shopify/Product/1001"],
    selectedHandles: ["pod-ceramic-mug"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.selectedCount, 1);
  assert.equal(output.seoContentInputs.length, 1);
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/1001");
});

test("15. Image handling preserves image arrays intact without modification, sorting, or conversion", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-images",
    products: sampleProducts,
    selectedProductIds: ["gid://shopify/Product/1001", "gid://shopify/Product/1003"],
  };

  const output = await runAutoSeo(input);

  assert.equal(output.seoContentInputs.length, 2);
  assert.deepEqual(output.seoContentInputs[0]?.images, sampleProducts[0]?.images);
  assert.equal(output.seoContentInputs[0]?.images.length, 2);
  assert.equal(output.seoContentInputs[0]?.images[0]?.url, "https://example.com/mug-front.jpg");
  assert.equal(output.seoContentInputs[0]?.images[1]?.url, "https://example.com/mug-back.jpg");

  assert.deepEqual(output.seoContentInputs[1]?.images, []);
});

test("16. Mock runner returns AutoSeoOutput using deterministic mock data", async () => {
  const output = await runMockAutoSeo({
    workflowId: "mock-wf",
    products: [],
  });

  assert.equal(output.workflowId, "mock-wf");
  assert.equal(output.selectedCount, 3);
  assert.equal(output.seoContentInputs.length, 3);
  assert.ok(Array.isArray(output.warnings));
  assert.equal(output.seoContentInputs[0]?.productId, "gid://shopify/Product/100001");
  assert.equal(output.seoContentInputs[0]?.sourceSeoTitle, "Shopify Ceramic Mug | Best Drinkware");
  assert.equal(
    output.seoContentInputs[0]?.sourceSeoDescription,
    "High quality ceramic mug with durable print.",
  );
  assert.equal(output.seoContentInputs[1]?.sourceSeoTitle, null);
  assert.equal(output.seoContentInputs[1]?.sourceSeoDescription, null);
  assert.equal(output.seoContentInputs[2]?.sourceSeoTitle, null);
  assert.equal(output.seoContentInputs[2]?.sourceSeoDescription, null);
  assert.equal(
    output.seoContentInputs[0]?.sourceDescriptionHtml,
    "<p>Premium 11oz ceramic mug with <strong>glossy</strong> finish.</p>\n<div>Microwave and dishwasher safe.</div>",
  );
});

test("17. getAutoSeoRunner selects mock or real runner based on environment", async () => {
  const mockRunner = getAutoSeoRunner("mock");
  const devRunner = getAutoSeoRunner("development");
  const prodRunner = getAutoSeoRunner("production");

  assert.equal(mockRunner, runMockAutoSeo);
  assert.equal(devRunner, runAutoSeo);
  assert.equal(prodRunner, runAutoSeo);
});

test("18. Mock runner returns isolated copies that do not mutate fixtures", async () => {
  const firstOutput = await runMockAutoSeo({
    workflowId: "mock-wf-isolated-1",
    products: [],
  });

  const firstInput = firstOutput.seoContentInputs[0];
  assert.ok(firstInput !== undefined);
  assert.equal(firstInput.images.length, 2);

  // Attempt mutation on the returned images array
  const mutableImages = firstInput.images as AutoSeoProductImage[];
  mutableImages.push({ url: "https://mutated.example.com/hacked.jpg" });

  const secondOutput = await runMockAutoSeo({
    workflowId: "mock-wf-isolated-2",
    products: [],
  });

  // Verify second output and the source fixture are unaffected
  assert.equal(secondOutput.seoContentInputs[0]?.images.length, 2);
  assert.equal(autoSeoMockProducts[0]?.images.length, 2);
});

