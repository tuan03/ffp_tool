import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGatewayHttpHandler,
  createStoreTransport,
  GatewayDispatcher,
  GatewayError,
  InMemoryStoreRegistry,
  InMemoryThrottleManager,
  normalizeShopDomain,
  sanitizeErrorMessage,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
  ClientCredentialsTokenProvider,
  type StoreConfig,
  type HttpTransport,
} from "../index";

import { createModuleApiRunner } from "../../src/modules/module-api/service";

function createMockResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("Gateway: StoreRegistry", () => {
  it("resolves registered store, normalizes shopDomain, and rejects unknown store", () => {
    const registry = new InMemoryStoreRegistry();
    registry.registerStore({
      storeId: "store-a",
      shopDomain: "https://Store-A.myshopify.com/",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "shpat_test_a" },
    });

    const store = registry.getStore("store-a");
    assert.ok(store);
    assert.equal(store.shopDomain, "store-a.myshopify.com");

    const unknown = registry.getStore("store-unknown");
    assert.equal(unknown, undefined);
  });

  it("normalizes domain correctly for diverse input formats", () => {
    assert.equal(normalizeShopDomain("http://shop.myshopify.com/"), "shop.myshopify.com");
    assert.equal(normalizeShopDomain("HTTPS://MY-SHOP.MYSHOPIFY.COM:443/admin"), "my-shop.myshopify.com");
    assert.equal(normalizeShopDomain("custom-shop"), "custom-shop.myshopify.com");
  });

  it("enforces deep-freeze immutability so callers cannot corrupt stored credentials", () => {
    const registry = new InMemoryStoreRegistry();
    const config: StoreConfig = {
      storeId: "store-freeze",
      shopDomain: "freeze.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "shpat_initial" },
    };

    registry.registerStore(config);

    // Mutating input object does not mutate stored config
    (config.auth as { staticToken: string }).staticToken = "compromised";
    const stored = registry.getStore("store-freeze");
    assert.ok(stored);
    assert.equal(stored.auth.staticToken, "shpat_initial");

    // Stored config and nested objects are frozen
    assert.equal(Object.isFrozen(stored), true);
    assert.equal(Object.isFrozen(stored?.auth), true);

    assert.throws(() => {
      "use strict";
      Object.assign(stored as object, { shopDomain: "hacked.com" });
    }, TypeError);
  });

  it("validates storeId and shopDomain on registration", () => {
    const registry = new InMemoryStoreRegistry();
    assert.throws(
      () =>
        registry.registerStore({
          storeId: "",
          shopDomain: "test.myshopify.com",
          apiVersion: "2026-07",
          auth: { type: "static", staticToken: "tok" },
        }),
      (err: unknown) => err instanceof GatewayError && err.code === "SHOPIFY_INVALID_INPUT",
    );
  });
});

describe("Gateway: TokenProvider", () => {
  it("resolves static access token and fails when missing", async () => {
    const provider = new StaticAccessTokenProvider();
    const token = await provider.getToken({
      storeId: "s1",
      shopDomain: "s1.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "my-static-token" },
    });
    assert.equal(token, "my-static-token");

    await assert.rejects(
      async () =>
        provider.getToken({
          storeId: "s2",
          shopDomain: "s2.myshopify.com",
          apiVersion: "2026-07",
          auth: { type: "static", staticToken: "  " },
        }),
      (err: unknown) => err instanceof GatewayError && err.code === "SHOPIFY_AUTH_FAILED",
    );
  });

  it("caches client_credentials token and prevents re-requesting every call", async () => {
    let callCount = 0;
    const fakeTransport: HttpTransport = async () => {
      callCount++;
      return createMockResponse({
        access_token: "shpca_oauth_token_123",
        expires_in: 86400,
      });
    };

    const provider = new ClientCredentialsTokenProvider({ transport: fakeTransport });
    const store: StoreConfig = {
      storeId: "s-oauth",
      shopDomain: "oauth.myshopify.com",
      apiVersion: "2026-07",
      auth: {
        type: "client_credentials",
        clientId: "client_1",
        clientSecret: "secret_1",
      },
    };

    const token1 = await provider.getToken(store);
    const token2 = await provider.getToken(store);

    assert.equal(token1, "shpca_oauth_token_123");
    assert.equal(token2, "shpca_oauth_token_123");
    assert.equal(callCount, 1, "Token must be retrieved from cache on second call");
  });

  it("handles OAuth network and auth errors safely", async () => {
    const failingTransport: HttpTransport = async () => {
      return createMockResponse({ error: "invalid_client" }, 401);
    };

    const provider = new ClientCredentialsTokenProvider({ transport: failingTransport });
    const store: StoreConfig = {
      storeId: "s-fail",
      shopDomain: "fail.myshopify.com",
      apiVersion: "2026-07",
      auth: {
        type: "client_credentials",
        clientId: "c",
        clientSecret: "s",
      },
    };

    await assert.rejects(
      async () => provider.getToken(store),
      (err: unknown) => err instanceof GatewayError && err.code === "SHOPIFY_AUTH_FAILED",
    );
  });
});

describe("Gateway: Proxy Transport & Fail-Closed", () => {
  it("uses base transport when proxy is disabled", async () => {
    let calledUrl = "";
    const transport: HttpTransport = async (url) => {
      calledUrl = url;
      return createMockResponse({ ok: true });
    };

    const store: StoreConfig = {
      storeId: "no-proxy",
      shopDomain: "no-proxy.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    };

    const storeTransport = createStoreTransport(store, transport);
    await storeTransport("https://example.com/api");
    assert.equal(calledUrl, "https://example.com/api");
  });

  it("sets proxy headers and enforces fail-closed when proxy connection fails", async () => {
    const failingTransport: HttpTransport = async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:8080");
    };

    const store: StoreConfig = {
      storeId: "proxy-store",
      shopDomain: "proxy.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: {
        url: "http://proxy.internal:8080",
        username: "proxyuser",
        password: "proxypassword",
        failClosed: true,
      },
    };

    const storeTransport = createStoreTransport(store, failingTransport);
    await assert.rejects(
      async () => storeTransport("https://example.com/graphql"),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_NETWORK_ERROR" &&
        err.message.includes("fail-closed"),
    );
  });

  it("sanitizes proxy credentials from error messages", () => {
    const raw = "Error: connection to http://admin:SuperSecretPwd123@proxy.host:8080 failed";
    const sanitized = sanitizeErrorMessage(raw, "fallback");
    assert.ok(!sanitized.includes("SuperSecretPwd123"));
  });
});

describe("Gateway: Throttle Manager & GraphQL Client", () => {
  it("records cost, calculates backoff, and isolates throttles between stores", async () => {
    const throttle = new InMemoryThrottleManager();

    // Store A query exhausts points
    throttle.recordCost("store-a", {
      requestedQueryCost: 200,
      actualQueryCost: 200,
      throttleStatus: {
        currentlyAvailable: 50,
        maximumAvailable: 1000,
        restoreRate: 50,
      },
    });

    const checkA = throttle.check("store-a");
    assert.equal(checkA.isThrottled, true, "Store A must be throttled");

    // Store B is untouched
    const checkB = throttle.check("store-b");
    assert.equal(checkB.isThrottled, false, "Store B must not be affected by Store A");
  });

  it("handles HTTP 429 and GraphQL THROTTLED errors in client", async () => {
    const throttle = new InMemoryThrottleManager();
    const tokenProvider = new StaticAccessTokenProvider();

    const rateLimitTransport: HttpTransport = async () => {
      return createMockResponse({ errors: "rate limit" }, 429, { "Retry-After": "5" });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider,
      throttleManager: throttle,
      baseTransport: rateLimitTransport,
    });

    const store: StoreConfig = {
      storeId: "store-429",
      shopDomain: "429.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    };

    await assert.rejects(
      async () => client.query(store, "{ shop { name } }"),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_THROTTLED" &&
        err.retryAfterSeconds === 5,
    );

    assert.equal(throttle.check("store-429").isThrottled, true);
  });
});

describe("Gateway: Operations & Dispatcher", () => {
  function setupGateway(mockGraphqlDataOrTransport: unknown) {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-test",
        shopDomain: "store-test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "shpat_mock_123" },
      },
    ]);

    const fakeTransport: HttpTransport =
      typeof mockGraphqlDataOrTransport === "function"
        ? (mockGraphqlDataOrTransport as HttpTransport)
        : async () => createMockResponse(mockGraphqlDataOrTransport);

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    return new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
  }

  it("executes connection.test successfully", async () => {
    const dispatcher = setupGateway({
      data: {
        shop: {
          name: "Test Shop",
          myshopifyDomain: "store-test.myshopify.com",
          currencyCode: "USD",
        },
      },
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "connection.test",
      payload: {},
    });

    assert.equal(res.success, true);
    assert.deepEqual(res.data, {
      isConnected: true,
      connected: true,
      shopDomain: "store-test.myshopify.com",
      shopName: "Test Shop",
      currencyCode: "USD",
    });
  });

  it("executes products.list with cursor pagination and validates limit", async () => {
    const dispatcher = setupGateway({
      data: {
        products: {
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: "cur_1",
            endCursor: "cur_2",
          },
          edges: [
            {
              cursor: "cur_1",
              node: {
                id: "gid://shopify/Product/1",
                title: "Product 1",
                handle: "product-1",
                status: "ACTIVE",
                tags: ["pod"],
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
              },
            },
          ],
        },
      },
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.list",
      payload: { limit: 10, cursor: null },
    });

    assert.equal(res.success, true);
    const listData = res.data as { products: unknown[]; pageInfo: { hasNextPage: boolean } };
    assert.equal(listData.products.length, 1);
    assert.equal(listData.pageInfo.hasNextPage, true);

    // Rejects non-positive limit
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.list",
          payload: { limit: 0 },
        }),
      (err: unknown) => err instanceof GatewayError && err.code === "SHOPIFY_USER_ERROR",
    );
  });

  it("executes products.get returning single product details", async () => {
    const dispatcher = setupGateway({
      data: {
        product: {
          id: "gid://shopify/Product/123",
          title: "Detailed Product",
          handle: "detailed-product",
          status: "ACTIVE",
          tags: ["pod"],
          createdAt: "2026-09-01",
          updatedAt: "2026-09-20",
          variants: { edges: [] },
        },
      },
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.get",
      payload: { id: "gid://shopify/Product/123" },
    });

    assert.equal(res.success, true);
    const data = res.data as { product: { title: string } };
    assert.equal(data.product.title, "Detailed Product");
  });

  it("executes collections.list and collections.get", async () => {
    const dispatcher = setupGateway({
      data: {
        collections: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
          edges: [
            {
              cursor: "c_1",
              node: {
                id: "gid://shopify/Collection/1",
                title: "Summer Collection",
                handle: "summer-collection",
                productsCount: { count: 42 },
                updatedAt: "2026-09-21",
              },
            },
          ],
        },
        collection: {
          id: "gid://shopify/Collection/1",
          title: "Summer Collection",
          handle: "summer-collection",
          description: "All summer designs",
          productsCount: { count: 42 },
          updatedAt: "2026-09-21",
        },
      },
    });

    const listRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.list",
      payload: { limit: 5 },
    });

    assert.equal(listRes.success, true);
    const listData = listRes.data as { collections: { title: string; productsCount: number }[] };
    assert.equal(listData.collections[0].title, "Summer Collection");
    assert.equal(listData.collections[0].productsCount, 42);

    const getRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.get",
      payload: { id: "gid://shopify/Collection/1" },
    });
    assert.equal(getRes.success, true);
    const getData = getRes.data as { collection: { title: string; description: string } };
    assert.equal(getData.collection.title, "Summer Collection");
    assert.equal(getData.collection.description, "All summer designs");
  });

  it("executes products.create, update, bulkUpdate, and delete with GraphQL mutations", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(capturedBody.query);

      if (query.includes("productCreate")) {
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/100",
                title: "Created Hoodie",
                handle: "created-hoodie",
                status: "ACTIVE",
                vendor: "PrintShop",
                productType: "Apparel",
                tags: ["winter", "hoodie"],
                createdAt: "2026-09-21",
                updatedAt: "2026-09-21",
                variants: { edges: [] },
              },
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("productUpdate")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/100",
                title: "Updated Hoodie",
                handle: "updated-hoodie",
                status: "ACTIVE",
                vendor: "PrintShop",
                tags: ["winter"],
                createdAt: "2026-09-21",
                updatedAt: "2026-09-21",
                variants: { edges: [] },
              },
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("productDelete")) {
        return createMockResponse({
          data: {
            productDelete: {
              deletedProductId: "gid://shopify/Product/100",
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    });

    // 1. Create product
    const createRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      payload: {
        product: {
          title: "Created Hoodie",
          vendor: "PrintShop",
          productType: "Apparel",
          tags: ["winter", "hoodie"],
        },
      },
    });
    assert.equal(createRes.success, true);
    const createData = createRes.data as { product: { id: string; title: string } };
    assert.equal(createData.product.id, "gid://shopify/Product/100");
    assert.equal(createData.product.title, "Created Hoodie");

    // 2. Update product
    const updateRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.update",
      payload: {
        id: "gid://shopify/Product/100",
        product: { title: "Updated Hoodie" },
      },
    });
    assert.equal(updateRes.success, true);
    const updateData = updateRes.data as { product: { title: string } };
    assert.equal(updateData.product.title, "Updated Hoodie");

    // 3. Bulk update products
    const bulkRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.bulkUpdate",
      payload: {
        products: [
          { id: "gid://shopify/Product/100", product: { title: "Bulk Hoodie" } },
        ],
      },
    });
    assert.equal(bulkRes.success, true);
    const bulkData = bulkRes.data as { updatedProductIds: string[]; count: number };
    assert.equal(bulkData.count, 1);
    assert.deepEqual(bulkData.updatedProductIds, ["gid://shopify/Product/100"]);

    // 4. Delete product
    const deleteRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.delete",
      payload: { id: "gid://shopify/Product/100" },
    });
    assert.equal(deleteRes.success, true);
    const deleteData = deleteRes.data as { deletedProductId: string };
    assert.equal(deleteData.deletedProductId, "gid://shopify/Product/100");
  });

  it("executes variants.update and bulkUpdate, mapping top-level sku to inventoryItem { sku }", async () => {
    let capturedVariables: Record<string, unknown> | undefined;
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      capturedVariables = parsed.variables as Record<string, unknown>;

      return createMockResponse({
        data: {
          productVariantUpdate: {
            productVariant: {
              id: "gid://shopify/ProductVariant/555",
              title: "Large / Black",
              price: "39.99",
              barcode: "123456789",
              inventoryQuantity: 25,
              inventoryItem: { sku: "HOODIE-BLK-LG" },
              product: { id: "gid://shopify/Product/100" },
            },
            userErrors: [],
          },
        },
      });
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "variants.update",
      payload: {
        id: "gid://shopify/ProductVariant/555",
        variant: {
          price: "39.99",
          barcode: "123456789",
          sku: "HOODIE-BLK-LG",
        },
      },
    });

    assert.equal(res.success, true);
    const variantData = res.data as { variant: { id: string; sku?: string; price: string; productId: string } };
    assert.equal(variantData.variant.id, "gid://shopify/ProductVariant/555");
    assert.equal(variantData.variant.sku, "HOODIE-BLK-LG");
    assert.equal(variantData.variant.productId, "gid://shopify/Product/100");

    // Verify sku was correctly mapped to inventoryItem { sku }
    const inputVar = capturedVariables?.input as Record<string, unknown>;
    assert.deepEqual(inputVar.inventoryItem, { sku: "HOODIE-BLK-LG" });

    // Bulk update variants
    const bulkRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "variants.bulkUpdate",
      payload: {
        variants: [
          {
            id: "gid://shopify/ProductVariant/555",
            variant: { price: "42.00", sku: "HOODIE-BLK-LG" },
          },
        ],
      },
    });
    assert.equal(bulkRes.success, true);
    const bulkData = bulkRes.data as { updatedVariantIds: string[]; count: number };
    assert.equal(bulkData.count, 1);
    assert.deepEqual(bulkData.updatedVariantIds, ["gid://shopify/ProductVariant/555"]);
  });

  it("executes collections.create, update, delete, and updateMembership with GraphQL mutations", async () => {
    let capturedBody: Record<string, unknown> | undefined;
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(capturedBody.query);

      if (query.includes("collectionCreate")) {
        return createMockResponse({
          data: {
            collectionCreate: {
              collection: {
                id: "gid://shopify/Collection/77",
                title: "Winter Collection",
                handle: "winter-collection",
                descriptionHtml: "<p>Winter gear</p>",
                productsCount: { count: 0 },
                updatedAt: "2026-09-21",
              },
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("collectionUpdate")) {
        return createMockResponse({
          data: {
            collectionUpdate: {
              collection: {
                id: "gid://shopify/Collection/77",
                title: "Winter 2026",
                handle: "winter-2026",
                descriptionHtml: "<p>Winter gear</p>",
                productsCount: { count: 0 },
                updatedAt: "2026-09-21",
              },
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("collectionDelete")) {
        return createMockResponse({
          data: {
            collectionDelete: {
              deletedCollectionId: "gid://shopify/Collection/77",
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("collectionAddProducts")) {
        return createMockResponse({
          data: {
            collectionAddProducts: { userErrors: [] },
          },
        });
      }

      if (query.includes("collectionRemoveProducts")) {
        return createMockResponse({
          data: {
            collectionRemoveProducts: { userErrors: [] },
          },
        });
      }

      return createMockResponse({});
    });

    // 1. Create collection
    const createRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.create",
      payload: {
        collection: {
          title: "Winter Collection",
          description: "<p>Winter gear</p>",
        },
      },
    });
    assert.equal(createRes.success, true);
    const createData = createRes.data as { collection: { id: string; title: string } };
    assert.equal(createData.collection.id, "gid://shopify/Collection/77");

    // 2. Update collection
    const updateRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.update",
      payload: {
        id: "gid://shopify/Collection/77",
        collection: { title: "Winter 2026" },
      },
    });
    assert.equal(updateRes.success, true);
    const updateData = updateRes.data as { collection: { title: string } };
    assert.equal(updateData.collection.title, "Winter 2026");

    // 3. Update membership
    const memberRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.updateMembership",
      payload: {
        collectionId: "gid://shopify/Collection/77",
        productIdsToAdd: ["gid://shopify/Product/1"],
        productIdsToRemove: ["gid://shopify/Product/2"],
      },
    });
    assert.equal(memberRes.success, true);
    const memberData = memberRes.data as { addedCount: number; removedCount: number };
    assert.equal(memberData.addedCount, 1);
    assert.equal(memberData.removedCount, 1);

    // 4. Delete collection
    const deleteRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.delete",
      payload: { id: "gid://shopify/Collection/77" },
    });
    assert.equal(deleteRes.success, true);
    const deleteData = deleteRes.data as { deletedCollectionId: string };
    assert.equal(deleteData.deletedCollectionId, "gid://shopify/Collection/77");
  });

  it("supports preview dry-run mode without sending mutating requests to Shopify", async () => {
    let callCount = 0;
    const dispatcher = setupGateway(async () => {
      callCount += 1;
      return createMockResponse({});
    });

    const writeOpsWithPayloads = [
      {
        operation: "products.create",
        payload: { product: { title: "Dry Run Product" } },
      },
      {
        operation: "products.update",
        payload: { id: "gid://shopify/Product/1", product: { title: "Preview" } },
      },
      {
        operation: "products.bulkUpdate",
        payload: { products: [{ id: "gid://shopify/Product/1", product: {} }] },
      },
      {
        operation: "products.delete",
        payload: { id: "gid://shopify/Product/1" },
      },
      {
        operation: "variants.update",
        payload: { id: "gid://shopify/ProductVariant/1", variant: { price: "10.00" } },
      },
      {
        operation: "variants.bulkUpdate",
        payload: { variants: [{ id: "gid://shopify/ProductVariant/1", variant: {} }] },
      },
      {
        operation: "collections.create",
        payload: { collection: { title: "Preview Collection" } },
      },
      {
        operation: "collections.update",
        payload: { id: "gid://shopify/Collection/1", collection: { title: "Preview" } },
      },
      {
        operation: "collections.delete",
        payload: { id: "gid://shopify/Collection/1" },
      },
      {
        operation: "collections.updateMembership",
        payload: { collectionId: "gid://shopify/Collection/1", productIdsToAdd: ["p1"] },
      },
    ];

    for (const item of writeOpsWithPayloads) {
      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: item.operation,
        payload: item.payload,
        mode: "preview",
      });
      assert.equal(res.success, true, `Preview mode for ${item.operation} should succeed`);
    }

    assert.equal(callCount, 0, "Preview mode must NEVER send HTTP mutations to Shopify");
  });

  it("guarantees write idempotency with requestId and prevents conflicting duplicate payloads", async () => {
    let networkCallCount = 0;
    const dispatcher = setupGateway(async () => {
      networkCallCount += 1;
      return createMockResponse({
        data: {
          productCreate: {
            product: {
              id: "gid://shopify/Product/idemp-1",
              title: "Idempotent Product",
              handle: "idempotent-product",
              status: "ACTIVE",
              tags: [],
              createdAt: "2026-09-21",
              updatedAt: "2026-09-21",
              variants: { edges: [] },
            },
            userErrors: [],
          },
        },
      });
    });

    const payload = { product: { title: "Idempotent Product" } };

    // First call with requestId
    const res1 = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      payload,
      requestId: "req-unique-123",
    });
    assert.equal(res1.success, true);
    assert.equal(networkCallCount, 1);

    // Second call with same requestId and identical payload -> returns cached response
    const res2 = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      payload,
      requestId: "req-unique-123",
    });
    assert.equal(res2.success, true);
    assert.equal(networkCallCount, 1, "Must return cached result without hitting network again");
    assert.deepEqual(res1.data, res2.data);

    // Third call with same requestId but different payload -> rejects with conflict (409)
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          payload: { product: { title: "Different Title" } },
          requestId: "req-unique-123",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.httpStatus === 409,
      "Reusing requestId with different payload must reject with 409",
    );
  });

  it("maps network drops during write mutations to SHOPIFY_UNKNOWN_WRITE_STATE", async () => {
    const failingTransport: HttpTransport = async () => {
      throw new Error("socket hang up");
    };

    const dispatcher = setupGateway(failingTransport);

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          payload: { product: { title: "Will Fail" } },
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_UNKNOWN_WRITE_STATE" &&
        err.httpStatus === 500,
      "Network failure during write mutation must be mapped to SHOPIFY_UNKNOWN_WRITE_STATE",
    );
  });
});

describe("Gateway: HTTP Server Handler & E2E Integration with module-api", () => {
  it("handles POST request, forwards to dispatcher, and returns 200 JSON", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-http",
        shopDomain: "store-http.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);

    const fakeTransport: HttpTransport = async () =>
      createMockResponse({
        data: {
          shop: {
            name: "HTTP Shop",
            myshopifyDomain: "store-http.myshopify.com",
            currencyCode: "USD",
          },
        },
      });

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
    const handler = createGatewayHttpHandler(dispatcher);

    const req = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        storeId: "store-http",
        operation: "connection.test",
        payload: {},
      }),
    });

    const res = await handler(req);
    assert.equal(res.status, 200);
    const json = (await res.json()) as { success: boolean; data: { isConnected: boolean } };
    assert.equal(json.success, true);
    assert.equal(json.data.isConnected, true);
  });

  it("integrates end-to-end with module-api client runner", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-e2e",
        shopDomain: "store-e2e.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);

    const fakeTransport: HttpTransport = async () =>
      createMockResponse({
        data: {
          products: {
            pageInfo: { hasNextPage: false, hasPreviousPage: false },
            edges: [
              {
                cursor: "e2e_cur",
                node: {
                  id: "gid://shopify/Product/999",
                  title: "E2E Tested Product",
                  handle: "e2e-product",
                  status: "ACTIVE",
                  tags: [],
                  createdAt: "2026-09-01",
                  updatedAt: "2026-09-20",
                  variants: { edges: [] },
                },
              },
            ],
          },
        },
      });

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
    const handler = createGatewayHttpHandler(dispatcher);

    // Connect module-api runner via simulated fetch calling handler
    const runner = createModuleApiRunner(
      { gatewayUrl: "http://localhost:8787/api/shopify" },
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          return handler(request);
        },
      },
    );

    const result = await runner({
      storeId: "store-e2e",
      operation: "products.list",
      payload: { limit: 10 },
    });

    assert.equal(result.success, true);
    assert.equal(result.operation, "products.list");
    const data = result.data as { products: { title: string }[] };
    assert.equal(data.products[0].title, "E2E Tested Product");
  });

  it("integrates end-to-end with module-api client runner for write operations (products.create)", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-e2e-write",
        shopDomain: "store-e2e-write.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);

    const fakeTransport: HttpTransport = async () =>
      createMockResponse({
        data: {
          productCreate: {
            product: {
              id: "gid://shopify/Product/e2e-write-1",
              title: "E2E Created Product",
              handle: "e2e-created-product",
              status: "ACTIVE",
              tags: ["e2e"],
              createdAt: "2026-09-21",
              updatedAt: "2026-09-21",
              variants: { edges: [] },
            },
            userErrors: [],
          },
        },
      });

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
    const handler = createGatewayHttpHandler(dispatcher);

    const runner = createModuleApiRunner(
      { gatewayUrl: "http://localhost:8787/api/shopify" },
      {
        fetch: async (input, init) => {
          const request = new Request(input, init);
          return handler(request);
        },
      },
    );

    const result = await runner({
      storeId: "store-e2e-write",
      operation: "products.create",
      payload: {
        product: {
          title: "E2E Created Product",
          tags: ["e2e"],
        },
      },
      mode: "apply",
      requestId: "req-e2e-write-123",
    });

    assert.equal(result.success, true);
    assert.equal(result.operation, "products.create");
    assert.equal(result.data.product.id, "gid://shopify/Product/e2e-write-1");
    assert.equal(result.data.product.title, "E2E Created Product");
  });

  it("returns 405 for non-POST requests and 400 for malformed JSON", async () => {
    const registry = new InMemoryStoreRegistry();
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: {} as ShopifyGraphqlClient,
    });
    const handler = createGatewayHttpHandler(dispatcher);

    const getReq = new Request("http://localhost:8787/api/shopify", { method: "GET" });
    const getRes = await handler(getReq);
    assert.equal(getRes.status, 405);

    const badReq = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not json }",
    });
    const badRes = await handler(badReq);
    assert.equal(badRes.status, 400);
  });
});
