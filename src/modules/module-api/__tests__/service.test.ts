import assert from "node:assert/strict";
import test from "node:test";

import {
  createModuleApiRunner,
  DEFAULT_GATEWAY_URL,
  getModuleApiRunner,
  runMockModuleApi,
  runModuleApi,
  ShopifyApiError,
  shopifyApiMockData,
} from "..";
import type { ModuleApiRunner, ShopifyApiInput, ShopifyApiResponse } from "..";

test("Module API selects mock runner in mock environment", async () => {
  const runner = getModuleApiRunner("mock");
  assert.equal(runner, runMockModuleApi);
});

test("Module API selects real service runner in development and production environments", async () => {
  assert.equal(getModuleApiRunner("development"), runModuleApi);
  assert.equal(getModuleApiRunner("production"), runModuleApi);
});

test("Module API rejects empty storeId with SHOPIFY_USER_ERROR", async () => {
  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );
});

test("Module API mock runner executes connection.test", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "connection.test",
    payload: {},
  });

  assert.equal(response.storeId, "store-101");
  assert.equal(response.operation, "connection.test");
  assert.equal(response.success, true);
  assert.equal(response.data.isConnected, true);
  assert.equal(response.data.connected, true);
  assert.equal(response.data.currencyCode, "USD");
  assert.equal(response.data.shopDomain, "quickstart-demo.myshopify.com");
});

test("Module API mock runner executes products.list with filtering", async () => {
  const allResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: {},
  });

  assert.equal(allResponse.success, true);
  assert.equal(allResponse.data.products.length, 3);
  assert.ok(allResponse.data.pageInfo);

  const activeResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: { status: "ACTIVE" },
  });

  assert.equal(activeResponse.data.products.length, 2);
  assert.ok(activeResponse.data.products.every((p) => p.status === "ACTIVE"));

  const filteredResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: { query: "Coffee" },
  });

  assert.equal(filteredResponse.data.products.length, 1);
  assert.equal(filteredResponse.data.products[0]?.title, "Ceramic Coffee Mug");
});

test("Module API mock runner executes products.get", async () => {
  const foundResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.get",
    payload: { id: "gid://shopify/Product/1001" },
  });

  assert.equal(foundResponse.success, true);
  assert.notEqual(foundResponse.data.product, null);
  assert.equal(foundResponse.data.product?.title, "Classic Cotton T-Shirt");

  const notFoundResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.get",
    payload: { id: "gid://shopify/Product/non-existent" },
  });

  assert.equal(notFoundResponse.data.product, null);
});

test("Module API mock runner executes products.create", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.create",
    payload: {
      product: {
        title: "New Graphic Hoodie",
        vendor: "Acme Apparel",
        tags: ["hoodie", "winter"],
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.product.title, "New Graphic Hoodie");
  assert.equal(response.data.product.vendor, "Acme Apparel");
  assert.ok(response.data.product.id.startsWith("gid://shopify/Product/"));
  assert.equal(response.data.product.variants.length, 1);
});

test("Module API mock runner executes products.update", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.update",
    payload: {
      id: "gid://shopify/Product/1001",
      product: {
        title: "Updated Cotton T-Shirt",
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.product.id, "gid://shopify/Product/1001");
  assert.equal(response.data.product.title, "Updated Cotton T-Shirt");
});

test("Module API mock runner executes products.bulkUpdate", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.bulkUpdate",
    payload: {
      products: [
        { id: "gid://shopify/Product/1001", product: { title: "P1 Updated" } },
        { id: "gid://shopify/Product/1002", product: { title: "P2 Updated" } },
      ],
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.count, 2);
  assert.deepEqual(response.data.updatedProductIds, [
    "gid://shopify/Product/1001",
    "gid://shopify/Product/1002",
  ]);
});

test("Module API mock runner executes products.delete", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.delete",
    payload: { id: "gid://shopify/Product/1001" },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.deletedProductId, "gid://shopify/Product/1001");
});

test("Module API mock runner executes variants.update", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "variants.update",
    payload: {
      id: "gid://shopify/ProductVariant/2001",
      variant: {
        price: "29.99",
        inventoryQuantity: 50,
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.variant.id, "gid://shopify/ProductVariant/2001");
  assert.equal(response.data.variant.price, "29.99");
  assert.equal(response.data.variant.inventoryQuantity, 50);
});

test("Module API mock runner executes variants.bulkUpdate", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "variants.bulkUpdate",
    payload: {
      variants: [
        { id: "gid://shopify/ProductVariant/2001", variant: { price: "27.50" } },
        { id: "gid://shopify/ProductVariant/2002", variant: { price: "27.50" } },
      ],
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.count, 2);
  assert.deepEqual(response.data.updatedVariantIds, [
    "gid://shopify/ProductVariant/2001",
    "gid://shopify/ProductVariant/2002",
  ]);
});

test("Module API mock runner executes collections.list and collections.get", async () => {
  const listResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.list",
    payload: {},
  });

  assert.equal(listResponse.success, true);
  assert.equal(listResponse.data.collections.length, 2);

  const getResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.get",
    payload: { id: "gid://shopify/Collection/3001" },
  });

  assert.equal(getResponse.success, true);
  assert.notEqual(getResponse.data.collection, null);
  assert.equal(getResponse.data.collection?.title, "Summer Collection");
});

test("Module API mock runner executes collections.create, update, delete, and updateMembership", async () => {
  const createResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.create",
    payload: {
      collection: {
        title: "New Arrivals",
      },
    },
  });
  assert.equal(createResponse.data.collection.title, "New Arrivals");

  const updateResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.update",
    payload: {
      id: "gid://shopify/Collection/3001",
      collection: {
        title: "Summer 2025 Sale",
      },
    },
  });
  assert.equal(updateResponse.data.collection.title, "Summer 2025 Sale");

  const deleteResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.delete",
    payload: { id: "gid://shopify/Collection/3001" },
  });
  assert.equal(deleteResponse.data.deletedCollectionId, "gid://shopify/Collection/3001");

  const membershipResponse = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.updateMembership",
    payload: {
      collectionId: "gid://shopify/Collection/3002",
      productIdsToAdd: ["gid://shopify/Product/1001"],
      productIdsToRemove: ["gid://shopify/Product/1002"],
    },
  });
  assert.equal(membershipResponse.data.collectionId, "gid://shopify/Collection/3002");
  assert.equal(membershipResponse.data.addedCount, 1);
  assert.equal(membershipResponse.data.removedCount, 1);
});

test("Module API mock runner returns isolated copies that do not mutate fixtures", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: {},
  });

  assert.notEqual(response.data.products, shopifyApiMockData.products);
  assert.notEqual(response.data.products[0], shopifyApiMockData.products[0]);
  assert.notEqual(response.data.products[0]?.variants, shopifyApiMockData.products[0]?.variants);
});

test("Module API mock runner simulates domain errors via storeId hooks", async () => {
  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-auth-failure",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_AUTH_FAILED");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-throttled",
        operation: "products.list",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_THROTTLED");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-network-error",
        operation: "products.list",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-unknown-state",
        operation: "products.delete",
        payload: { id: "gid://shopify/Product/1001" },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Module API real service fails predictably when unconfigured", async () => {
  await assert.rejects(
    async () => {
      await runModuleApi({
        storeId: "",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runModuleApi({
        storeId: "store-real-1",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );
});

test("Module API mock runner handles products.list cursor-based pagination", async () => {
  const page1 = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: { limit: 2 },
  });

  assert.equal(page1.data.products.length, 2);
  assert.equal(page1.data.pageInfo.hasNextPage, true);
  assert.equal(page1.data.pageInfo.hasPreviousPage, false);
  assert.ok(page1.data.pageInfo.startCursor);
  assert.ok(page1.data.pageInfo.endCursor);

  const page2 = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.list",
    payload: {
      limit: 2,
      cursor: page1.data.pageInfo.endCursor,
    },
  });

  assert.equal(page2.data.products.length, 1);
  assert.equal(page2.data.products[0]?.title, "Vintage Denim Jacket");
  assert.equal(page2.data.pageInfo.hasNextPage, false);
  assert.equal(page2.data.pageInfo.hasPreviousPage, true);

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "store-101",
        operation: "products.list",
        payload: { limit: 0 },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );
});

test("Module API mock runner handles collections.list cursor-based pagination", async () => {
  const page1 = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.list",
    payload: { limit: 1 },
  });

  assert.equal(page1.data.collections.length, 1);
  assert.equal(page1.data.pageInfo.hasNextPage, true);
  assert.equal(page1.data.pageInfo.hasPreviousPage, false);
  assert.ok(page1.data.pageInfo.endCursor);

  const page2 = await runMockModuleApi({
    storeId: "store-101",
    operation: "collections.list",
    payload: {
      limit: 1,
      cursor: page1.data.pageInfo.endCursor,
    },
  });

  assert.equal(page2.data.collections.length, 1);
  assert.equal(page2.data.collections[0]?.title, "Best Sellers");
  assert.equal(page2.data.pageInfo.hasNextPage, false);
  assert.equal(page2.data.pageInfo.hasPreviousPage, true);
});

test("Module API mock runner variants.update preserves existing variant attributes and correct productId", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "variants.update",
    payload: {
      id: "gid://shopify/ProductVariant/2003",
      variant: { price: "18.50" },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.variant.id, "gid://shopify/ProductVariant/2003");
  assert.equal(response.data.variant.productId, "gid://shopify/Product/1002");
  assert.equal(response.data.variant.title, "Default Title");
  assert.equal(response.data.variant.sku, "MUG-WHT-12OZ");
  assert.equal(response.data.variant.barcode, "123456789014");
  assert.equal(response.data.variant.inventoryQuantity, 100);
  assert.equal(response.data.variant.price, "18.50");
});

test("Module API mock runner validates required input fields", async () => {
  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "store-101",
        operation: "products.get",
        payload: { id: "   " },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "store-101",
        operation: "products.create",
        payload: { product: { title: "" } },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "store-101",
        operation: "collections.updateMembership",
        payload: { collectionId: "" },
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runMockModuleApi({
        storeId: "simulate-user-error",
        operation: "connection.test",
        payload: {},
      });
    },
    (error: unknown) => {
      assert.ok(error instanceof ShopifyApiError);
      assert.equal(error.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );
});

interface RecordedRequest {
  url: string | URL | Request;
  init?: RequestInit;
}

function createFakeFetch(
  handler: (req: RecordedRequest) => Promise<Response> | Response,
): {
  fetch: typeof fetch;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const recorded = { url, init };
    requests.push(recorded);
    return handler(recorded);
  };
  return { fetch: fakeFetch as typeof fetch, requests };
}

test("Real service sends correct request body and headers to gateway", async () => {
  const { fetch: fakeFetch, requests } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.create",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/999",
            title: "New Item",
            handle: "new-item",
            status: "DRAFT",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "products.create",
    requestId: "req-12345",
    mode: "preview",
    payload: {
      product: {
        title: "New Item",
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://gateway.example.com/api");
  assert.equal(requests[0].init?.method, "POST");

  const headers = requests[0].init?.headers as Record<string, string>;
  assert.equal(headers["Content-Type"], "application/json");
  assert.equal(headers["X-Request-Id"], "req-12345");

  const body = JSON.parse(requests[0].init?.body as string);
  assert.deepEqual(body, {
    storeId: "store-42",
    operation: "products.create",
    requestId: "req-12345",
    mode: "preview",
    payload: {
      product: {
        title: "New Item",
      },
    },
  });
});

test("Real service executes products.list response success", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.list",
        success: true,
        data: {
          products: [
            {
              id: "gid://shopify/Product/1",
              title: "Product 1",
              handle: "product-1",
              status: "ACTIVE",
              tags: ["tag1"],
              variants: [],
              createdAt: "2026-01-01T00:00:00Z",
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "products.list",
    payload: { limit: 10 },
  });

  assert.equal(response.success, true);
  assert.equal(response.operation, "products.list");
  assert.equal(response.data.products.length, 1);
  assert.equal(response.data.products[0].title, "Product 1");
  assert.equal(response.data.pageInfo.hasNextPage, false);
});

test("Real service executes products.get response success", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.get",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/1",
            title: "Product 1",
            handle: "product-1",
            status: "ACTIVE",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "products.get",
    payload: { id: "gid://shopify/Product/1" },
  });

  assert.equal(response.success, true);
  assert.equal(response.operation, "products.get");
  assert.equal(response.data.product?.id, "gid://shopify/Product/1");
});

test("Real service executes collections.list response success", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "collections.list",
        success: true,
        data: {
          collections: [
            {
              id: "gid://shopify/Collection/1",
              title: "Summer Collection",
              handle: "summer",
              productsCount: 5,
              updatedAt: "2026-01-01T00:00:00Z",
            },
          ],
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "collections.list",
    payload: {},
  });

  assert.equal(response.success, true);
  assert.equal(response.operation, "collections.list");
  assert.equal(response.data.collections.length, 1);
  assert.equal(response.data.collections[0].title, "Summer Collection");
});

test("Real service executes connection.test success", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "connection.test",
        success: true,
        data: {
          isConnected: true,
          connected: true,
          shopDomain: "my-shop.myshopify.com",
          shopName: "My Shop",
          currencyCode: "USD",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "connection.test",
    payload: {},
  });

  assert.equal(response.success, true);
  assert.equal(response.operation, "connection.test");
  assert.equal(response.data.isConnected, true);
  assert.equal(response.data.shopDomain, "my-shop.myshopify.com");
});

test("Real service maps HTTP non-2xx status codes predictably", async () => {
  // 401 Unauthorized -> SHOPIFY_AUTH_FAILED
  const auth401Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Unauthorized", { status: 401 })).fetch },
  );
  await assert.rejects(
    async () => {
      await auth401Runner({ storeId: "s1", operation: "connection.test", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
      return true;
    },
  );

  // 403 Forbidden -> SHOPIFY_AUTH_FAILED
  const auth403Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Forbidden", { status: 403 })).fetch },
  );
  await assert.rejects(
    async () => {
      await auth403Runner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
      return true;
    },
  );

  // 429 Too Many Requests -> SHOPIFY_THROTTLED
  const throttledRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Rate limit exceeded", { status: 429 })).fetch },
  );
  await assert.rejects(
    async () => {
      await throttledRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_THROTTLED");
      return true;
    },
  );

  // 400 Bad Request -> SHOPIFY_USER_ERROR
  const userErr400Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Bad Request", { status: 400 })).fetch },
  );
  await assert.rejects(
    async () => {
      await userErr400Runner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  // 404 Not Found -> SHOPIFY_USER_ERROR
  const userErr404Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Not Found", { status: 404 })).fetch },
  );
  await assert.rejects(
    async () => {
      await userErr404Runner({ storeId: "s1", operation: "products.get", payload: { id: "not-found" } });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  // 422 Unprocessable Entity -> SHOPIFY_USER_ERROR
  const userErr422Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Unprocessable Entity", { status: 422 })).fetch },
  );
  await assert.rejects(
    async () => {
      await userErr422Runner({
        storeId: "s1",
        operation: "products.create",
        payload: { product: { title: "Invalid" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  // 500 on Read -> SHOPIFY_NETWORK_ERROR
  const serverErrReadRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Internal Server Error", { status: 500 })).fetch },
  );
  await assert.rejects(
    async () => {
      await serverErrReadRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  // 500 on Write -> SHOPIFY_UNKNOWN_WRITE_STATE
  const serverErrWriteRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Internal Server Error", { status: 500 })).fetch },
  );
  await assert.rejects(
    async () => {
      await serverErrWriteRunner({
        storeId: "s1",
        operation: "products.create",
        payload: { product: { title: "Item" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );

  // 503 on Write -> SHOPIFY_UNKNOWN_WRITE_STATE
  const server503WriteRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: createFakeFetch(async () => new Response("Service Unavailable", { status: 503 })).fetch },
  );
  await assert.rejects(
    async () => {
      await server503WriteRunner({
        storeId: "s1",
        operation: "products.delete",
        payload: { id: "p-delete" },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );

  // Non-2xx with explicit JSON error code in body
  const customErrorRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({ error: { code: "SHOPIFY_THROTTLED", message: "Exceeded Shopify query cost" } }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );
  await assert.rejects(
    async () => {
      await customErrorRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_THROTTLED");
      assert.equal(err.message, "Exceeded Shopify query cost");
      return true;
    },
  );
});

test("Real service handles malformed JSON response", async () => {
  const malformedFetch = createFakeFetch(async () =>
    new Response("<html><body>502 Bad Gateway</body></html>", {
      status: 200,
      headers: { "Content-Type": "text/html" },
    }),
  ).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: malformedFetch },
  );

  // Read operation malformed JSON -> SHOPIFY_NETWORK_ERROR
  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "collections.get", payload: { id: "c1" } });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  // Write operation malformed JSON -> SHOPIFY_UNKNOWN_WRITE_STATE
  await assert.rejects(
    async () => {
      await runner({
        storeId: "s1",
        operation: "variants.update",
        payload: { id: "v1", variant: { price: "12.00" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Real service maps read network failure to SHOPIFY_NETWORK_ERROR", async () => {
  const networkErrorFetch = createFakeFetch(async () => {
    throw new TypeError("Failed to fetch");
  }).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: networkErrorFetch },
  );

  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "connection.test", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );
});

test("Real service maps ambiguous write network failure to SHOPIFY_UNKNOWN_WRITE_STATE across all write operations", async () => {
  const networkErrorFetch = createFakeFetch(async () => {
    throw new Error("ECONNRESET");
  }).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: networkErrorFetch },
  );

  const writeInputs: ShopifyApiInput[] = [
    { storeId: "s1", operation: "products.create", payload: { product: { title: "T" } } },
    { storeId: "s1", operation: "products.update", payload: { id: "p1", product: { title: "T2" } } },
    { storeId: "s1", operation: "products.bulkUpdate", payload: { products: [{ id: "p1", product: {} }] } },
    { storeId: "s1", operation: "products.delete", payload: { id: "p1" } },
    { storeId: "s1", operation: "variants.update", payload: { id: "v1", variant: {} } },
    { storeId: "s1", operation: "variants.bulkUpdate", payload: { variants: [{ id: "v1", variant: {} }] } },
    { storeId: "s1", operation: "collections.create", payload: { collection: { title: "C" } } },
    { storeId: "s1", operation: "collections.update", payload: { id: "c1", collection: {} } },
    { storeId: "s1", operation: "collections.delete", payload: { id: "c1" } },
    { storeId: "s1", operation: "collections.updateMembership", payload: { collectionId: "c1" } },
  ];

  for (const writeInput of writeInputs) {
    await assert.rejects(
      async () => {
        await runner(writeInput);
      },
      (err: unknown) => {
        assert.ok(err instanceof ShopifyApiError);
        assert.equal(
          err.code,
          "SHOPIFY_UNKNOWN_WRITE_STATE",
          `Expected SHOPIFY_UNKNOWN_WRITE_STATE for operation ${writeInput.operation}`,
        );
        return true;
      },
    );
  }
});

test("Real service forwards preview mode intact without changing to apply", async () => {
  const { fetch: fakeFetch, requests } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.create",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/999",
            title: "Preview",
            handle: "preview",
            status: "DRAFT",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  await runner({
    storeId: "store-42",
    operation: "products.create",
    mode: "preview",
    payload: { product: { title: "Preview" } },
  });

  assert.equal(requests.length, 1);
  const parsed = JSON.parse(requests[0].init?.body as string);
  assert.equal(parsed.mode, "preview");
  assert.notEqual(parsed.mode, "apply");
});

test("Real service forwards apply mode intact", async () => {
  const { fetch: fakeFetch, requests } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.update",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/1001",
            title: "Applied",
            handle: "applied",
            status: "ACTIVE",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  await runner({
    storeId: "store-42",
    operation: "products.update",
    mode: "apply",
    payload: { id: "gid://shopify/Product/1001", product: { title: "Applied" } },
  });

  assert.equal(requests.length, 1);
  const parsed = JSON.parse(requests[0].init?.body as string);
  assert.equal(parsed.mode, "apply");
});

test("Real service does not mutate input object", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.create",
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/1",
            title: "Immutable",
            handle: "immutable",
            status: "DRAFT",
            tags: [],
            variants: [],
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const payload = Object.freeze({
    product: Object.freeze({
      title: "Immutable",
      tags: Object.freeze(["a", "b"]),
    }),
  });

  const input = Object.freeze({
    storeId: "store-42",
    operation: "products.create" as const,
    requestId: "req-freeze-99",
    mode: "preview" as const,
    payload,
  });

  const response = await runner(input);
  assert.equal(response.success, true);
  assert.equal(input.storeId, "store-42");
  assert.equal(input.requestId, "req-freeze-99");
  assert.equal(input.mode, "preview");
});

test("Runtime selects mock or real service runner according to environment", async () => {
  assert.equal(getModuleApiRunner("mock"), runMockModuleApi);
  assert.equal(getModuleApiRunner("development"), runModuleApi);
  assert.equal(getModuleApiRunner("production"), runModuleApi);

  const { fetch: fakeFetch, requests } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-configured",
        operation: "connection.test",
        success: true,
        data: {
          isConnected: true,
          connected: true,
          shopDomain: "configured.myshopify.com",
          shopName: "Configured",
          currencyCode: "USD",
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const configuredRunner = getModuleApiRunner(
    "development",
    { gatewayUrl: "https://injected.gateway.internal/api" },
    { fetch: fakeFetch },
  );

  const res = await configuredRunner({
    storeId: "store-configured",
    operation: "connection.test",
    payload: {},
  });

  assert.equal(res.success, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://injected.gateway.internal/api");
});

test("Mock and real service conform to identical public ModuleApiRunner contract", async () => {
  const realRunner: ModuleApiRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            storeId: "store-contract",
            operation: "connection.test",
            success: true,
            data: {
              isConnected: true,
              connected: true,
              shopDomain: "contract.myshopify.com",
              shopName: "Contract Store",
              currencyCode: "USD",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  const mockRunner: ModuleApiRunner = runMockModuleApi;

  const realRes = await realRunner({
    storeId: "store-contract",
    operation: "connection.test",
    payload: {},
  });

  const mockRes = await mockRunner({
    storeId: "store-contract",
    operation: "connection.test",
    payload: {},
  });

  assert.equal(typeof realRes.storeId, "string");
  assert.equal(typeof mockRes.storeId, "string");
  assert.equal(realRes.operation, "connection.test");
  assert.equal(mockRes.operation, "connection.test");
  assert.equal(realRes.success, true);
  assert.equal(mockRes.success, true);
  assert.equal(typeof realRes.data.connected, "boolean");
  assert.equal(typeof mockRes.data.connected, "boolean");
});

test("Real service sanitizes error messages and does not expose secrets or credentials", async () => {
  const secretLeakingFetch = createFakeFetch(async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "SHOPIFY_AUTH_FAILED",
          message: "Bearer shpat_secret_123456789 was rejected by authorization server",
        },
      }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    ),
  ).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: secretLeakingFetch },
  );

  await assert.rejects(
    async () => {
      await runner({ storeId: "store-1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
      assert.equal(err.message.includes("shpat_secret_123456789"), false);
      assert.equal(err.message.includes("secret"), false);
      assert.equal(err.message.includes("Bearer"), false);
      return true;
    },
  );
});

test("Real service handles timeouts predictably", async () => {
  const hangingFetch = createFakeFetch(
    (_req) =>
      new Promise<Response>((_resolve, reject) => {
        _req.init?.signal?.addEventListener("abort", () => {
          reject(new Error("The operation was aborted"));
        });
      }),
  ).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api", timeoutMs: 20 },
    { fetch: hangingFetch },
  );

  // Read timeout -> SHOPIFY_NETWORK_ERROR
  await assert.rejects(
    async () => {
      await runner({ storeId: "store-1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  // Write timeout -> SHOPIFY_UNKNOWN_WRITE_STATE
  await assert.rejects(
    async () => {
      await runner({
        storeId: "store-1",
        operation: "products.create",
        payload: { product: { title: "Timeout Product" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Real service validates input before sending network request", async () => {
  let wasCalled = false;
  const dummyFetch = createFakeFetch(async () => {
    wasCalled = true;
    return new Response("{}", { status: 200 });
  }).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: dummyFetch },
  );

  // Empty storeId
  await assert.rejects(
    async () => {
      await runner({ storeId: "", operation: "connection.test", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  // Missing payload
  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "connection.test", payload: null as unknown as {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      return true;
    },
  );

  // Unsupported operation
  await assert.rejects(
    async () => {
      await runner({
        storeId: "s1",
        operation: "unsupported.operation" as unknown as "connection.test",
        payload: {},
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      assert.ok(err.message.includes("Unsupported Shopify operation"));
      return true;
    },
  );

  assert.equal(wasCalled, false);
});

test("Real service preserves cause in ShopifyApiError for network errors, timeouts, and JSON parse errors", async () => {
  const originalNetworkError = new TypeError("Failed to connect to gateway");
  const failingFetch = createFakeFetch(async () => {
    throw originalNetworkError;
  }).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: failingFetch },
  );

  // Read network error preserves cause
  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      assert.equal(err.cause, originalNetworkError);
      return true;
    },
  );

  // Write network error preserves cause
  await assert.rejects(
    async () => {
      await runner({
        storeId: "s1",
        operation: "products.delete",
        payload: { id: "p1" },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      assert.equal(err.cause, originalNetworkError);
      return true;
    },
  );

  // JSON parse error preserves cause
  const malformedFetch = createFakeFetch(async () => {
    return new Response("<<<not json>>>", { status: 200 });
  }).fetch;

  const malformedRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: malformedFetch },
  );

  await assert.rejects(
    async () => {
      await malformedRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      assert.ok(err.cause instanceof SyntaxError);
      return true;
    },
  );
});

test("Real service maps HTTP 408 Request Timeout to SHOPIFY_UNKNOWN_WRITE_STATE for writes and SHOPIFY_NETWORK_ERROR for reads", async () => {
  const timeoutFetch = createFakeFetch(async () => {
    return new Response("Request Timeout", { status: 408 });
  }).fetch;

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: timeoutFetch },
  );

  // Read on 408
  await assert.rejects(
    async () => {
      await runner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );

  // Write on 408
  await assert.rejects(
    async () => {
      await runner({
        storeId: "s1",
        operation: "products.create",
        payload: { product: { title: "Item" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Real service handles diverse gateway error response formats correctly", async () => {
  // Format 1: HTTP 200 with error object { error: { code, message } }
  const errObjRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            error: { code: "SHOPIFY_USER_ERROR", message: "Invalid product handle" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await errObjRunner({
        storeId: "s1",
        operation: "products.create",
        payload: { product: { title: "T" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      assert.equal(err.message, "Invalid product handle");
      return true;
    },
  );

  // Format 2: HTTP 200 with success: false and string error
  const stringErrRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            success: false,
            error: "Product title is required",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await stringErrRunner({
        storeId: "s1",
        operation: "products.create",
        payload: { product: { title: "" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      assert.equal(err.message, "Product title is required");
      return true;
    },
  );

  // Format 3: HTTP 401 with string error: { error: "Invalid credentials" }
  const string401Runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({ error: "Access denied" }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await string401Runner({ storeId: "s1", operation: "connection.test", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
      assert.equal(err.message, "Access denied");
      return true;
    },
  );

  // Format 4: GraphQL errors array
  const gqlErrRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            errors: [{ message: "Field 'sku' is invalid", code: "USER_ERROR" }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await gqlErrRunner({
        storeId: "s1",
        operation: "variants.update",
        payload: { id: "v1", variant: { sku: "bad" } },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      assert.equal(err.message, "Field 'sku' is invalid");
      return true;
    },
  );
});

test("Real service validates that response data payload is an object", async () => {
  // data is null
  const nullDataRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(JSON.stringify({ success: true, data: null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await nullDataRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
      assert.ok(err.message.includes("missing data payload"));
      return true;
    },
  );

  // data is a string instead of an object
  const nonObjectDataRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(JSON.stringify({ success: true, data: "invalid" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await nonObjectDataRunner({
        storeId: "s1",
        operation: "products.delete",
        payload: { id: "p1" },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
      return true;
    },
  );
});

test("Real service sanitizes raw stack traces, system errors, and credentials in error messages", async () => {
  // Stack trace in error message
  const stackTraceRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            message: "Error: connect ECONNREFUSED 127.0.0.1:8080\n    at TCPConnectWrap.afterConnect (node:net:1605:16)",
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await stackTraceRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.message.includes("TCPConnectWrap"), false);
      assert.equal(err.message.includes("ECONNREFUSED"), false);
      assert.equal(err.message, "Shopify gateway request failed with status 500");
      return true;
    },
  );

  // Proxy credential leaking
  const credentialRunner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    {
      fetch: createFakeFetch(async () =>
        new Response(
          JSON.stringify({
            message: "Proxy credential validation failed for user admin",
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      ).fetch,
    },
  );

  await assert.rejects(
    async () => {
      await credentialRunner({ storeId: "s1", operation: "products.list", payload: {} });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.message.includes("credential"), false);
      assert.equal(err.message, "Shopify gateway request failed with status 401");
      return true;
    },
  );
});

test("Real service executes collections.get response success", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "collections.get",
        success: true,
        data: {
          collection: {
            id: "gid://shopify/Collection/1",
            title: "Summer Collection",
            handle: "summer",
            productsCount: 5,
            updatedAt: "2026-01-01T00:00:00Z",
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  const response = await runner({
    storeId: "store-42",
    operation: "collections.get",
    payload: { id: "gid://shopify/Collection/1" },
  });

  assert.equal(response.success, true);
  assert.equal(response.operation, "collections.get");
  assert.equal(response.data.collection?.id, "gid://shopify/Collection/1");
  assert.equal(response.data.collection?.title, "Summer Collection");
});

test("Real service propagates fields, retryable, and details into ShopifyApiError", async () => {
  const { fetch: fakeFetch } = createFakeFetch(async () => {
    return new Response(
      JSON.stringify({
        storeId: "store-42",
        operation: "products.create",
        success: false,
        error: {
          code: "SHOPIFY_USER_ERROR",
          message: "Title cannot be blank",
          fields: ["product", "title"],
          retryable: false,
          details: { fieldErrors: [{ field: "title", error: "blank" }] },
        },
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  });

  const runner = createModuleApiRunner(
    { gatewayUrl: "https://gateway.example.com/api" },
    { fetch: fakeFetch },
  );

  await assert.rejects(
    async () => {
      await runner({
        storeId: "store-42",
        operation: "products.create",
        payload: {
          product: { title: "" },
        },
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof ShopifyApiError);
      assert.equal(err.code, "SHOPIFY_USER_ERROR");
      assert.equal(err.message, "Title cannot be blank");
      assert.deepEqual(err.fields, ["product", "title"]);
      assert.equal(err.retryable, false);
      assert.deepEqual(err.details, { fieldErrors: [{ field: "title", error: "blank" }] });
      return true;
    },
  );
});

test("Mock runner supports custom variants in products.create", async () => {
  const response = await runMockModuleApi({
    storeId: "store-101",
    operation: "products.create",
    payload: {
      product: {
        title: "Multi-Variant T-Shirt",
        productOptions: [{ name: "Size", values: ["S", "M", "L"] }],
        variants: [
          {
            title: "S",
            price: "19.99",
            sku: "TSHIRT-S",
            optionValues: [{ optionName: "Size", name: "S" }],
          },
          {
            title: "M",
            price: "21.99",
            sku: "TSHIRT-M",
            optionValues: [{ optionName: "Size", name: "M" }],
          },
        ],
      },
    },
  });

  assert.equal(response.success, true);
  assert.equal(response.data.product.title, "Multi-Variant T-Shirt");
  assert.equal(response.data.product.variants.length, 2);
  assert.equal(response.data.product.variants[0]?.price, "19.99");
  assert.equal(response.data.product.variants[0]?.sku, "TSHIRT-S");
  assert.equal(response.data.product.variants[1]?.price, "21.99");
  assert.equal(response.data.product.variants[1]?.sku, "TSHIRT-M");
});



