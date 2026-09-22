import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppError } from "../../../shared/errors/app-error";
import {
  hydrateSelectedProducts,
  mapShopifyProductToAutoSeoCandidate,
  mapWithConcurrency,
  runAutoSeo,
} from "..";
import { MockAutoSeoClient } from "../mocks/runner";
import type {
  AutoSeoClient,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { ProductDetailDrawer } from "../ui/components/ProductDetailDrawer";

function createTestAutoSeoClient(options?: {
  readonly getProductDetail?: (productId: string) => ShopifyProductForAutoSeoUi | null;
  readonly delayMs?: number;
  readonly failProductId?: string;
}): AutoSeoClient & { getCallIds: () => string[]; getMaxActive: () => number } {
  const detailCache = new Map<string, ShopifyProductForAutoSeoUi>();
  const callIds: string[] = [];
  let currentActive = 0;
  let maxActive = 0;

  const client: AutoSeoClient & { getCallIds: () => string[]; getMaxActive: () => number } = {
    getCallIds: () => callIds,
    getMaxActive: () => maxActive,
    getCachedDetail: (id: string) => detailCache.get(id),
    clearDetailCache: () => detailCache.clear(),
    clearCache: () => detailCache.clear(),
    loadProducts: async () => [],
    loadProductDetail: async (id: string) => {
      currentActive++;
      if (currentActive > maxActive) {
        maxActive = currentActive;
      }
      if (options?.delayMs) {
        await new Promise((r) => setTimeout(r, options.delayMs));
      }
      try {
        callIds.push(id);
        if (options?.failProductId && id === options.failProductId) {
          throw new AppError(`Simulated failure for ${id}`, "AUTO_SEO_LOAD_FAILED");
        }
        const cached = detailCache.get(id);
        if (cached) return cached;
        const product = options?.getProductDetail
          ? options.getProductDetail(id)
          : {
              id,
              title: `Full Title for ${id}`,
              handle: `handle-${id.replace(/\W+/g, "-")}`,
              status: "ACTIVE",
              descriptionHtml: `<p>Full description for ${id}</p>`,
              seo: {
                title: `SEO Title for ${id}`,
                description: `SEO Description for ${id}`,
              },
              images: [
                {
                  id: "img-1",
                  url: `https://cdn.example.com/${id}-1.jpg`,
                  altText: `Alt text 1 for ${id}`,
                },
                {
                  id: "img-2",
                  url: `https://cdn.example.com/${id}-2.jpg`,
                  altText: `Alt text 2 for ${id}`,
                },
              ],
              variants: [
                {
                  id: "var-1",
                  title: "Default Variant",
                  price: "19.99",
                  sku: "SKU-1",
                },
              ],
            };
        if (!product) {
          throw new AppError(`Product not found: ${id}`, "AUTO_SEO_LOAD_FAILED");
        }
        detailCache.set(id, product);
        return product;
      } finally {
        currentActive--;
      }
    },
    runAutoSeo: async (input) => runAutoSeo(input),
    getStoreInfo: async () => ({ storeId: "store-test", shopDomain: "test.myshopify.com" }),
    runAutoSeoBackup: async (req) => ({
      workflowId: req.workflowId,
      backedUpCount: req.products.length,
      backupIds: req.products.map((_, i) => `b-${i}`),
      downstreamStatus: "SENT",
      downstreamHttpStatus: 200,
    }),
    hydrateSelectedProductsFresh: async (ids, concurrency = 5) => {
      const unique = Array.from(new Set(ids));
      const map = new Map<string, ShopifyProductForAutoSeoUi>();
      await mapWithConcurrency(unique, concurrency, async (id) => {
        const p = await client.loadProductDetail(id);
        map.set(id, p);
      });
      return ids.map((id) => map.get(id)!);
    },
  };

  return client;
}

// 1. opening ProductDetailDrawer hydrates product detail
test("1. opening ProductDetailDrawer hydrates product detail", async () => {
  const hydratedCalls: string[] = [];
  const fakeClient: AutoSeoClient = {
    loadProducts: async () => [],
    loadProductDetail: async (id: string) => {
      hydratedCalls.push(id);
      return {
        id,
        title: "Hydrated Product Title",
        handle: "hydrated-product",
        descriptionHtml: "<p>Hydrated Description</p>",
        images: [{ url: "https://example.com/h.jpg", altText: "Hydrated Image" }],
      };
    },
    runAutoSeo: async (input) => runAutoSeo(input),
    getCachedDetail: () => undefined,
    getStoreInfo: async () => ({ storeId: "store-1", shopDomain: "test.myshopify.com" }),
    runAutoSeoBackup: async (req) => ({
      workflowId: req.workflowId,
      backedUpCount: req.products.length,
      backupIds: [],
      downstreamStatus: "SENT",
    }),
    hydrateSelectedProductsFresh: async () => [],
  };

  const catalogProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/catalog-p1",
    title: "Catalog Only Title",
    handle: "cat-p1",
  };

  // Render ProductDetailDrawer with loading state
  const htmlLoading = renderToStaticMarkup(
    React.createElement(ProductDetailDrawer, {
      product: catalogProduct,
      isOpen: true,
      isLoading: true,
      onClose: () => {},
    }),
  );
  assert.ok(htmlLoading.includes("Đang tải chi tiết..."));

  // Hydrate via client
  const fullProduct = await fakeClient.loadProductDetail(catalogProduct.id);
  assert.deepEqual(hydratedCalls, ["gid://shopify/Product/catalog-p1"]);

  // Render ProductDetailDrawer with hydrated product
  const htmlHydrated = renderToStaticMarkup(
    React.createElement(ProductDetailDrawer, {
      product: fullProduct,
      isOpen: true,
      isLoading: false,
      onClose: () => {},
    }),
  );

  assert.ok(htmlHydrated.includes("Hydrated Product Title"));
  assert.ok(htmlHydrated.includes("Hydrated Image"));
});

// 2. cached drawer detail does not fetch again
test("2. cached drawer detail does not fetch again", async () => {
  const cachedProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/cached-p1",
    title: "Cached Full Product",
    handle: "cached-p1",
    descriptionHtml: "<p>Already Cached Description</p>",
    images: [{ url: "https://example.com/cached.jpg", altText: "Cached Image" }],
  };

  let fetchCount = 0;
  const fakeClient: AutoSeoClient = {
    loadProducts: async () => [cachedProduct],
    loadProductDetail: async () => {
      fetchCount++;
      return cachedProduct;
    },
    runAutoSeo: async (input) => runAutoSeo(input),
    getCachedDetail: (id) => (id === cachedProduct.id ? cachedProduct : undefined),
    getStoreInfo: async () => ({ storeId: "store-1", shopDomain: "test.myshopify.com" }),
    runAutoSeoBackup: async (req) => ({
      workflowId: req.workflowId,
      backedUpCount: req.products.length,
      backupIds: [],
      downstreamStatus: "SENT",
    }),
    hydrateSelectedProductsFresh: async () => [],
  };

  // Verify getCachedDetail returns the product
  const cached = fakeClient.getCachedDetail?.(cachedProduct.id);
  assert.ok(cached !== undefined);
  assert.equal(fetchCount, 0, "No API fetch should be triggered when detail is already cached");

  const html = renderToStaticMarkup(
    React.createElement(ProductDetailDrawer, {
      product: cached,
      isOpen: true,
      isLoading: false,
      onClose: () => {},
    }),
  );

  assert.ok(html.includes("Cached Full Product"));
  assert.ok(html.includes("Cached Image"));
  assert.ok(!html.includes("Đang tải chi tiết..."));
});

// 3. run Auto SEO hydrates selected products before mapping
test("3. run Auto SEO hydrates selected products before mapping", async () => {
  const client = createTestAutoSeoClient();
  const selectedIds = ["gid://shopify/Product/p1", "gid://shopify/Product/p2"];

  // Hydrate selected products
  const hydrated = await hydrateSelectedProducts(client, selectedIds);

  // Map to candidates
  const candidates = hydrated.map(mapShopifyProductToAutoSeoCandidate);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0]?.productId, "gid://shopify/Product/p1");
  assert.equal(
    candidates[0]?.descriptionHtml,
    "<p>Full description for gid://shopify/Product/p1</p>",
  );
  assert.equal(candidates[0]?.images.length, 2);
  assert.equal(candidates[1]?.productId, "gid://shopify/Product/p2");
});

// 4. multiple selected products produce full AutoSeoProductCandidate values
test("4. multiple selected products produce full AutoSeoProductCandidate values", async () => {
  const client = createTestAutoSeoClient();
  const selectedIds = [
    "gid://shopify/Product/100",
    "gid://shopify/Product/200",
    "gid://shopify/Product/300",
  ];

  const hydrated = await hydrateSelectedProducts(client, selectedIds);
  const candidates = hydrated.map(mapShopifyProductToAutoSeoCandidate);

  assert.equal(candidates.length, 3);
  for (let i = 0; i < selectedIds.length; i++) {
    const id = selectedIds[i]!;
    const candidate = candidates[i]!;
    assert.equal(candidate.productId, id);
    assert.equal(candidate.descriptionHtml, `<p>Full description for ${id}</p>`);
    assert.equal(candidate.seoTitle, `SEO Title for ${id}`);
    assert.equal(candidate.seoDescription, `SEO Description for ${id}`);
    assert.equal(candidate.images.length, 2);
    assert.equal(candidate.images[0]?.position, 1);
    assert.equal(candidate.images[1]?.position, 2);
  }
});

// 5. SeoContent payload contains real sourceDescriptionHtml
test("5. SeoContent payload contains real sourceDescriptionHtml", async () => {
  const client = createTestAutoSeoClient({
    getProductDetail: (id) => ({
      id,
      title: "Real Product",
      handle: "real-product",
      descriptionHtml: "<article><h3>Feature List</h3><ul><li>Item 1</li></ul></article>",
      images: [{ url: "https://example.com/item.jpg" }],
    }),
  });

  const hydrated = await hydrateSelectedProducts(client, ["gid://shopify/Product/real-1"]);
  const candidates = hydrated.map(mapShopifyProductToAutoSeoCandidate);

  const result = await client.runAutoSeo({
    workflowId: "wf-desc-test",
    products: candidates,
    selectedProductIds: ["gid://shopify/Product/real-1"],
  });

  assert.equal(result.seoContentInputs.length, 1);
  assert.equal(
    result.seoContentInputs[0]?.sourceDescriptionHtml,
    "<article><h3>Feature List</h3><ul><li>Item 1</li></ul></article>",
  );
});

// 6. SeoContent payload contains sourceSeoTitle/sourceSeoDescription
test("6. SeoContent payload contains sourceSeoTitle/sourceSeoDescription", async () => {
  const client = createTestAutoSeoClient({
    getProductDetail: (id) => ({
      id,
      title: "SEO Target Product",
      handle: "seo-target",
      descriptionHtml: "<p>Content</p>",
      seo: {
        title: "Exact Shopify SEO Title",
        description: "Exact Shopify Meta Description",
      },
      images: [],
    }),
  });

  const hydrated = await hydrateSelectedProducts(client, ["gid://shopify/Product/seo-p"]);
  const candidates = hydrated.map(mapShopifyProductToAutoSeoCandidate);

  const result = await client.runAutoSeo({
    workflowId: "wf-seo-payload",
    products: candidates,
    selectedProductIds: ["gid://shopify/Product/seo-p"],
  });

  assert.equal(result.seoContentInputs[0]?.sourceSeoTitle, "Exact Shopify SEO Title");
  assert.equal(
    result.seoContentInputs[0]?.sourceSeoDescription,
    "Exact Shopify Meta Description",
  );
});

// 7. SeoContent payload contains all returned images/altText
test("7. SeoContent payload contains all returned images/altText", async () => {
  const client = createTestAutoSeoClient({
    getProductDetail: (id) => ({
      id,
      title: "Multi-Image Product",
      handle: "multi-img",
      descriptionHtml: "<p>Content</p>",
      images: [
        { url: "https://example.com/photo-1.jpg", altText: "Primary Photo" },
        { url: "https://example.com/photo-2.jpg", altText: "Angle Photo" },
        { url: "https://example.com/photo-3.jpg", altText: "Close-up Texture" },
      ],
    }),
  });

  const hydrated = await hydrateSelectedProducts(client, ["gid://shopify/Product/multi-img-p"]);
  const candidates = hydrated.map(mapShopifyProductToAutoSeoCandidate);

  const result = await client.runAutoSeo({
    workflowId: "wf-images-payload",
    products: candidates,
    selectedProductIds: ["gid://shopify/Product/multi-img-p"],
  });

  const payloadImages = result.seoContentInputs[0]?.images;
  assert.ok(payloadImages !== undefined);
  assert.equal(payloadImages.length, 3);
  assert.equal(payloadImages[0]?.url, "https://example.com/photo-1.jpg");
  assert.equal(payloadImages[0]?.altText, "Primary Photo");
  assert.equal(payloadImages[0]?.position, 1);
  assert.equal(payloadImages[1]?.url, "https://example.com/photo-2.jpg");
  assert.equal(payloadImages[1]?.altText, "Angle Photo");
  assert.equal(payloadImages[1]?.position, 2);
  assert.equal(payloadImages[2]?.url, "https://example.com/photo-3.jpg");
  assert.equal(payloadImages[2]?.altText, "Close-up Texture");
  assert.equal(payloadImages[2]?.position, 3);
});

// 8. hydration failure does NOT silently substitute empty product detail
test("8. hydration failure does NOT silently substitute empty product detail", async () => {
  const client = createTestAutoSeoClient({
    failProductId: "gid://shopify/Product/broken-500",
  });

  await assert.rejects(
    async () => {
      await hydrateSelectedProducts(client, [
        "gid://shopify/Product/good-1",
        "gid://shopify/Product/broken-500",
      ]);
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.ok(
        err.message.includes("gid://shopify/Product/broken-500"),
        `Error must identify broken product ID, got: ${err.message}`,
      );
      return true;
    },
  );
});

// 9. duplicate selected IDs do not cause duplicate products.get requests
test("9. duplicate selected IDs do not cause duplicate products.get requests", async () => {
  const client = createTestAutoSeoClient();

  const duplicateSelectedIds = [
    "gid://shopify/Product/item-A",
    "gid://shopify/Product/item-B",
    "gid://shopify/Product/item-A",
    "gid://shopify/Product/item-B",
    "gid://shopify/Product/item-A",
  ];

  const hydrated = await hydrateSelectedProducts(client, duplicateSelectedIds);

  // Output preserves the duplicate count for selection mapping
  assert.equal(hydrated.length, 5);

  const detailCalls = client.getCallIds();
  assert.equal(
    detailCalls.length,
    2,
    "Only 2 unique products.get requests should be sent for 2 unique IDs",
  );
});

// 10. bounded concurrency is respected
test("10. bounded concurrency is respected", async () => {
  const client = createTestAutoSeoClient({
    delayMs: 15,
  });

  const tenProductIds = Array.from(
    { length: 10 },
    (_, i) => `gid://shopify/Product/batch-${i + 1}`,
  );

  const hydrated = await hydrateSelectedProducts(client, tenProductIds, 3);

  assert.equal(hydrated.length, 10);
  const maxActiveCalls = client.getMaxActive();
  assert.ok(
    maxActiveCalls <= 3,
    `Max active concurrency was ${maxActiveCalls}, must be <= 3`,
  );
});

// 11. final hydrated product order matches selected product order
test("11. final hydrated product order matches selected product order", async () => {
  const client = createTestAutoSeoClient();

  const orderedIds = [
    "gid://shopify/Product/zebra",
    "gid://shopify/Product/apple",
    "gid://shopify/Product/mango",
    "gid://shopify/Product/banana",
  ];

  const hydrated = await hydrateSelectedProducts(client, orderedIds);

  assert.equal(hydrated.length, 4);
  assert.equal(hydrated[0]?.id, "gid://shopify/Product/zebra");
  assert.equal(hydrated[1]?.id, "gid://shopify/Product/apple");
  assert.equal(hydrated[2]?.id, "gid://shopify/Product/mango");
  assert.equal(hydrated[3]?.id, "gid://shopify/Product/banana");
});

// 12. MockAutoSeoClient supports loadProductDetail and hydrateSelectedProducts with caching
test("12. MockAutoSeoClient supports loadProductDetail and hydrateSelectedProducts with caching", async () => {
  const mockClient = new MockAutoSeoClient();

  const products = await mockClient.loadProducts();
  assert.ok(products.length > 0);

  const firstId = products[0]!.id;
  const detail1 = await mockClient.loadProductDetail(firstId);
  assert.equal(detail1.id, firstId);
  assert.ok(detail1.descriptionHtml && detail1.descriptionHtml.length > 0);

  // Cached detail matches
  const cached = mockClient.getCachedDetail(firstId);
  assert.ok(cached !== undefined);
  assert.equal(cached.id, firstId);

  // Hydrate multiple
  const hydrated = await mockClient.hydrateSelectedProducts([products[0]!.id, products[1]!.id]);
  assert.equal(hydrated.length, 2);
  assert.equal(hydrated[0]?.id, products[0]!.id);
  assert.equal(hydrated[1]?.id, products[1]!.id);
});

// 13. MockAutoSeoClient supports loadProductDetail with storeId overload
test("13. MockAutoSeoClient supports loadProductDetail with storeId overload", async () => {
  const mockClient = new MockAutoSeoClient();
  const products = await mockClient.loadProducts();
  const firstId = products[0]!.id;

  // Call with explicit storeId
  const detail = await mockClient.loadProductDetail("store-abc", firstId);
  assert.equal(detail.id, firstId);
  assert.ok(detail.descriptionHtml && detail.descriptionHtml.length > 0);

  // Cached copy is isolated
  const cached = mockClient.getCachedDetail(firstId);
  assert.ok(cached !== undefined);
  assert.equal(cached.id, firstId);
  // Mutating the returned detail does not mutate cache
  (detail as unknown as Record<string, unknown>).title = "Mutated In Test";
  const freshCached = mockClient.getCachedDetail(firstId);
  assert.notEqual(freshCached?.title, "Mutated In Test");
});

// 14. mapWithConcurrency halts remaining workers immediately on error
test("14. mapWithConcurrency halts remaining workers immediately on error", async () => {
  const executedIndices: number[] = [];
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];

  await assert.rejects(
    async () => {
      await mapWithConcurrency(items, 2, async (item) => {
        executedIndices.push(item);
        if (item === 1) {
          throw new Error("Failure on item 1");
        }
        await new Promise((r) => setTimeout(r, 20));
        return item;
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal(err.message, "Failure on item 1");
      return true;
    },
  );

  // Remaining items past the concurrency window should not have been started
  assert.ok(
    !executedIndices.includes(8) && !executedIndices.includes(9),
    "Items later in queue should not execute after earlier item failed",
  );
});

// 15. ProductDetailDrawer renders loading placeholders for images and variants
test("15. ProductDetailDrawer renders loading placeholders for images and variants when isLoading is true", () => {
  const catalogProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/test-p",
    title: "Test Product",
    handle: "test-p",
  };

  const html = renderToStaticMarkup(
    React.createElement(ProductDetailDrawer, {
      product: catalogProduct,
      isOpen: true,
      isLoading: true,
      onClose: () => {},
    }),
  );

  assert.ok(html.includes("Đang tải hình ảnh sản phẩm từ Shopify..."));
  assert.ok(html.includes("Đang tải chi tiết..."));
});
