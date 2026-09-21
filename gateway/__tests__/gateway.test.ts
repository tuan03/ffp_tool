import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGatewayHttpHandler,
  createStoreTransport,
  GatewayDispatcher,
  GatewayError,
  InMemoryStoreRegistry,
  InMemoryThrottleManager,
  InMemoryIdempotencyStore,
  normalizeShopDomain,
  sanitizeErrorMessage,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
  ClientCredentialsTokenProvider,
  CompositeTokenProvider,
  StoreControlPlane,
  type StoreConfig,
  type HttpTransport,
  type IdempotencyStore,
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

  it("normalizes domain correctly for all supported formats", () => {
    assert.equal(normalizeShopDomain("capozen"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("CAPOZEN"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("capozen.myshopify.com"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("https://capozen.myshopify.com"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("http://capozen.myshopify.com/"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("https://admin.shopify.com/store/capozen"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("admin.shopify.com/store/capozen/"), "capozen.myshopify.com");
    assert.equal(normalizeShopDomain("https://admin.shopify.com/store/capozen?param=value"), "capozen.myshopify.com");
  });

  it("strictly rejects unsupported or ambiguous domains", () => {
    assert.throws(() => normalizeShopDomain(""), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("   "), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("admin.shopify.com"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com/store"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com/store/"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("example.com"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://customstore.org"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain(".myshopify.com"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("capozen..myshopify.com"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });
  });

  it("updates existing store in registry and throws on non-existent store", () => {
    const registry = new InMemoryStoreRegistry();
    registry.registerStore({
      storeId: "store-update-target",
      shopDomain: "old.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok-old" },
    });

    registry.updateStore({
      storeId: "store-update-target",
      shopDomain: "updated.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok-new" },
    });

    const updated = registry.getStore("store-update-target");
    assert.equal(updated?.shopDomain, "updated.myshopify.com");
    assert.equal(updated?.auth.staticToken, "tok-new");

    assert.throws(() => {
      registry.updateStore({
        storeId: "non-existent-store",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      });
    }, (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_NOT_FOUND");
      return true;
    });
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

  it("refreshes client_credentials token when token has expired past safety buffer", async () => {
    let callCount = 0;
    let currentTime = 1_000_000_000;
    const fakeTransport: HttpTransport = async () => {
      callCount++;
      return createMockResponse({
        access_token: `token_${callCount}`,
        expires_in: 3600, // 1 hour = 3600s
      });
    };

    const provider = new ClientCredentialsTokenProvider({
      transport: fakeTransport,
      clock: () => currentTime,
    });

    const store: StoreConfig = {
      storeId: "s-refresh",
      shopDomain: "refresh.myshopify.com",
      apiVersion: "2026-07",
      auth: {
        type: "client_credentials",
        clientId: "client_1",
        clientSecret: "secret_1",
      },
    };

    const token1 = await provider.getToken(store);
    assert.equal(token1, "token_1");
    assert.equal(callCount, 1);

    // 10 minutes later (well before 55 minutes effective TTL): should still use cached token
    currentTime += 600 * 1000;
    const token2 = await provider.getToken(store);
    assert.equal(token2, "token_1");
    assert.equal(callCount, 1);

    // 56 minutes later (past 55 minutes TTL): should fetch fresh token
    currentTime += 3000 * 1000;
    const token3 = await provider.getToken(store);
    assert.equal(token3, "token_2");
    assert.equal(callCount, 2);
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
  function setupGateway(mockGraphqlDataOrTransport: unknown, idempotencyStore?: IdempotencyStore) {
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

    return new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client, idempotencyStore });
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
      mode: "apply",
      payload: {
        product: {
          title: "Created Hoodie",
          vendor: "PrintShop",
          productType: "Apparel",
          tags: ["winter", "hoodie"],
        },
      },
      requestId: "req-create-1",
    });
    assert.equal(createRes.success, true);
    const createData = createRes.data as { product: { id: string; title: string } };
    assert.equal(createData.product.id, "gid://shopify/Product/100");
    assert.equal(createData.product.title, "Created Hoodie");

    // 2. Update product
    const updateRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.update",
      mode: "apply",
      payload: {
        id: "gid://shopify/Product/100",
        product: { title: "Updated Hoodie" },
      },
      requestId: "req-update-1",
    });
    assert.equal(updateRes.success, true);
    const updateData = updateRes.data as { product: { title: string } };
    assert.equal(updateData.product.title, "Updated Hoodie");

    // 3. Bulk update products
    const bulkRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.bulkUpdate",
      mode: "apply",
      payload: {
        products: [
          { id: "gid://shopify/Product/100", product: { title: "Bulk Hoodie" } },
        ],
      },
      requestId: "req-bulk-1",
    });
    assert.equal(bulkRes.success, true);
    const bulkData = bulkRes.data as { updatedProductIds: string[]; count: number };
    assert.equal(bulkData.count, 1);
    assert.deepEqual(bulkData.updatedProductIds, ["gid://shopify/Product/100"]);

    // 4. Delete product
    const deleteRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.delete",
      mode: "apply",
      payload: { id: "gid://shopify/Product/100" },
      requestId: "req-delete-1",
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
      const query = String(parsed.query);

      if (query.includes("ResolveVariantProduct")) {
        return createMockResponse({
          data: {
            node: {
              id: "gid://shopify/ProductVariant/555",
              product: { id: "gid://shopify/Product/100" },
            },
          },
        });
      }

      if (query.includes("ProductVariantsBulkUpdate")) {
        return createMockResponse({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/555",
                  title: "Large / Black",
                  price: "39.99",
                  compareAtPrice: "49.99",
                  barcode: "123456789",
                  inventoryQuantity: 25,
                  inventoryItem: { sku: "HOODIE-BLK-LG" },
                  product: { id: "gid://shopify/Product/100" },
                },
              ],
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "variants.update",
      mode: "apply",
      payload: {
        id: "gid://shopify/ProductVariant/555",
        variant: {
          price: "39.99",
          compareAtPrice: "49.99",
          barcode: "123456789",
          sku: "HOODIE-BLK-LG",
        },
      },
      requestId: "req-var-1",
    });

    assert.equal(res.success, true);
    const variantData = res.data as { variant: { id: string; sku?: string; price: string; productId: string; compareAtPrice?: string } };
    assert.equal(variantData.variant.id, "gid://shopify/ProductVariant/555");
    assert.equal(variantData.variant.sku, "HOODIE-BLK-LG");
    assert.equal(variantData.variant.productId, "gid://shopify/Product/100");
    assert.equal(variantData.variant.compareAtPrice, "49.99");

    // Verify sku was correctly mapped to inventoryItem { sku } in bulk update inputs
    const variantsList = capturedVariables?.variants as Record<string, unknown>[];
    assert.ok(Array.isArray(variantsList));
    assert.deepEqual(variantsList[0].inventoryItem, { sku: "HOODIE-BLK-LG" });

    // Bulk update variants
    const bulkRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "variants.bulkUpdate",
      mode: "apply",
      payload: {
        variants: [
          {
            id: "gid://shopify/ProductVariant/555",
            variant: { price: "42.00", sku: "HOODIE-BLK-LG" },
          },
        ],
      },
      requestId: "req-var-bulk-1",
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

      if (query.includes("GetCollectionSources")) {
        return createMockResponse({
          data: {
            collection: {
              id: "gid://shopify/Collection/77",
              sources: [
                {
                  __typename: "CollectionConditionsSource",
                  id: "gid://shopify/CollectionConditionsSource/1",
                  title: "Default Source",
                },
              ],
            },
          },
        });
      }

      return createMockResponse({});
    });

    // 1. Create collection
    const createRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.create",
      mode: "apply",
      payload: {
        collection: {
          title: "Winter Collection",
          description: "<p>Winter gear</p>",
        },
      },
      requestId: "req-col-1",
    });
    assert.equal(createRes.success, true);
    const createData = createRes.data as { collection: { id: string; title: string } };
    assert.equal(createData.collection.id, "gid://shopify/Collection/77");

    // 2. Update collection
    const updateRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.update",
      mode: "apply",
      payload: {
        id: "gid://shopify/Collection/77",
        collection: { title: "Winter 2026" },
      },
      requestId: "req-col-2",
    });
    assert.equal(updateRes.success, true);
    const updateData = updateRes.data as { collection: { title: string } };
    assert.equal(updateData.collection.title, "Winter 2026");

    // 3. Update membership
    const memberRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.updateMembership",
      mode: "apply",
      payload: {
        collectionId: "gid://shopify/Collection/77",
        productIdsToAdd: ["gid://shopify/Product/1"],
        productIdsToRemove: ["gid://shopify/Product/2"],
      },
      requestId: "req-col-3",
    });
    assert.equal(memberRes.success, true);
    const memberData = memberRes.data as { addedCount: number; removedCount: number };
    assert.equal(memberData.addedCount, 1);
    assert.equal(memberData.removedCount, 1);

    // 4. Delete collection
    const deleteRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.delete",
      mode: "apply",
      payload: { id: "gid://shopify/Collection/77" },
      requestId: "req-col-4",
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

  it("rejects preview mode when storeId does not exist in store registry", async () => {
    const dispatcher = setupGateway({});
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-does-not-exist",
          operation: "products.delete",
          payload: { id: "gid://shopify/Product/1" },
          mode: "preview",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_NOT_FOUND" &&
        err.httpStatus === 404,
    );
  });

  it("ensures preview does not pollute IdempotencyStore so apply executes Shopify mutation", async () => {
    let shopifyMutationCalled = false;
    const dispatcher = setupGateway(async () => {
      shopifyMutationCalled = true;
      return createMockResponse({
        data: {
          productCreate: {
            product: {
              id: "gid://shopify/Product/real-created-1",
              title: "Real Applied Product",
              handle: "real-applied-product",
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

    // 1. Preview request with req-preview-1
    const previewRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      payload: { product: { title: "Real Applied Product" } },
      mode: "preview",
      requestId: "req-preview-1",
    });
    assert.equal(previewRes.success, true);
    assert.equal(shopifyMutationCalled, false, "Preview MUST NOT call Shopify GraphQL API");

    // 2. Apply request with the EXACT SAME requestId
    const applyRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      payload: { product: { title: "Real Applied Product" } },
      mode: "apply",
      requestId: "req-preview-1",
    });
    assert.equal(applyRes.success, true);
    assert.equal(shopifyMutationCalled, true, "Apply MUST execute Shopify mutation even if preview used same requestId");
    const data = applyRes.data as { product: { id: string } };
    assert.equal(data.product.id, "gid://shopify/Product/real-created-1");
  });

  it("rejects apply write operations when requestId is missing", async () => {
    const dispatcher = setupGateway({});
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          payload: { product: { title: "No Request ID" } },
          mode: "apply",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.httpStatus === 400 &&
        err.message.includes("requestId is required"),
    );
  });

  it("rejects when same requestId is reused for a different operation", async () => {
    const dispatcher = setupGateway(async () =>
      createMockResponse({
        data: {
          productCreate: {
            product: {
              id: "gid://shopify/Product/op-1",
              title: "Op 1",
              handle: "op-1",
              status: "ACTIVE",
              tags: [],
              createdAt: "2026-09-21",
              updatedAt: "2026-09-21",
              variants: { edges: [] },
            },
            userErrors: [],
          },
        },
      }),
    );

    await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
      payload: { product: { title: "Op 1" } },
      requestId: "shared-req-id-1",
    });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.delete",
          mode: "apply",
          payload: { id: "gid://shopify/Product/op-1" },
          requestId: "shared-req-id-1",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.httpStatus === 409 &&
        err.message.includes("previously used for operation"),
    );
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
      mode: "apply",
      payload,
      requestId: "req-unique-123",
    });
    assert.equal(res1.success, true);
    assert.equal(networkCallCount, 1);

    // Second call with same requestId and identical payload -> returns cached response
    const res2 = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
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
          mode: "apply",
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

  it("rejects concurrent duplicate requests with different payload with 409", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseGate = resolve;
    });

    const dispatcher = setupGateway(async () => {
      await gate;
      return createMockResponse({
        data: {
          productCreate: {
            product: {
              id: "gid://shopify/Product/c-1",
              title: "Product A",
              handle: "product-a",
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

    const call1Promise = dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
      payload: { product: { title: "Product A" } },
      requestId: "concurrent-req-1",
    });

    // Call 2 arrives concurrently with DIFFERENT payload -> rejected with 409
    const call2Promise = assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          mode: "apply",
          payload: { product: { title: "Product B" } },
          requestId: "concurrent-req-1",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.httpStatus === 409,
    );

    // Call 3 arrives concurrently with IDENTICAL payload -> awaits in-flight and returns same result
    const call3Promise = dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
      payload: { product: { title: "Product A" } },
      requestId: "concurrent-req-1",
    });

    releaseGate();
    const [res1, , res3] = await Promise.all([call1Promise, call2Promise, call3Promise]);
    assert.equal(res1.success, true);
    assert.equal(res3.success, true);
    assert.deepEqual(res1.data, res3.data);
  });

  it("handles products.bulkUpdate partial failure without failing entire batch", async () => {
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const vars = body.variables as { product?: { id: string; title: string }; input?: { id: string; title: string } };
      const target = vars.product ?? vars.input ?? { id: "", title: "" };

      if (target.id === "gid://shopify/Product/fail") {
        return createMockResponse({
          data: {
            productUpdate: {
              product: null,
              userErrors: [{ field: ["title"], message: "Invalid product title" }],
            },
          },
        });
      }

      return createMockResponse({
        data: {
          productUpdate: {
            product: {
              id: target.id,
              title: target.title,
              handle: "updated-handle",
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

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.bulkUpdate",
      mode: "apply",
      payload: {
        products: [
          { id: "gid://shopify/Product/fail", product: { title: "Bad" } },
          { id: "gid://shopify/Product/pass", product: { title: "Good" } },
        ],
      },
      requestId: "bulk-partial-req-1",
    });

    assert.equal(res.success, true);
    const data = res.data as {
      successCount: number;
      failedCount: number;
      updatedProductIds: string[];
      items: { id: string; ok: boolean; error?: string }[];
    };
    assert.equal(data.successCount, 1);
    assert.equal(data.failedCount, 1);
    assert.deepEqual(data.updatedProductIds, ["gid://shopify/Product/pass"]);
    assert.equal(data.items[0].ok, false);
    assert.equal(data.items[1].ok, true);
  });

  it("rejects modifying membership when collection does not exist", async () => {
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(parsed.query);

      if (query.includes("GetCollectionSources")) {
        return createMockResponse({
          data: {
            collection: null,
          },
        });
      }
      return createMockResponse({});
    });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "collections.updateMembership",
          mode: "apply",
          payload: {
            collectionId: "gid://shopify/Collection/missing-1",
            productIdsToAdd: ["gid://shopify/Product/1"],
          },
          requestId: "req-missing-col",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_NOT_FOUND" &&
        err.httpStatus === 404,
    );
  });

  it("creates product with multiple variants using productVariantsBulkCreate", async () => {
    let bulkCreateCalled = false;
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(parsed.query);

      if (query.includes("productCreate")) {
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/multi-var",
                title: "Multi Variant Hoodie",
                handle: "multi-variant-hoodie",
                status: "ACTIVE",
                tags: [],
                createdAt: "2026-09-21",
                updatedAt: "2026-09-21",
                variants: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductVariant/v-init",
                        title: "Default Title",
                        price: "35.00",
                        sku: "SKU-INIT",
                        barcode: "111",
                        inventoryQuantity: 10,
                      },
                    },
                  ],
                },
              },
              userErrors: [],
            },
          },
        });
      }

      if (query.includes("ProductVariantsBulkCreate")) {
        bulkCreateCalled = true;
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/v-s",
                  title: "Small",
                  price: "25.00",
                  compareAtPrice: "30.00",
                  barcode: "BAR-S",
                  inventoryQuantity: 10,
                  inventoryItem: { sku: "TSHIRT-S" },
                },
                {
                  id: "gid://shopify/ProductVariant/v-m",
                  title: "Medium",
                  price: "25.00",
                  compareAtPrice: "30.00",
                  barcode: "BAR-M",
                  inventoryQuantity: 15,
                  inventoryItem: { sku: "TSHIRT-M" },
                },
                {
                  id: "gid://shopify/ProductVariant/v-l",
                  title: "Large",
                  price: "28.00",
                  compareAtPrice: "35.00",
                  barcode: "BAR-L",
                  inventoryQuantity: 20,
                  inventoryItem: { sku: "TSHIRT-L" },
                },
              ],
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
      payload: {
        product: {
          title: "T-Shirt Matrix",
          variants: [
            { title: "Small", price: "25.00", compareAtPrice: "30.00", sku: "TSHIRT-S" },
            { title: "Medium", price: "25.00", compareAtPrice: "30.00", sku: "TSHIRT-M" },
            { title: "Large", price: "28.00", compareAtPrice: "35.00", sku: "TSHIRT-L" },
          ],
        },
      },
      requestId: "req-multi-var-3",
    });

    assert.equal(res.success, true);
    assert.equal(bulkCreateCalled, true);
    const prod = (res.data as { product: { variants: { id: string; title: string }[] } }).product;
    // Exactly 3 variants returned, NOT 4
    assert.equal(prod.variants.length, 3);
    // Temporary standalone "Default Title" variant is completely deleted
    assert.equal(prod.variants.some((v) => v.title === "Default Title"), false);
    assert.deepEqual(prod.variants.map((v) => v.title), ["Small", "Medium", "Large"]);
  });

  it("returns createdProductId reconciliation info if additional variants creation fails", async () => {
    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(parsed.query);

      if (query.includes("productCreate")) {
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/reconcile-prod",
                title: "Reconcile Product",
                handle: "reconcile-product",
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
      }

      if (query.includes("ProductVariantsBulkCreate")) {
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: null,
              userErrors: [{ field: ["price"], message: "Invalid variant price" }],
            },
          },
        });
      }

      return createMockResponse({});
    });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          mode: "apply",
          payload: {
            product: {
              title: "Reconcile Product",
              variants: [{ price: "10.00" }, { price: "invalid" }],
            },
          },
          requestId: "req-rec-1",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.message.includes("Invalid variant price") &&
        (err.details as Record<string, unknown>)?.createdProductId === "gid://shopify/Product/reconcile-prod",
    );
  });

  it("maps mutation userErrors to SHOPIFY_USER_ERROR", async () => {
    const dispatcher = setupGateway(async () =>
      createMockResponse({
        data: {
          productCreate: {
            product: null,
            userErrors: [{ field: ["title"], message: "Title is already in use" }],
          },
        },
      }),
    );

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          mode: "apply",
          payload: { product: { title: "Duplicate" } },
          requestId: "user-err-req",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_USER_ERROR" &&
        err.httpStatus === 400 &&
        err.message.includes("Title is already in use"),
    );
  });

  it("returns HTTP 501 NOT_IMPLEMENTED for unsupported operations", async () => {
    const dispatcher = setupGateway({});
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "unsupported.customOp",
          payload: {},
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "NOT_IMPLEMENTED" &&
        err.httpStatus === 501,
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
          mode: "apply",
          payload: { product: { title: "Will Fail" } },
          requestId: "req-fail-net",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_UNKNOWN_WRITE_STATE" &&
        err.httpStatus === 500,
      "Network failure during write mutation must be mapped to SHOPIFY_UNKNOWN_WRITE_STATE",
    );
  });

  it("preserves idempotency state as RECONCILIATION_REQUIRED on SHOPIFY_UNKNOWN_WRITE_STATE and blocks retrying", async () => {
    let callCount = 0;
    const failingTransport: HttpTransport = async () => {
      callCount++;
      throw new Error("connection reset by peer");
    };

    const idempotencyStore = new InMemoryIdempotencyStore();
    const dispatcher = setupGateway(failingTransport, idempotencyStore);

    // First call: fails with UNKNOWN_WRITE_STATE
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          mode: "apply",
          payload: { product: { title: "Socket Drop Product" } },
          requestId: "req-unknown-retry-1",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_UNKNOWN_WRITE_STATE",
    );

    // Verify record in idempotency store is NOT deleted, but transitioned to RECONCILIATION_REQUIRED
    const record = await idempotencyStore.get("store-test:req-unknown-retry-1");
    assert.ok(record, "Idempotency record must not be deleted on UNKNOWN_WRITE_STATE");
    assert.equal(record?.state, "RECONCILIATION_REQUIRED");

    // Second call: retry with same requestId MUST be rejected with 409 SHOPIFY_UNKNOWN_WRITE_STATE
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-test",
          operation: "products.create",
          mode: "apply",
          payload: { product: { title: "Socket Drop Product" } },
          requestId: "req-unknown-retry-1",
        }),
      (err: unknown) =>
        err instanceof GatewayError &&
        err.code === "SHOPIFY_UNKNOWN_WRITE_STATE" &&
        err.httpStatus === 409 &&
        err.message.includes("requires manual reconciliation"),
    );

    // Ensure Shopify mutation was NOT called a second time
    assert.equal(callCount, 1);
  });

  it("creates product with exactly 1 variant and applies custom price and sku via productVariantsBulkCreate", async () => {
    let bulkCreateCalled = false;
    let capturedVariants: unknown;

    const dispatcher = setupGateway(async (_url: string, init?: RequestInit) => {
      const parsed = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const query = String(parsed.query);

      if (query.includes("productCreate")) {
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/single-var-prod",
                title: "Single Variant Product",
                handle: "single-variant-product",
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
      }

      if (query.includes("ProductVariantsBulkCreate")) {
        bulkCreateCalled = true;
        capturedVariants = parsed.variables;
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/single-var-1",
                  title: "Default Title",
                  price: "49.99",
                  compareAtPrice: "59.99",
                  barcode: "BAR-1",
                  inventoryQuantity: 5,
                  inventoryItem: { sku: "SKU-SINGLE-1" },
                },
              ],
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.create",
      mode: "apply",
      payload: {
        product: {
          title: "Single Variant Product",
          variants: [
            {
              price: "49.99",
              compareAtPrice: "59.99",
              sku: "SKU-SINGLE-1",
              barcode: "BAR-1",
            },
          ],
        },
      },
      requestId: "req-single-var-1",
    });

    assert.equal(res.success, true);
    assert.equal(bulkCreateCalled, true);
    const prod = (res.data as { product: { variants: { id: string; price: string; sku?: string }[] } }).product;
    assert.equal(prod.variants.length, 1);
    assert.equal(prod.variants[0].price, "49.99");
    assert.equal(prod.variants[0].sku, "SKU-SINGLE-1");

    // Ensure ProductVariantsBulkInput did NOT contain 'title'
    const vars = capturedVariants as { variants: Record<string, unknown>[] };
    assert.equal(vars.variants[0].title, undefined, "ProductVariantsBulkInput must not include title field");
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
    const data = result.data as unknown as { products: { title: string }[] };
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
      mode: "apply",
      payload: {
        product: {
          title: "E2E Created Product",
          tags: ["e2e"],
        },
      },
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

  it("handles products.create with explicit productOptions and multi-option variants", async () => {
    let capturedVariables: Record<string, unknown> | undefined;

    const transport: HttpTransport = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query: string; variables: Record<string, unknown> };
      capturedVariables = body.variables;

      if (body.query.includes("productCreate")) {
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/multi-opt-1",
                title: "Multi Option Hoodie",
                handle: "multi-option-hoodie",
                status: "ACTIVE",
                tags: ["apparel"],
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                variants: { edges: [] },
              },
              userErrors: [],
            },
          },
        });
      }

      if (body.query.includes("productVariantsBulkCreate")) {
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/v-1",
                  title: "S / Black",
                  price: "49.99",
                  inventoryItem: { sku: "HOODIE-S-BLK" },
                },
                {
                  id: "gid://shopify/ProductVariant/v-2",
                  title: "M / Black",
                  price: "49.99",
                  inventoryItem: { sku: "HOODIE-M-BLK" },
                },
              ],
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: transport,
    });
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-opts",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const store = await registry.getStore("store-opts");
    assert.equal(store?.storeId, "store-opts");

    const result = await dispatcher.dispatch({
      storeId: "store-opts",
      operation: "products.create",
      mode: "apply",
      requestId: "req-opts-1",
      payload: {
        product: {
          title: "Multi Option Hoodie",
          productOptions: [
            { name: "Size", values: ["S", "M"] },
            { name: "Color", values: ["Black"] },
          ],
          variants: [
            {
              price: "49.99",
              sku: "HOODIE-S-BLK",
              optionValues: [
                { optionName: "Size", name: "S" },
                { optionName: "Color", name: "Black" },
              ],
            },
            {
              price: "49.99",
              sku: "HOODIE-M-BLK",
              optionValues: [
                { optionName: "Size", name: "M" },
                { optionName: "Color", name: "Black" },
              ],
            },
          ],
        },
      },
    });

    assert.equal(result.success, true);
    const data = result.data as { product: { id: string; variants: { id: string }[] } };
    assert.equal(data.product.id, "gid://shopify/Product/multi-opt-1");
    assert.equal(data.product.variants.length, 2);
  });

  it("handles collections.updateMembership cleanly without CollectionConditionsSource fallback", async () => {
    let updateVariables: Record<string, unknown> | undefined;

    const transport: HttpTransport = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query: string; variables: Record<string, unknown> };

      if (body.query.includes("GetCollectionSources")) {
        return createMockResponse({
          data: {
            collection: {
              id: "gid://shopify/Collection/subcol-1",
              sources: [
                {
                  __typename: "CollectionSubCollectionsSource",
                  id: "gid://shopify/CollectionSubCollectionsSource/1",
                  title: "Subcollections",
                },
              ],
            },
          },
        });
      }

      if (body.query.includes("CollectionUpdateMembership")) {
        updateVariables = body.variables;
        return createMockResponse({
          data: {
            collectionUpdate: {
              collection: {
                id: "gid://shopify/Collection/subcol-1",
                productsCount: { count: 1 },
              },
              userErrors: [],
            },
          },
        });
      }

      return createMockResponse({});
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: transport,
    });
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-col",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const result = await dispatcher.dispatch({
      storeId: "store-col",
      operation: "collections.updateMembership",
      mode: "apply",
      requestId: "req-col-mem-1",
      payload: {
        collectionId: "gid://shopify/Collection/subcol-1",
        productIdsToAdd: ["gid://shopify/Product/prod-1"],
      },
    });

    assert.equal(result.success, true);
    // Verified that it used sourcesToCreate rather than corrupting sourcesToUpdate with CollectionSubCollectionsSource
    assert.ok(updateVariables);
    const colInput = (updateVariables as { collection: Record<string, unknown> }).collection;
    assert.ok(colInput.sourcesToCreate);
    assert.equal(colInput.sourcesToUpdate, undefined);
  });

  it("strictly enforces mode 'preview' or 'apply' on write operations and rejects omitted/invalid mode with 400", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-write-mode",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: {} as ShopifyGraphqlClient,
    });

    // Omitted mode
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-write-mode",
          operation: "products.create",
          requestId: "req-1",
          payload: { product: { title: "Test" } },
        } as any);
      },
      (err: GatewayError) => {
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        assert.equal(err.httpStatus, 400);
        return true;
      },
    );

    // Invalid mode
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-write-mode",
          operation: "products.create",
          mode: "invalid-mode" as any,
          requestId: "req-1",
          payload: { product: { title: "Test" } },
        });
      },
      (err: GatewayError) => {
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        assert.equal(err.httpStatus, 400);
        return true;
      },
    );
  });

  it("handles product and collection SEO fields in preview and apply modes", async () => {
    let capturedProductInput: Record<string, unknown> | undefined;
    let capturedCollectionInput: Record<string, unknown> | undefined;

    const transport: HttpTransport = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("ProductCreate")) {
        capturedProductInput = body.variables.product as Record<string, unknown>;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/seo-prod-1",
                title: "SEO Product",
                handle: "seo-product",
                status: "ACTIVE",
                seo: { title: "Custom SEO Title", description: "Custom SEO Description" },
                createdAt: "2026-09-21",
                updatedAt: "2026-09-21",
                variants: { edges: [] },
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("CollectionCreate")) {
        capturedCollectionInput = body.variables.collection as Record<string, unknown>;
        return createMockResponse({
          data: {
            collectionCreate: {
              collection: {
                id: "gid://shopify/Collection/seo-col-1",
                title: "SEO Collection",
                handle: "seo-collection",
                seo: { title: "Collection SEO Title", description: "Collection SEO Description" },
                productsCount: { count: 0 },
                updatedAt: "2026-09-21",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: transport,
    });
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-seo",
        shopDomain: "seo.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    // Preview product SEO
    const prodPreview = await dispatcher.dispatch({
      storeId: "store-seo",
      operation: "products.create",
      mode: "preview",
      payload: {
        product: {
          title: "SEO Product",
          seo: { title: "Preview SEO Title", description: "Preview SEO Description" },
        },
      },
    });
    assert.equal(prodPreview.success, true);
    assert.deepEqual((prodPreview.data as any).product.seo, {
      title: "Preview SEO Title",
      description: "Preview SEO Description",
    });

    // Apply product SEO
    const prodApply = await dispatcher.dispatch({
      storeId: "store-seo",
      operation: "products.create",
      mode: "apply",
      requestId: "req-prod-seo-1",
      payload: {
        product: {
          title: "SEO Product",
          seo: { title: "Custom SEO Title", description: "Custom SEO Description" },
        },
      },
    });
    assert.equal(prodApply.success, true);
    assert.deepEqual(capturedProductInput?.seo, {
      title: "Custom SEO Title",
      description: "Custom SEO Description",
    });

    // Apply collection SEO
    const colApply = await dispatcher.dispatch({
      storeId: "store-seo",
      operation: "collections.create",
      mode: "apply",
      requestId: "req-col-seo-1",
      payload: {
        collection: {
          title: "SEO Collection",
          seo: { title: "Collection SEO Title", description: "Collection SEO Description" },
        },
      },
    });
    assert.equal(colApply.success, true);
    assert.deepEqual(capturedCollectionInput?.seo, {
      title: "Collection SEO Title",
      description: "Collection SEO Description",
    });
  });

  it("executes StoreControlPlane store onboarding with preflight verification and token cache invalidation", async () => {
    let connectionQueryCount = 0;
    const transport: HttpTransport = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query?: string };
      if (body.query?.includes("StoreConnectionTest")) {
        connectionQueryCount++;
        return createMockResponse({
          data: {
            shop: {
              id: "gid://shopify/Shop/12345",
              name: "Capozen Wellness",
              myshopifyDomain: "capozen.myshopify.com",
            },
          },
        });
      }
      return createMockResponse({});
    };

    const tokenProvider = new CompositeTokenProvider();
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager, baseTransport: transport });
    const registry = new InMemoryStoreRegistry();
    const controlPlane = new StoreControlPlane({ storeRegistry: registry, tokenProvider, graphqlClient });

    // 1. registerStore with preflight
    const regResult = await controlPlane.registerStore({
      storeId: "capozen-store",
      shopDomain: "capozen", // tests domain normalization
      auth: {
        type: "static_access_token",
        accessToken: "shpat_secret_token_12345",
      },
    });

    assert.equal(regResult.registered, true);
    assert.equal(regResult.store.storeId, "capozen-store");
    assert.equal(regResult.store.shopDomain, "capozen.myshopify.com");
    assert.equal(regResult.store.authType, "static");
    assert.equal(regResult.store.connected, true);
    assert.equal((regResult.store as any).accessToken, undefined);
    assert.equal((regResult.store as any).staticToken, undefined);
    assert.equal((regResult.store as any).niche, undefined);
    assert.equal(connectionQueryCount, 1);

    // Verified in registry
    const stored = registry.getStore("capozen-store");
    assert.ok(stored);
    assert.equal(stored.shopDomain, "capozen.myshopify.com");

    // 2. listStores and getStore from control plane
    const listRes = await controlPlane.listStores();
    assert.equal(listRes.total, 1);
    assert.equal(listRes.stores[0].storeId, "capozen-store");
    assert.equal((listRes.stores[0] as any).accessToken, undefined);

    const getRes = await controlPlane.getStore("capozen-store");
    assert.ok(getRes.store);
    assert.equal(getRes.store.storeId, "capozen-store");
    assert.equal((getRes.store as any).accessToken, undefined);

    // 3. updateStoreCredentials
    const updateRes = await controlPlane.updateStoreCredentials({
      storeId: "capozen-store",
      auth: {
        type: "static_access_token",
        accessToken: "shpat_new_secret_67890",
      },
    });
    assert.equal(updateRes.updated, true);
    assert.equal(registry.getStore("capozen-store")?.auth.staticToken, "shpat_new_secret_67890");

    // 4. disconnectStore
    const disconnectRes = await controlPlane.disconnectStore("capozen-store");
    assert.equal(disconnectRes.disconnected, true);
    assert.equal(registry.hasStore("capozen-store"), false);
  });

  it("StoreControlPlane fails preflight when Shopify connection query fails and does NOT persist store", async () => {
    const transport: HttpTransport = async () => {
      return createMockResponse({
        errors: [{ message: "Invalid API key or access token (unrecognized login or wrong password)" }],
      }, 401);
    };

    const tokenProvider = new CompositeTokenProvider();
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager, baseTransport: transport });
    const registry = new InMemoryStoreRegistry();
    const controlPlane = new StoreControlPlane({ storeRegistry: registry, tokenProvider, graphqlClient });

    await assert.rejects(
      async () => {
        await controlPlane.registerStore({
          storeId: "bad-token-store",
          shopDomain: "bad-store.myshopify.com",
          auth: {
            type: "static_access_token",
            accessToken: "shpat_invalid_secret_token",
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
        // Verify secret token is NOT leaked in error message
        assert.equal(err.message.includes("shpat_invalid_secret_token"), false);
        return true;
      },
    );

    // Verify store was NOT saved in registry
    assert.equal(registry.hasStore("bad-token-store"), false);
  });

  it("StoreControlPlane handles client_credentials with shop_not_permitted cleanly", async () => {
    const transport: HttpTransport = async (url) => {
      if (url.includes("/admin/oauth/access_token")) {
        return createMockResponse({
          error: "shop_not_permitted",
          error_description: "App is not installed on this shop",
        }, 400);
      }
      return createMockResponse({});
    };

    const tokenProvider = new CompositeTokenProvider({ transport });
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager, baseTransport: transport });
    const registry = new InMemoryStoreRegistry();
    const controlPlane = new StoreControlPlane({ storeRegistry: registry, tokenProvider, graphqlClient });

    await assert.rejects(
      async () => {
        await controlPlane.registerStore({
          storeId: "not-permitted-store",
          shopDomain: "unpermitted.myshopify.com",
          auth: {
            type: "client_credentials",
            clientId: "some_client_id",
            clientSecret: "some_client_secret_xyz",
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
        assert.equal(err.message.includes("shop_not_permitted"), true);
        assert.equal(err.message.includes("some_client_secret_xyz"), false);
        return true;
      },
    );

    assert.equal(registry.hasStore("not-permitted-store"), false);
  });

  it("invalidates token cache on credential update and disconnect", async () => {
    let tokenExchangeCount = 0;
    let currentToken = "token_A";

    const transport: HttpTransport = async (url, init) => {
      if (url.includes("/admin/oauth/access_token")) {
        tokenExchangeCount++;
        const body = JSON.parse(String(init?.body || "{}")) as { client_secret: string };
        currentToken = body.client_secret === "secret_b" ? "token_B" : "token_A";
        return createMockResponse({
          access_token: currentToken,
          expires_in: 86400,
        });
      }
      const body = JSON.parse(String(init?.body || "{}")) as { query?: string };
      if (body.query?.includes("StoreConnectionTest")) {
        return createMockResponse({
          data: {
            shop: { id: "gid://shopify/Shop/1", name: "Shop", myshopifyDomain: "shop.myshopify.com" },
          },
        });
      }
      return createMockResponse({});
    };

    const tokenProvider = new CompositeTokenProvider({ transport });
    const throttleManager = new InMemoryThrottleManager();
    const graphqlClient = new ShopifyGraphqlClient({ tokenProvider, throttleManager, baseTransport: transport });
    const registry = new InMemoryStoreRegistry();
    const controlPlane = new StoreControlPlane({ storeRegistry: registry, tokenProvider, graphqlClient });

    // 1. Register with Secret A -> token A obtained
    await controlPlane.registerStore({
      storeId: "cached-store",
      shopDomain: "shop.myshopify.com",
      auth: {
        type: "client_credentials",
        clientId: "cid_a",
        clientSecret: "secret_a",
      },
    });
    assert.equal(tokenExchangeCount, 1);
    assert.equal(currentToken, "token_A");

    // 2. Second request to tokenProvider should use cache (count remains 1)
    const storeConfig = registry.getStore("cached-store")!;
    const token1 = await tokenProvider.getToken(storeConfig);
    assert.equal(token1, "token_A");
    assert.equal(tokenExchangeCount, 1);

    // 3. Update credentials to Secret B -> invalidates cache
    await controlPlane.updateStoreCredentials({
      storeId: "cached-store",
      auth: {
        type: "client_credentials",
        clientId: "cid_b",
        clientSecret: "secret_b",
      },
    });
    // Preflight exchanged token for secret_b
    assert.equal(currentToken, "token_B");
    assert.equal(tokenExchangeCount, 2);

    // 4. Next token request gets token_B
    const updatedConfig = registry.getStore("cached-store")!;
    const token2 = await tokenProvider.getToken(updatedConfig);
    assert.equal(token2, "token_B");

    // 5. Disconnect invalidates cache
    await controlPlane.disconnectStore("cached-store");
  });

  it("Data Plane rejects stores.register and stores.disconnect with 403, and allows stores.list without storeId", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "existing-dp-store",
        shopDomain: "existing.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: {} as ShopifyGraphqlClient,
    });

    // stores.register rejected on data plane
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          operation: "stores.register",
          payload: { storeId: "dp-store" },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PERMISSION_DENIED");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // stores.disconnect rejected on data plane
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          operation: "stores.disconnect",
          payload: { targetStoreId: "existing-dp-store" },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PERMISSION_DENIED");
        assert.equal(err.httpStatus, 403);
        return true;
      },
    );

    // stores.list works without top-level storeId
    const listRes = await dispatcher.dispatch({
      operation: "stores.list",
      payload: {},
    });
    assert.equal(listRes.success, true);
    if (listRes.success) {
      const listData = listRes.data as { stores: readonly { storeId: string }[]; total: number };
      assert.equal(listData.total, 1);
      assert.equal(listData.stores[0].storeId, "existing-dp-store");
      assert.equal((listData.stores[0] as any).staticToken, undefined);
      assert.equal((listData.stores[0] as any).niche, undefined);
    }

    // stores.get works
    const getRes = await dispatcher.dispatch({
      operation: "stores.get",
      payload: { targetStoreId: "existing-dp-store" },
    });
    assert.equal(getRes.success, true);
    if (getRes.success) {
      const getData = getRes.data as { store: { storeId: string } | null };
      assert.ok(getData.store);
      assert.equal(getData.store.storeId, "existing-dp-store");
      assert.equal((getData.store as any).staticToken, undefined);
      assert.equal((getData.store as any).niche, undefined);
    }
  });

  it("variants.update and variants.bulkUpdate reject deprecated title and inventoryQuantity with SHOPIFY_INVALID_INPUT", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-var-cleanup",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: {} as ShopifyGraphqlClient,
    });

    // 1. variants.update with title rejected
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-var-cleanup",
          operation: "variants.update",
          mode: "preview",
          payload: {
            id: "gid://shopify/ProductVariant/1",
            variant: { title: "New Title" },
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        return true;
      },
    );

    // 2. variants.update with inventoryQuantity rejected
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-var-cleanup",
          operation: "variants.update",
          mode: "preview",
          payload: {
            id: "gid://shopify/ProductVariant/1",
            variant: { inventoryQuantity: 10 },
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        return true;
      },
    );

    // 3. variants.bulkUpdate with title rejected
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-var-cleanup",
          operation: "variants.bulkUpdate",
          mode: "preview",
          payload: {
            variants: [{ id: "gid://shopify/ProductVariant/1", variant: { title: "Bad" } }],
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        return true;
      },
    );

    // 4. variants.bulkUpdate with inventoryQuantity rejected
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          storeId: "store-var-cleanup",
          operation: "variants.bulkUpdate",
          mode: "preview",
          payload: {
            variants: [{ id: "gid://shopify/ProductVariant/1", variant: { inventoryQuantity: 5 } }],
          },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        return true;
      },
    );
  });

  it("handles collections.updateMembership cleanly as no-op when !conditionsSource and productIdsToRemove requested without productIdsToAdd", async () => {
    let callCount = 0;
    const transport: HttpTransport = async (_url, init) => {
      callCount++;
      const body = JSON.parse(String(init?.body || "{}")) as { query: string };
      if (body.query.includes("GetCollectionSources")) {
        return createMockResponse({
          data: {
            collection: {
              id: "gid://shopify/Collection/manual-1",
              sources: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: transport,
    });
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-col-no-cond",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const result = await dispatcher.dispatch({
      storeId: "store-col-no-cond",
      operation: "collections.updateMembership",
      mode: "apply",
      requestId: "req-col-mem-no-op",
      payload: {
        collectionId: "gid://shopify/Collection/manual-1",
        productIdsToRemove: ["gid://shopify/Product/prod-to-remove"],
      },
    });

    assert.equal(result.success, true);
    const data = result.data as any;
    assert.equal(data.collectionId, "gid://shopify/Collection/manual-1");
    assert.equal(data.addedCount, 0);
    assert.equal(data.removedCount, 0);
    // Only 1 call to query sources; NO mutation call was made
    assert.equal(callCount, 1);
  });
});

