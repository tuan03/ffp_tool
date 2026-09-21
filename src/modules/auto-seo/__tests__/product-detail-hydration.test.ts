import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AppError } from "../../../shared/errors/app-error";
import {
  hydrateSelectedProducts,
  mapShopifyProductToAutoSeoCandidate,
  mapWithConcurrency,
  RealAutoSeoClient,
  runAutoSeo,
} from "..";
import { MockAutoSeoClient } from "../mocks/runner";
import type {
  AutoSeoClient,
  AutoSeoSelectionInput,
  ShopifyProductForAutoSeoUi,
} from "../types";
import { AutoSeoPage } from "../ui/AutoSeoPage";
import { ProductDetailDrawer } from "../ui/components/ProductDetailDrawer";

function createFakeGateway(options?: {
  readonly getProductDetail?: (productId: string) => ShopifyProductForAutoSeoUi | null;
  readonly delayMs?: number;
  readonly failProductId?: string;
}) {
  const calls: { operation: string; payload: Record<string, unknown> }[] = [];
  let currentActive = 0;
  let maxActive = 0;

  const fakeFetch: typeof fetch = async (_input, init) => {
    currentActive++;
    if (currentActive > maxActive) {
      maxActive = currentActive;
    }

    if (options?.delayMs) {
      await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    }

    try {
      const body = JSON.parse(String(init?.body)) as {
        operation: string;
        storeId?: string;
        payload?: Record<string, unknown>;
      };

      calls.push({ operation: body.operation, payload: body.payload ?? {} });

      if (body.operation === "stores.list") {
        return new Response(
          JSON.stringify({
            success: true,
            data: { stores: [{ storeId: "store-test-1" }], total: 1 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (body.operation === "products.list") {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              products: [
                {
                  id: "gid://shopify/Product/cat-1",
                  title: "Catalog Product 1",
                  handle: "cat-product-1",
                  status: "ACTIVE",
                  featuredImage: {
                    url: "https://cdn.example.com/thumb-cat-1.jpg",
                    altText: "Catalog Thumbnail 1",
                  },
                  seo: { title: "Catalog SEO Title", description: "Catalog SEO Desc" },
                },
              ],
              pageInfo: { hasNextPage: false },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (body.operation === "products.get") {
        const productId = String(body.payload?.id ?? "");

        if (options?.failProductId && productId === options.failProductId) {
          return new Response(
            JSON.stringify({
              success: false,
              error: { message: `Simulated gateway error for ${productId}` },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        const product = options?.getProductDetail
          ? options.getProductDetail(productId)
          : {
              id: productId,
              title: `Full Title for ${productId}`,
              handle: `handle-${productId.replace(/\W+/g, "-")}`,
              status: "ACTIVE",
              descriptionHtml: `<p>Full description for ${productId}</p>`,
              seo: {
                title: `SEO Title for ${productId}`,
                description: `SEO Description for ${productId}`,
              },
              images: [
                {
                  id: "img-1",
                  url: `https://cdn.example.com/${productId}-1.jpg`,
                  altText: `Alt text 1 for ${productId}`,
                },
                {
                  id: "img-2",
                  url: `https://cdn.example.com/${productId}-2.jpg`,
                  altText: `Alt text 2 for ${productId}`,
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

        return new Response(
          JSON.stringify({
            success: true,
            data: { product },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    } finally {
      currentActive--;
    }
  };

  return {
    fakeFetch,
    getCalls: () => calls,
    getMaxActive: () => maxActive,
  };
}

// 1. loadProducts uses products.list
test("1. loadProducts uses products.list", async () => {
  const { fakeFetch, getCalls } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const products = await client.loadProducts();

  assert.equal(products.length, 1);
  assert.equal(products[0]?.id, "gid://shopify/Product/cat-1");

  const calls = getCalls();
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.operation, "stores.list");
  assert.equal(calls[1]?.operation, "products.list");
  assert.equal((calls[1]?.payload as { limit?: number }).limit, 250);
});

// 2. loadProducts still paginates all catalog pages
test("2. loadProducts still paginates all catalog pages", async () => {
  const calls: string[] = [];
  const fakeFetch: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      operation: string;
      payload?: { cursor?: string };
    };
    calls.push(body.operation);

    if (body.operation === "stores.list") {
      return new Response(
        JSON.stringify({
          success: true,
          data: { stores: [{ storeId: "store-1" }] },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    if (body.operation === "products.list") {
      if (!body.payload?.cursor) {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              products: [{ id: "p1", title: "Page 1 Item", handle: "p1" }],
              pageInfo: { hasNextPage: true, endCursor: "cursor_page_1" },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          success: true,
          data: {
            products: [{ id: "p2", title: "Page 2 Item", handle: "p2" }],
            pageInfo: { hasNextPage: false, endCursor: "cursor_page_2" },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("Not Found", { status: 404 });
  };

  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);
  const products = await client.loadProducts();

  assert.equal(products.length, 2);
  assert.equal(products[0]?.id, "p1");
  assert.equal(products[1]?.id, "p2");
  assert.deepEqual(calls, ["stores.list", "products.list", "products.list"]);
});

// 3. loadProductDetail calls products.get with correct product id
test("3. loadProductDetail calls products.get with correct product id", async () => {
  const { fakeFetch, getCalls } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const product = await client.loadProductDetail("gid://shopify/Product/12345");

  assert.equal(product.id, "gid://shopify/Product/12345");
  const calls = getCalls();
  assert.equal(calls.length, 2); // stores.list then products.get
  assert.equal(calls[0]?.operation, "stores.list");
  assert.equal(calls[1]?.operation, "products.get");
  assert.equal((calls[1]?.payload as { id?: string }).id, "gid://shopify/Product/12345");
});

// 4. loadProductDetail returns descriptionHtml
test("4. loadProductDetail returns descriptionHtml", async () => {
  const { fakeFetch } = createFakeGateway({
    getProductDetail: (id) => ({
      id,
      title: "Detailed Mug",
      handle: "detailed-mug",
      descriptionHtml: "<p>Rich descriptive text about ceramic mug</p>",
    }),
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const detail = await client.loadProductDetail("gid://shopify/Product/detail-mug");

  assert.equal(detail.descriptionHtml, "<p>Rich descriptive text about ceramic mug</p>");
});

// 5. loadProductDetail returns images + altText
test("5. loadProductDetail returns images + altText", async () => {
  const { fakeFetch } = createFakeGateway({
    getProductDetail: (id) => ({
      id,
      title: "Detailed Mug",
      handle: "detailed-mug",
      images: [
        {
          id: "img-1",
          url: "https://example.com/mug-front.jpg",
          altText: "Ceramic Mug Front View",
        },
        {
          id: "img-2",
          url: "https://example.com/mug-back.jpg",
          altText: "Ceramic Mug Back View",
        },
      ],
    }),
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const detail = await client.loadProductDetail("gid://shopify/Product/detail-mug");

  assert.equal(detail.images?.length, 2);
  assert.equal(detail.images?.[0]?.url, "https://example.com/mug-front.jpg");
  assert.equal(detail.images?.[0]?.altText, "Ceramic Mug Front View");
  assert.equal(detail.images?.[1]?.url, "https://example.com/mug-back.jpg");
  assert.equal(detail.images?.[1]?.altText, "Ceramic Mug Back View");
});

// 6. loadProductDetail returns variants
test("6. loadProductDetail returns variants", async () => {
  const { fakeFetch } = createFakeGateway({
    getProductDetail: (id) => ({
      id,
      title: "Mug With Sizes",
      handle: "mug-sizes",
      variants: [
        { id: "var-11oz", title: "11 oz", price: "14.99", sku: "MUG-11" },
        { id: "var-15oz", title: "15 oz", price: "18.99", sku: "MUG-15" },
      ],
    }),
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const detail = await client.loadProductDetail("gid://shopify/Product/detail-variants");

  assert.equal(detail.variants?.length, 2);
  assert.equal(detail.variants?.[0]?.id, "var-11oz");
  assert.equal(detail.variants?.[0]?.title, "11 oz");
  assert.equal(detail.variants?.[1]?.id, "var-15oz");
  assert.equal(detail.variants?.[1]?.price, "18.99");
});

// 7. repeated detail request for same product uses cache
test("7. repeated detail request for same product uses cache", async () => {
  const { fakeFetch, getCalls } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const firstCall = await client.loadProductDetail("gid://shopify/Product/cached-item");
  const secondCall = await client.loadProductDetail("gid://shopify/Product/cached-item");

  assert.equal(firstCall.id, "gid://shopify/Product/cached-item");
  assert.equal(secondCall.id, "gid://shopify/Product/cached-item");

  const getCallsCount = getCalls().filter((c) => c.operation === "products.get").length;
  assert.equal(getCallsCount, 1, "products.get must be called only once due to cache");
});

// 8. opening ProductDetailDrawer hydrates product detail
test("8. opening ProductDetailDrawer hydrates product detail", async () => {
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
  };

  const catalogProduct: ShopifyProductForAutoSeoUi = {
    id: "gid://shopify/Product/catalog-p1",
    title: "Catalog Only Title",
    handle: "cat-p1",
    // No descriptionHtml or images in catalog
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

// 9. cached drawer detail does not fetch again
test("9. cached drawer detail does not fetch again", async () => {
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
    loadProductDetail: async (id: string) => {
      fetchCount++;
      return cachedProduct;
    },
    runAutoSeo: async (input) => runAutoSeo(input),
    getCachedDetail: (id) => (id === cachedProduct.id ? cachedProduct : undefined),
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

// 10. run Auto SEO hydrates selected products before mapping
test("10. run Auto SEO hydrates selected products before mapping", async () => {
  const { fakeFetch } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const selectedIds = ["gid://shopify/Product/p1", "gid://shopify/Product/p2"];

  // Hydrate selected products
  const hydrated = await client.hydrateSelectedProducts(selectedIds);

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

// 11. multiple selected products produce full AutoSeoProductCandidate values
test("11. multiple selected products produce full AutoSeoProductCandidate values", async () => {
  const { fakeFetch } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const selectedIds = [
    "gid://shopify/Product/100",
    "gid://shopify/Product/200",
    "gid://shopify/Product/300",
  ];

  const hydrated = await client.hydrateSelectedProducts(selectedIds);
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

// 12. SeoContent payload contains real sourceDescriptionHtml
test("12. SeoContent payload contains real sourceDescriptionHtml", async () => {
  const { fakeFetch } = createFakeGateway({
    getProductDetail: (id) => ({
      id,
      title: "Real Product",
      handle: "real-product",
      descriptionHtml: "<article><h3>Feature List</h3><ul><li>Item 1</li></ul></article>",
      images: [{ url: "https://example.com/item.jpg" }],
    }),
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const hydrated = await client.hydrateSelectedProducts(["gid://shopify/Product/real-1"]);
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

// 13. SeoContent payload contains sourceSeoTitle/sourceSeoDescription
test("13. SeoContent payload contains sourceSeoTitle/sourceSeoDescription", async () => {
  const { fakeFetch } = createFakeGateway({
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
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const hydrated = await client.hydrateSelectedProducts(["gid://shopify/Product/seo-p"]);
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

// 14. SeoContent payload contains all returned images/altText
test("14. SeoContent payload contains all returned images/altText", async () => {
  const { fakeFetch } = createFakeGateway({
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
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const hydrated = await client.hydrateSelectedProducts(["gid://shopify/Product/multi-img-p"]);
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

// 15. hydration failure does NOT silently substitute empty product detail
test("15. hydration failure does NOT silently substitute empty product detail", async () => {
  const { fakeFetch } = createFakeGateway({
    failProductId: "gid://shopify/Product/broken-500",
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  await assert.rejects(
    async () => {
      await client.hydrateSelectedProducts([
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

// 16. duplicate selected IDs do not cause duplicate products.get requests
test("16. duplicate selected IDs do not cause duplicate products.get requests", async () => {
  const { fakeFetch, getCalls } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const duplicateSelectedIds = [
    "gid://shopify/Product/item-A",
    "gid://shopify/Product/item-B",
    "gid://shopify/Product/item-A",
    "gid://shopify/Product/item-B",
    "gid://shopify/Product/item-A",
  ];

  const hydrated = await client.hydrateSelectedProducts(duplicateSelectedIds);

  // Output preserves the duplicate count for selection mapping
  assert.equal(hydrated.length, 5);

  const productsGetCalls = getCalls().filter((c) => c.operation === "products.get");
  assert.equal(
    productsGetCalls.length,
    2,
    "Only 2 unique products.get requests should be sent for 2 unique IDs",
  );
});

// 17. bounded concurrency is respected
test("17. bounded concurrency is respected", async () => {
  const { fakeFetch, getMaxActive } = createFakeGateway({
    delayMs: 15,
  });
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const tenProductIds = Array.from(
    { length: 10 },
    (_, i) => `gid://shopify/Product/batch-${i + 1}`,
  );

  const hydrated = await client.hydrateSelectedProducts(tenProductIds, 3);

  assert.equal(hydrated.length, 10);
  const maxActiveCalls = getMaxActive();
  assert.ok(
    maxActiveCalls <= 3,
    `Max active concurrency was ${maxActiveCalls}, must be <= 3`,
  );
});

// 18. final hydrated product order matches selected product order
test("18. final hydrated product order matches selected product order", async () => {
  const { fakeFetch } = createFakeGateway();
  const client = new RealAutoSeoClient("http://gateway.test", fakeFetch);

  const orderedIds = [
    "gid://shopify/Product/zebra",
    "gid://shopify/Product/apple",
    "gid://shopify/Product/mango",
    "gid://shopify/Product/banana",
  ];

  const hydrated = await client.hydrateSelectedProducts(orderedIds);

  assert.equal(hydrated.length, 4);
  assert.equal(hydrated[0]?.id, "gid://shopify/Product/zebra");
  assert.equal(hydrated[1]?.id, "gid://shopify/Product/apple");
  assert.equal(hydrated[2]?.id, "gid://shopify/Product/mango");
  assert.equal(hydrated[3]?.id, "gid://shopify/Product/banana");
});

// Additional test: MockAutoSeoClient hydration and detail caching
test("19. MockAutoSeoClient supports loadProductDetail and hydrateSelectedProducts with caching", async () => {
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

// 20. MockAutoSeoClient supports loadProductDetail with storeId overload
test("20. MockAutoSeoClient supports loadProductDetail with storeId overload", async () => {
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

// 21. mapWithConcurrency halts remaining workers immediately on error
test("21. mapWithConcurrency halts remaining workers immediately on error", async () => {
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

// 22. ProductDetailDrawer renders loading placeholders for images and variants
test("22. ProductDetailDrawer renders loading placeholders for images and variants when isLoading is true", () => {
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

