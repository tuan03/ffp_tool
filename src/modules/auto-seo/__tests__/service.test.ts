import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors/app-error";
import { getAutoSeoClient, getAutoSeoRunner, mapShopifyProductToAutoSeoCandidate, runAutoSeo } from "..";
import { autoSeoMockProducts } from "../mocks/data";
import { MockAutoSeoClient, runMockAutoSeo } from "../mocks/runner";
import type {
  AutoSeoProductCandidate,
  AutoSeoProductImage,
  AutoSeoSelectionInput,
  ShopifyProductForAutoSeoUi,
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

test("1. runAutoSeo throws AUTO_SEO_NO_SELECTION when no selection is provided", async () => {
  const input: AutoSeoSelectionInput = {
    workflowId: "wf-no-selection",
    products: sampleProducts,
  };

  await assert.rejects(
    async () => {
      await runAutoSeo(input);
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_NO_SELECTION");
      return true;
    },
  );
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
    selectedProductIds: [productWithRawHtml.productId],
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
    selectedProductIds: ["gid://shopify/Product/9999"],
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
    selectedProductIds: [product.productId],
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
    selectedProductIds: [product.productId],
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
    selectedProductIds: [productWithUndefinedSeo.productId, productWithNullSeo.productId],
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
    selectedProductIds: [product.productId],
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
    selectedProductIds: [productWithLingeringNiche.productId],
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
    selectedProductIds: [
      "gid://shopify/Product/100001",
      "gid://shopify/Product/100002",
      "gid://shopify/Product/100003",
    ],
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

test("16b. Mock runner rejects empty selection with AUTO_SEO_NO_SELECTION", async () => {
  await assert.rejects(
    async () => {
      await runMockAutoSeo({
        workflowId: "mock-wf-empty",
        products: [],
        selectedProductIds: [],
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_NO_SELECTION");
      return true;
    },
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
    selectedProductIds: ["gid://shopify/Product/100001"],
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
    selectedProductIds: ["gid://shopify/Product/100001"],
  });

  // Verify second output and the source fixture are unaffected
  assert.equal(secondOutput.seoContentInputs[0]?.images.length, 2);
  assert.equal(autoSeoMockProducts[0]?.images.length, 2);
});

test("19. mapShopifyProductToAutoSeoCandidate maps fields, seo, and sets 1-based image position", () => {
  const shopifyProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/12345",
    handle: "test-rug",
    title: "Test Rug Title",
    descriptionHtml: "<p>Hello world</p>",
    status: "ACTIVE",
    seo: {
      title: "Seo Rug Title",
      description: "Seo Rug Description",
    },
    images: [
      { url: "https://example.com/img1.jpg", altText: "First Image" },
      { url: "https://example.com/img2.jpg", altText: "Second Image" },
    ],
  };

  const candidate = mapShopifyProductToAutoSeoCandidate(shopifyProduct);

  assert.equal(candidate.productId, "gid://shopify/Product/12345");
  assert.equal(candidate.handle, "test-rug");
  assert.equal(candidate.title, "Test Rug Title");
  assert.equal(candidate.descriptionHtml, "<p>Hello world</p>");
  assert.equal(candidate.seoTitle, "Seo Rug Title");
  assert.equal(candidate.seoDescription, "Seo Rug Description");
  assert.equal(candidate.images.length, 2);
  assert.equal(candidate.images[0]?.url, "https://example.com/img1.jpg");
  assert.equal(candidate.images[0]?.altText, "First Image");
  assert.equal(candidate.images[0]?.position, 1);
  assert.equal(candidate.images[1]?.url, "https://example.com/img2.jpg");
  assert.equal(candidate.images[1]?.position, 2);
});

test("20. mapShopifyProductToAutoSeoCandidate handles missing description and empty images gracefully", () => {
  const shopifyProduct = {
    id: "gid://shopify/Product/999",
    handle: "blank-sample",
    title: "Blank Sample",
  };

  const candidate = mapShopifyProductToAutoSeoCandidate(shopifyProduct);

  assert.equal(candidate.descriptionHtml, "");
  assert.equal(candidate.seoTitle, null);
  assert.equal(candidate.seoDescription, null);
  assert.deepEqual(candidate.images, []);
});

test("21. MockAutoSeoClient returns deep copies and runs workflow properly without niche", async () => {
  const client = new MockAutoSeoClient();
  const products1 = await client.loadProducts();
  assert.ok(products1.length >= 4);

  const originalTitle = products1[0]?.title;
  (products1 as unknown as Record<string, unknown>[])[0]!.title = "Mutated Title";

  const products2 = await client.loadProducts();
  assert.equal(products2[0]?.title, originalTitle);

  const candidates = products2.map(mapShopifyProductToAutoSeoCandidate);
  const result = await client.runAutoSeo({
    workflowId: "wf_mock_test",
    products: candidates,
    selectedProductIds: [products2[0]!.id],
  });

  assert.equal(result.selectedCount, 1);
  assert.equal(result.seoContentInputs[0]?.productId, products2[0]!.id);
  assert.equal(result.seoContentInputs[0]?.sourceTitle, originalTitle);
  const rawItem = result.seoContentInputs[0] as unknown as Record<string, unknown>;
  assert.equal("niche" in rawItem, false);
});


test("22. getAutoSeoClient selects MockAutoSeoClient for mock and throws deprecation for dev/prod", () => {
  const mockClient = getAutoSeoClient("mock");
  assert.ok(mockClient instanceof MockAutoSeoClient);

  assert.throws(
    () => getAutoSeoClient("development"),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.match(err.message, /Direct AutoSeoClient construction is deprecated/);
      return true;
    },
  );

  assert.throws(
    () => getAutoSeoClient("production"),
    (err) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.match(err.message, /Direct AutoSeoClient construction is deprecated/);
      return true;
    },
  );
});

test("23. mapShopifyProductToAutoSeoCandidate maps null image altText/width/height cleanly", () => {
  const shopifyProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/9999",
    handle: "null-image-fields",
    title: "Null Image Fields Product",
    descriptionHtml: "<p>Null images test</p>",
    seo: {
      title: null,
      description: null,
    },
    images: [
      {
        id: "gid://shopify/ProductImage/1",
        url: "https://example.com/null-alt.jpg",
        altText: null,
        width: null,
        height: null,
      },
    ],
  };

  const candidate = mapShopifyProductToAutoSeoCandidate(shopifyProduct);
  assert.equal(candidate.productId, "gid://shopify/Product/9999");
  assert.equal(candidate.seoTitle, null);
  assert.equal(candidate.seoDescription, null);
  assert.equal(candidate.images.length, 1);
  assert.equal(candidate.images[0]?.url, "https://example.com/null-alt.jpg");
  assert.equal(candidate.images[0]?.altText, undefined);
  assert.equal(candidate.images[0]?.position, 1);
});

test("24. MockAutoSeoClient supports multi-store listStores, active store, and store-specific products", async () => {
  const client = new MockAutoSeoClient();
  const stores = await client.listStores!();
  assert.equal(stores.length, 2);
  assert.equal(stores[0].storeId, "store-chillgen-mock");
  assert.equal(stores[1].storeId, "capozen");

  // Default store
  const defaultInfo = await client.getStoreInfo();
  assert.equal(defaultInfo.storeId, "store-chillgen-mock");

  // Switch to Capozen
  client.setActiveStoreId!("capozen");
  assert.equal(client.getActiveStoreId!(), "capozen");

  const capozenInfo = await client.getStoreInfo();
  assert.equal(capozenInfo.storeId, "capozen");
  assert.equal(capozenInfo.shopDomain, "capozen.myshopify.com");

  const capozenProducts = await client.loadProducts("capozen");
  assert.ok(capozenProducts.length > 0);
  assert.ok(capozenProducts.every((p) => p.vendor === "Capozen" && p.title.startsWith("[Capozen]")));

  // Passing explicit storeId to getStoreInfo
  const chillgenInfo = await client.getStoreInfo("store-chillgen-mock");
  assert.equal(chillgenInfo.storeId, "store-chillgen-mock");
});

test("25. MockAutoSeoClient scopes detail and hydration by storeId", async () => {
  const client = new MockAutoSeoClient();
  const sampleId = "gid://shopify/Product/8123456789001";

  // Load detail for default store (ChillGen)
  const chillgenDetail = await client.loadProductDetail(sampleId);
  assert.equal(chillgenDetail.vendor, "CHILLGEN");
  assert.ok(!chillgenDetail.title.startsWith("[Capozen]"));

  // Load detail for Capozen store
  const capozenDetail = await client.loadProductDetail("capozen", sampleId);
  assert.equal(capozenDetail.vendor, "Capozen");
  assert.ok(capozenDetail.title.startsWith("[Capozen]"));

  // Verify cached details are properly isolated
  const cachedChillgen = client.getCachedDetail?.(sampleId, "store-chillgen-mock");
  assert.equal(cachedChillgen?.vendor, "CHILLGEN");

  const cachedCapozen = client.getCachedDetail?.(sampleId, "capozen");
  assert.equal(cachedCapozen?.vendor, "Capozen");

  // Verify hydration for Capozen
  const hydrated = await client.hydrateSelectedProductsFresh([sampleId], 2, "capozen");
  assert.equal(hydrated.length, 1);
  assert.equal(hydrated[0].vendor, "Capozen");
});

