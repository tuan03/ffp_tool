import assert from "node:assert/strict";
import test from "node:test";

import { AppError } from "../../../shared/errors/app-error";
import type {
  ModuleApiRunner,
  ShopifyApiInput,
  ShopifyApiResponse,
  ShopifyProduct,
  ShopifyStoreSummary,
} from "../../module-api";
import {
  AutoSeoModuleApiClient,
  createAutoSeoModuleApiClient,
} from "../auto-seo-module-api-client";

function createTestRunner(
  fn: (input: ShopifyApiInput) => Promise<unknown>,
): ModuleApiRunner {
  return fn as unknown as ModuleApiRunner;
}

function createMockProduct(overrides?: Partial<ShopifyProduct>): ShopifyProduct {
  return {
    id: "gid://shopify/Product/1",
    title: "Test Product",
    handle: "test-product",
    description: "Product description text",
    descriptionHtml: "<p>Product description text</p>",
    status: "ACTIVE",
    vendor: "CHILLGEN",
    productType: "Apparel",
    tags: ["tag1", "tag2"],
    onlineStoreUrl: "https://store.myshopify.com/products/test-product",
    featuredImage: {
      id: "gid://shopify/ProductImage/101",
      url: "https://cdn.example.com/feat.jpg",
      altText: "Featured Image",
      width: 800,
      height: 800,
    },
    images: [
      {
        id: "gid://shopify/ProductImage/101",
        url: "https://cdn.example.com/feat.jpg",
        altText: "Featured Image",
        width: 800,
        height: 800,
      },
      {
        id: "gid://shopify/ProductImage/102",
        url: "https://cdn.example.com/secondary.jpg",
        altText: "Secondary Image",
        width: 1200,
        height: 1200,
      },
    ],
    variants: [
      {
        id: "gid://shopify/ProductVariant/201",
        productId: "gid://shopify/Product/1",
        title: "Default Title",
        price: "29.99",
        compareAtPrice: "39.99",
        sku: "TEST-SKU-01",
        barcode: "1234567890",
        inventoryQuantity: 50,
      },
    ],
    seo: {
      title: "Test SEO Title",
      description: "Test SEO Description",
    },
    hasMoreVariants: false,
    hasMoreImages: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

test("1. stores.list: getStoreInfo resolves storeId and shopDomain from ShopifyStoreSummary", async () => {
  const storeSummary: ShopifyStoreSummary = {
    storeId: "store-auto-1",
    shopDomain: "test-shop.myshopify.com",
    authType: "client_credentials",
    connected: true,
  };

  const runner = createTestRunner(async (input) => {
    assert.equal(input.operation, "stores.list");
    return {
      storeId: "system",
      operation: "stores.list",
      success: true,
      data: {
        stores: [storeSummary],
        total: 1,
      },
    } as unknown as ShopifyApiResponse;
  });

  const client = createAutoSeoModuleApiClient(runner);
  const info = await client.getStoreInfo?.();

  assert.deepEqual(info, {
    storeId: "store-auto-1",
    shopDomain: "test-shop.myshopify.com",
  });
});

test("2. stores.list: throws AUTO_SEO_STORE_INFO_UNAVAILABLE when no valid store exists", async () => {
  const runnerEmpty = createTestRunner(async () => {
    return {
      storeId: "system",
      operation: "stores.list",
      success: true,
      data: {
        stores: [],
        total: 0,
      },
    } as unknown as ShopifyApiResponse;
  });

  const client = new AutoSeoModuleApiClient(runnerEmpty);
  await assert.rejects(
    async () => {
      await client.getStoreInfo();
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_STORE_INFO_UNAVAILABLE");
      return true;
    },
  );

  const runnerMissingDomain = createTestRunner(async () => {
    return {
      storeId: "system",
      operation: "stores.list",
      success: true,
      data: {
        stores: [{ storeId: "store-1", shopDomain: "", authType: "static" }],
        total: 1,
      },
    } as unknown as ShopifyApiResponse;
  });

  const client2 = new AutoSeoModuleApiClient(runnerMissingDomain);
  await assert.rejects(
    async () => {
      await client2.getStoreInfo();
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_STORE_INFO_UNAVAILABLE");
      return true;
    },
  );
});

test("3. products.list: loads single-page product catalog and maps to UI shape", async () => {
  const calls: ShopifyApiInput[] = [];
  const prod = createMockProduct();

  const runner = createTestRunner(async (input) => {
    calls.push(input);
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-alpha", shopDomain: "alpha.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.list") {
      assert.equal(input.storeId, "store-alpha");
      assert.equal(input.payload.limit, 250);
      return {
        storeId: "store-alpha",
        operation: "products.list",
        success: true,
        data: {
          products: [prod],
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
        },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected operation: ${input.operation}`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  const products = await client.loadProducts();

  assert.equal(products.length, 1);
  assert.equal(products[0]?.id, prod.id);
  assert.equal(products[0]?.title, prod.title);
  assert.equal(products[0]?.handle, prod.handle);
  assert.equal(products[0]?.descriptionHtml, prod.descriptionHtml);
  assert.equal(products[0]?.status, "ACTIVE");
  assert.equal(products[0]?.vendor, "CHILLGEN");
  assert.equal(products[0]?.productType, "Apparel");
  assert.deepEqual(products[0]?.tags, ["tag1", "tag2"]);
  assert.equal(products[0]?.onlineStoreUrl, prod.onlineStoreUrl);
  assert.equal(products[0]?.featuredImage?.url, prod.featuredImage?.url);
  assert.equal(products[0]?.images?.length, 2);
  assert.equal(products[0]?.variants?.length, 1);
  assert.equal(products[0]?.variants?.[0]?.sku, "TEST-SKU-01");
  assert.equal(products[0]?.variants?.[0]?.compareAtPrice, "39.99");
  assert.equal(products[0]?.variants?.[0]?.barcode, "1234567890");
  assert.equal(products[0]?.seo?.title, "Test SEO Title");
  assert.equal(products[0]?.createdAt, prod.createdAt);
  assert.equal(products[0]?.updatedAt, prod.updatedAt);
});

test("4. products.list: paginates through multiple pages and dedupes product IDs", async () => {
  const prod1 = createMockProduct({ id: "gid://shopify/Product/1", title: "P1" });
  const prod2 = createMockProduct({ id: "gid://shopify/Product/2", title: "P2" });
  const prodDuplicate = createMockProduct({ id: "gid://shopify/Product/1", title: "P1 Duplicate" });

  let page = 0;
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-p", shopDomain: "p.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.list") {
      page++;
      if (page === 1) {
        assert.equal(input.payload.cursor, undefined);
        return {
          storeId: "store-p",
          operation: "products.list",
          success: true,
          data: {
            products: [prod1],
            pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: "cursor-page-1" },
          },
        } as unknown as ShopifyApiResponse;
      }
      if (page === 2) {
        assert.equal(input.payload.cursor, "cursor-page-1");
        return {
          storeId: "store-p",
          operation: "products.list",
          success: true,
          data: {
            products: [prodDuplicate, prod2],
            pageInfo: { hasNextPage: false, hasPreviousPage: true, endCursor: "cursor-page-2" },
          },
        } as unknown as ShopifyApiResponse;
      }
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  const products = await client.loadProducts();

  assert.equal(products.length, 2);
  assert.equal(products[0]?.id, "gid://shopify/Product/1");
  assert.equal(products[1]?.id, "gid://shopify/Product/2");
});

test("5. products.list: throws AUTO_SEO_LOAD_FAILED when hasNextPage=true but endCursor is missing", async () => {
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-p", shopDomain: "p.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.list") {
      return {
        storeId: "store-p",
        operation: "products.list",
        success: true,
        data: {
          products: [createMockProduct()],
          pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: "   " },
        },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  await assert.rejects(
    async () => {
      await client.loadProducts();
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.ok(err.message.includes("endCursor is missing"));
      return true;
    },
  );
});

test("6. products.list: throws AUTO_SEO_LOAD_FAILED on repeated cursor (infinite loop detection)", async () => {
  let callCount = 0;
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-p", shopDomain: "p.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.list") {
      callCount++;
      return {
        storeId: "store-p",
        operation: "products.list",
        success: true,
        data: {
          products: [createMockProduct({ id: `gid://shopify/Product/${callCount}` })],
          pageInfo: { hasNextPage: true, hasPreviousPage: false, endCursor: "stuck-cursor" },
        },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  await assert.rejects(
    async () => {
      await client.loadProducts();
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.ok(err.message.includes("repeated cursor"));
      return true;
    },
  );
});

test("7. products.get: loads product detail and caches response for subsequent calls", async () => {
  let getCalls = 0;
  const prod = createMockProduct({ id: "gid://shopify/Product/detail-1" });

  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-x", shopDomain: "x.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      getCalls++;
      assert.equal(input.payload.id, "gid://shopify/Product/detail-1");
      return {
        storeId: "store-x",
        operation: "products.get",
        success: true,
        data: { product: prod },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);

  const detail1 = await client.loadProductDetail("gid://shopify/Product/detail-1");
  assert.equal(detail1.id, "gid://shopify/Product/detail-1");
  assert.equal(getCalls, 1);

  // Cached call
  const detail2 = await client.loadProductDetail("gid://shopify/Product/detail-1");
  assert.equal(detail2.id, "gid://shopify/Product/detail-1");
  assert.equal(getCalls, 1, "Should reuse cached detail without new API call");

  assert.equal(client.getCachedDetail?.("gid://shopify/Product/detail-1")?.id, "gid://shopify/Product/detail-1");
});

test("8. products.get: throws AUTO_SEO_LOAD_FAILED when product is null", async () => {
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-x", shopDomain: "x.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      return {
        storeId: "store-x",
        operation: "products.get",
        success: true,
        data: { product: null },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  await assert.rejects(
    async () => {
      await client.loadProductDetail("gid://shopify/Product/missing");
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      return true;
    },
  );
});

test("9. loadProductDetailFresh: bypasses cache and replaces cached entry", async () => {
  let titleVersion = "Version 1";
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-x", shopDomain: "x.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      return {
        storeId: "store-x",
        operation: "products.get",
        success: true,
        data: {
          product: createMockProduct({
            id: "gid://shopify/Product/fresh-test",
            title: titleVersion,
          }),
        },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);

  const initial = await client.loadProductDetail("gid://shopify/Product/fresh-test");
  assert.equal(initial.title, "Version 1");

  // Mutate version
  titleVersion = "Version 2 (Fresh)";

  // loadProductDetail would return cached Version 1
  const cached = await client.loadProductDetail("gid://shopify/Product/fresh-test");
  assert.equal(cached.title, "Version 1");

  // loadProductDetailFresh must bypass cache and fetch Version 2
  const fresh = await client.loadProductDetailFresh?.("gid://shopify/Product/fresh-test");
  assert.equal(fresh?.title, "Version 2 (Fresh)");

  // Future loadProductDetail should now return Version 2
  const nowCached = await client.loadProductDetail("gid://shopify/Product/fresh-test");
  assert.equal(nowCached.title, "Version 2 (Fresh)");
});

test("10. hydrateSelectedProductsFresh: bypasses cache, respects bounded concurrency, and preserves order", async () => {
  let activeConcurrent = 0;
  let maxConcurrent = 0;

  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-c", shopDomain: "c.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      activeConcurrent++;
      if (activeConcurrent > maxConcurrent) {
        maxConcurrent = activeConcurrent;
      }

      await new Promise((r) => setTimeout(r, 20));

      activeConcurrent--;
      return {
        storeId: "store-c",
        operation: "products.get",
        success: true,
        data: {
          product: createMockProduct({
            id: input.payload.id,
            title: `Title for ${input.payload.id}`,
          }),
        },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error(`Unexpected call`);
  });

  const client = createAutoSeoModuleApiClient(runner);
  const orderedIds = [
    "gid://shopify/Product/id-4",
    "gid://shopify/Product/id-1",
    "gid://shopify/Product/id-3",
    "gid://shopify/Product/id-2",
  ];

  const results = await client.hydrateSelectedProductsFresh?.(orderedIds, 2);

  assert.equal(results?.length, 4);
  assert.equal(results?.[0]?.id, "gid://shopify/Product/id-4");
  assert.equal(results?.[1]?.id, "gid://shopify/Product/id-1");
  assert.equal(results?.[2]?.id, "gid://shopify/Product/id-3");
  assert.equal(results?.[3]?.id, "gid://shopify/Product/id-2");

  assert.ok(maxConcurrent <= 2, `Max concurrent ${maxConcurrent} should not exceed limit 2`);
});

test("11. runAutoSeo: delegates to Auto SEO public business logic", async () => {
  const runner = createTestRunner(async () => {
    throw new Error("Should not call moduleApiRunner during runAutoSeo");
  });

  const client = createAutoSeoModuleApiClient(runner);
  const result = await client.runAutoSeo({
    workflowId: "wf-1",
    products: [
      {
        productId: "gid://shopify/Product/1",
        handle: "prod-1",
        title: "Product One",
        descriptionHtml: "<p>Description</p>",
        images: [{ url: "https://example.com/1.jpg" }],
      },
    ],
    selectedProductIds: ["gid://shopify/Product/1"],
  });

  assert.equal(result.workflowId, "wf-1");
  assert.equal(result.selectedCount, 1);
  assert.equal(result.seoContentInputs[0]?.productId, "gid://shopify/Product/1");
  assert.equal(result.seoContentInputs[0]?.sourceTitle, "Product One");
});

test("12. stores.list: selects first valid store when earlier stores are invalid or empty", async () => {
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [
            { storeId: "  ", shopDomain: "invalid.myshopify.com", authType: "static" },
            { storeId: "store-bad-domain", shopDomain: "", authType: "static" },
            { storeId: "  store-valid-2  ", shopDomain: "  valid.myshopify.com  ", authType: "static" },
          ],
          total: 3,
        },
      } as unknown as ShopifyApiResponse;
    }
    throw new Error("Unexpected operation");
  });

  const client = createAutoSeoModuleApiClient(runner);
  const info = await client.getStoreInfo?.();

  assert.deepEqual(info, {
    storeId: "store-valid-2",
    shopDomain: "valid.myshopify.com",
  });
});

test("13. products.get: throws AUTO_SEO_LOAD_FAILED on empty or whitespace productId", async () => {
  const runner = createTestRunner(async () => {
    throw new Error("Should not be called");
  });

  const client = createAutoSeoModuleApiClient(runner);

  await assert.rejects(
    async () => {
      await client.loadProductDetail("   ");
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await client.loadProductDetailFresh?.("");
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      return true;
    },
  );
});

test("14. loadProductDetail: deduplicates concurrent in-flight requests for the same productId", async () => {
  let apiCalls = 0;
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-dedup", shopDomain: "dedup.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      apiCalls++;
      await new Promise((r) => setTimeout(r, 25));
      return {
        storeId: "store-dedup",
        operation: "products.get",
        success: true,
        data: { product: createMockProduct({ id: input.payload.id }) },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  // Fire 3 simultaneous loadProductDetail calls for the same productId
  const [p1, p2, p3] = await Promise.all([
    client.loadProductDetail("gid://shopify/Product/concurrent-1"),
    client.loadProductDetail("gid://shopify/Product/concurrent-1"),
    client.loadProductDetail("gid://shopify/Product/concurrent-1"),
  ]);

  assert.equal(p1.id, "gid://shopify/Product/concurrent-1");
  assert.equal(p2.id, "gid://shopify/Product/concurrent-1");
  assert.equal(p3.id, "gid://shopify/Product/concurrent-1");
  assert.equal(apiCalls, 1, "Concurrent in-flight requests for the same product must be deduplicated into 1 call");
});

test("15. loadProductDetailFresh: protects cache against race condition where slow in-flight request finishes later", async () => {
  let callCount = 0;
  let releaseSlowRequest: () => void = () => {};

  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-race", shopDomain: "race.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      callCount++;
      if (callCount === 1) {
        // First call is slow
        await new Promise<void>((r) => {
          releaseSlowRequest = r;
        });
        return {
          storeId: "store-race",
          operation: "products.get",
          success: true,
          data: { product: createMockProduct({ id: "gid://shopify/Product/slow", title: "Slow Old Version" }) },
        } as unknown as ShopifyApiResponse;
      }

      // Fresh call
      return {
        storeId: "store-race",
        operation: "products.get",
        success: true,
        data: { product: createMockProduct({ id: "gid://shopify/Product/slow", title: "Fresh Fast Version" }) },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  // 1. Start slow loadProductDetail
  const slowPromise = client.loadProductDetail("gid://shopify/Product/slow");

  // 2. Before slow finishes, invoke loadProductDetailFresh
  const freshDetail = await client.loadProductDetailFresh?.("gid://shopify/Product/slow");
  assert.equal(freshDetail?.title, "Fresh Fast Version");

  // 3. Release slow request
  releaseSlowRequest();
  await slowPromise;

  // 4. Cached detail must NOT be overwritten by the older slow request
  const currentCached = client.getCachedDetail?.("gid://shopify/Product/slow");
  assert.equal(currentCached?.title, "Fresh Fast Version");
});

test("16. hydrateSelectedProductsFresh: halts and rejects with AUTO_SEO_LOAD_FAILED when a product fails", async () => {
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-f", shopDomain: "f.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      if (input.payload.id === "gid://shopify/Product/broken") {
        throw new Error("Network failure on broken product");
      }
      return {
        storeId: "store-f",
        operation: "products.get",
        success: true,
        data: { product: createMockProduct({ id: input.payload.id }) },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  await assert.rejects(
    async () => {
      await client.hydrateSelectedProductsFresh?.([
        "gid://shopify/Product/ok-1",
        "gid://shopify/Product/broken",
        "gid://shopify/Product/ok-2",
      ]);
    },
    (err: unknown) => {
      assert.ok(err instanceof AppError);
      assert.equal(err.code, "AUTO_SEO_LOAD_FAILED");
      assert.ok(err.message.includes("Network failure on broken product") || err.message.includes("Failed to load product detail"));
      return true;
    },
  );
});

test("17. hydrateSelectedProductsFresh: handles 0 or NaN concurrency safely", async () => {
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-safe", shopDomain: "safe.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      return {
        storeId: "store-safe",
        operation: "products.get",
        success: true,
        data: { product: createMockProduct({ id: input.payload.id }) },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  // concurrency 0
  const r1 = await client.hydrateSelectedProductsFresh?.(["gid://shopify/Product/safe-1"], 0);
  assert.equal(r1?.length, 1);
  assert.equal(r1?.[0]?.id, "gid://shopify/Product/safe-1");

  // concurrency NaN
  const r2 = await client.hydrateSelectedProductsFresh?.(["gid://shopify/Product/safe-2"], Number.NaN);
  assert.equal(r2?.length, 1);
  assert.equal(r2?.[0]?.id, "gid://shopify/Product/safe-2");
});

test("18. clearCache: clears cached store summary forcing re-fetch on next store access", async () => {
  let storeFetchCount = 0;
  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      storeFetchCount++;
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: `store-v${storeFetchCount}`, shopDomain: `v${storeFetchCount}.myshopify.com`, authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }
    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  const info1 = await client.getStoreInfo?.();
  assert.equal(info1?.storeId, "store-v1");
  assert.equal(storeFetchCount, 1);

  // Cached
  const info1Again = await client.getStoreInfo?.();
  assert.equal(info1Again?.storeId, "store-v1");
  assert.equal(storeFetchCount, 1);

  // Clear cache
  client.clearCache?.();

  // Re-fetches
  const info2 = await client.getStoreInfo?.();
  assert.equal(info2?.storeId, "store-v2");
  assert.equal(storeFetchCount, 2);
});

test("19. clearDetailCache: clears detail cache while preserving store summary", async () => {
  let storeFetchCount = 0;
  let productFetchCount = 0;

  const runner = createTestRunner(async (input) => {
    if (input.operation === "stores.list") {
      storeFetchCount++;
      return {
        storeId: "system",
        operation: "stores.list",
        success: true,
        data: {
          stores: [{ storeId: "store-persist", shopDomain: "persist.myshopify.com", authType: "static" }],
          total: 1,
        },
      } as unknown as ShopifyApiResponse;
    }

    if (input.operation === "products.get") {
      productFetchCount++;
      return {
        storeId: "store-persist",
        operation: "products.get",
        success: true,
        data: { product: createMockProduct({ id: input.payload.id }) },
      } as unknown as ShopifyApiResponse;
    }

    throw new Error("Unexpected call");
  });

  const client = createAutoSeoModuleApiClient(runner);

  await client.loadProductDetail("gid://shopify/Product/cached-test");
  assert.equal(productFetchCount, 1);
  assert.equal(storeFetchCount, 1);
  assert.ok(client.getCachedDetail?.("gid://shopify/Product/cached-test") !== undefined);

  // Clear detail cache only
  client.clearDetailCache?.();
  assert.equal(client.getCachedDetail?.("gid://shopify/Product/cached-test"), undefined);

  // Fetch product again: product is re-fetched, but store is still cached
  await client.loadProductDetail("gid://shopify/Product/cached-test");
  assert.equal(productFetchCount, 2);
  assert.equal(storeFetchCount, 1, "Store summary should remain cached across clearDetailCache");
});

