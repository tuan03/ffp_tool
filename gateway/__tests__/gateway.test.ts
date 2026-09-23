import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGatewayHttpHandler,
  createStoreTransport,
  deterministicStringify,
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
  type ProductSummary,
} from "../index";

import { createModuleApiRunner } from "../../src/modules/module-api";
import { shopifyGatewayDevPlugin } from "../vite-plugin";
import { isLocalHost } from "../http-server";

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
    assert.equal(normalizeShopDomain("https://admin.shopify.com:443/store/capozen"), "capozen.myshopify.com");
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

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com/store/-invalid-"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com/store/invalid-"), (err: unknown) => {
      assert(err instanceof GatewayError);
      assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
      return true;
    });

    assert.throws(() => normalizeShopDomain("https://admin.shopify.com:443"), (err: unknown) => {
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
                description: "Product 1 description",
                descriptionHtml: "<p>Product 1 description</p>",
                status: "ACTIVE",
                tags: ["pod"],
                onlineStoreUrl: "https://store-test.myshopify.com/products/product-1",
                featuredImage: {
                  id: "gid://shopify/ProductImage/101",
                  url: "https://cdn.shopify.com/products/img-1.jpg",
                  altText: "Product 1 Image",
                  width: 800,
                  height: 800,
                },
                seo: {
                  title: "Product 1 SEO Title",
                  description: "Product 1 SEO Description",
                },
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
    const listData = res.data as {
      products: {
        id: string;
        title: string;
        description?: string;
        descriptionHtml?: string;
        onlineStoreUrl?: string;
        featuredImage?: { id?: string; url: string; altText?: string; width?: number; height?: number };
        seo?: { title?: string; description?: string };
      }[];
      pageInfo: { hasNextPage: boolean };
    };
    assert.equal(listData.products.length, 1);
    assert.equal(listData.pageInfo.hasNextPage, true);
    assert.equal(listData.products[0].description, "Product 1 description");
    assert.equal(listData.products[0].descriptionHtml, "<p>Product 1 description</p>");
    assert.equal(listData.products[0].onlineStoreUrl, "https://store-test.myshopify.com/products/product-1");
    assert.deepEqual(listData.products[0].featuredImage, {
      id: "gid://shopify/ProductImage/101",
      url: "https://cdn.shopify.com/products/img-1.jpg",
      altText: "Product 1 Image",
      width: 800,
      height: 800,
    });
    assert.deepEqual(listData.products[0].seo, {
      title: "Product 1 SEO Title",
      description: "Product 1 SEO Description",
    });

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
          description: "Detailed product description in plain text",
          descriptionHtml: "<p>Detailed product description in plain text</p>",
          status: "ACTIVE",
          tags: ["pod"],
          onlineStoreUrl: "https://store-test.myshopify.com/products/detailed-product",
          featuredImage: {
            id: "gid://shopify/ProductImage/201",
            url: "https://cdn.shopify.com/products/detail-featured.jpg",
            altText: "Detailed Product Featured",
            width: 1000,
            height: 1000,
          },
          images: {
            edges: [
              {
                node: {
                  id: "gid://shopify/ProductImage/201",
                  url: "https://cdn.shopify.com/products/detail-featured.jpg",
                  altText: "Detailed Product Featured",
                  width: 1000,
                  height: 1000,
                },
              },
              {
                node: {
                  id: "gid://shopify/ProductImage/202",
                  url: "https://cdn.shopify.com/products/detail-gallery.jpg",
                  altText: "Detailed Product Gallery",
                  width: 1000,
                  height: 1000,
                },
              },
            ],
          },
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
    const data = res.data as {
      product: {
        title: string;
        description?: string;
        onlineStoreUrl?: string;
        featuredImage?: { id?: string; url: string; altText?: string; width?: number; height?: number };
        images?: readonly { id?: string; url: string; altText?: string; width?: number; height?: number }[];
      };
    };
    assert.equal(data.product.title, "Detailed Product");
    assert.equal(data.product.description, "Detailed product description in plain text");
    assert.equal(data.product.onlineStoreUrl, "https://store-test.myshopify.com/products/detailed-product");
    assert.deepEqual(data.product.featuredImage, {
      id: "gid://shopify/ProductImage/201",
      url: "https://cdn.shopify.com/products/detail-featured.jpg",
      altText: "Detailed Product Featured",
      width: 1000,
      height: 1000,
    });
    assert.equal(data.product.images?.length, 2);
    assert.deepEqual(data.product.images?.[0], {
      id: "gid://shopify/ProductImage/201",
      url: "https://cdn.shopify.com/products/detail-featured.jpg",
      altText: "Detailed Product Featured",
      width: 1000,
      height: 1000,
    });
    assert.deepEqual(data.product.images?.[1], {
      id: "gid://shopify/ProductImage/202",
      url: "https://cdn.shopify.com/products/detail-gallery.jpg",
      altText: "Detailed Product Gallery",
      width: 1000,
      height: 1000,
    });
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
                description: "All summer designs",
                seo: {
                  title: "Summer Collection SEO Title",
                  description: "Summer Collection SEO Description",
                },
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
          seo: {
            title: "Summer Collection SEO Title",
            description: "Summer Collection SEO Description",
          },
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
    const listData = listRes.data as {
      collections: {
        title: string;
        productsCount: number;
        seo?: { title?: string; description?: string };
      }[];
    };
    assert.equal(listData.collections[0].title, "Summer Collection");
    assert.equal(listData.collections[0].productsCount, 42);
    assert.deepEqual(listData.collections[0].seo, {
      title: "Summer Collection SEO Title",
      description: "Summer Collection SEO Description",
    });

    const getRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.get",
      payload: { id: "gid://shopify/Collection/1" },
    });
    assert.equal(getRes.success, true);
    const getData = getRes.data as {
      collection: {
        title: string;
        description: string;
        seo?: { title?: string; description?: string };
      };
    };
    assert.equal(getData.collection.title, "Summer Collection");
    assert.equal(getData.collection.description, "All summer designs");
    assert.deepEqual(getData.collection.seo, {
      title: "Summer Collection SEO Title",
      description: "Summer Collection SEO Description",
    });
  });

  it("normalizes unpopulated and sparse SEO fields in products.list and collections.list", async () => {
    const dispatcher = setupGateway({
      data: {
        products: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
          edges: [
            {
              cursor: "p1",
              node: {
                id: "gid://shopify/Product/1",
                title: "No SEO Product",
                handle: "no-seo-prod",
                status: "ACTIVE",
                tags: [],
                seo: { title: null, description: null },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
              },
            },
            {
              cursor: "p2",
              node: {
                id: "gid://shopify/Product/2",
                title: "Partial Title Product",
                handle: "partial-title-prod",
                status: "ACTIVE",
                tags: [],
                seo: { title: "Custom SEO Title", description: null },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
              },
            },
            {
              cursor: "p3",
              node: {
                id: "gid://shopify/Product/3",
                title: "Null SEO Product",
                handle: "null-seo-prod",
                status: "ACTIVE",
                tags: [],
                seo: null,
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
              },
            },
          ],
        },
        collections: {
          pageInfo: { hasNextPage: false, hasPreviousPage: false },
          edges: [
            {
              cursor: "c1",
              node: {
                id: "gid://shopify/Collection/1",
                title: "No SEO Collection",
                handle: "no-seo-col",
                description: "desc",
                seo: { title: null, description: null },
                productsCount: { count: 10 },
                updatedAt: "2026-09-21",
              },
            },
            {
              cursor: "c2",
              node: {
                id: "gid://shopify/Collection/2",
                title: "Partial Description Collection",
                handle: "partial-desc-col",
                description: "desc",
                seo: { title: null, description: "Only SEO Description" },
                productsCount: { count: 5 },
                updatedAt: "2026-09-21",
              },
            },
          ],
        },
      },
    });

    const prodRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "products.list",
      payload: {},
    });
    assert.equal(prodRes.success, true);
    const prodData = prodRes.data as { products: { id: string; seo?: { title?: string; description?: string } }[] };
    assert.equal(prodData.products[0].seo, undefined);
    assert.deepEqual(prodData.products[1].seo, {
      title: "Custom SEO Title",
      description: undefined,
    });
    assert.equal(prodData.products[2].seo, undefined);

    const colRes = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.list",
      payload: {},
    });
    assert.equal(colRes.success, true);
    const colData = colRes.data as { collections: { id: string; seo?: { title?: string; description?: string } }[] };
    assert.equal(colData.collections[0].seo, undefined);
    assert.deepEqual(colData.collections[1].seo, {
      title: undefined,
      description: "Only SEO Description",
    });
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

      if (query.includes("collectionUpdate") || query.includes("collectionAddProducts") || query.includes("collectionRemoveProducts")) {
        return createMockResponse({
          data: {
            collectionAddProducts: {
              collection: {
                id: "gid://shopify/Collection/77",
                productsCount: { count: 1 },
              },
              userErrors: [],
            },
            collectionRemoveProducts: {
              userErrors: [],
            },
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
        err.code === "SHOPIFY_PARTIAL_WRITE" &&
        err.reconciliationRequired === true &&
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

      if (body.query.includes("CollectionAddProducts") || body.query.includes("CollectionUpdateMembership")) {
        updateVariables = body.variables;
        return createMockResponse({
          data: {
            collectionAddProducts: {
              collection: {
                id: "gid://shopify/Collection/subcol-1",
                productsCount: { count: 1 },
              },
              userErrors: [],
            },
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
    assert.ok(updateVariables);
    assert.deepEqual(updateVariables.productIds, ["gid://shopify/Product/prod-1"]);
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
      shopDomain: "updated-capozen",
      auth: {
        type: "static_access_token",
        accessToken: "shpat_new_secret_67890",
      },
    });
    assert.equal(updateRes.updated, true);
    assert.equal(registry.getStore("capozen-store")?.shopDomain, "updated-capozen.myshopify.com");
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

    // stores.get rejects when targetStoreId is empty or omitted
    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          operation: "stores.get",
          payload: {},
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        assert.equal(err.httpStatus, 400);
        return true;
      },
    );

    await assert.rejects(
      async () => {
        await dispatcher.dispatch({
          operation: "stores.get",
          payload: { targetStoreId: "   " },
        });
      },
      (err: unknown) => {
        assert(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
        assert.equal(err.httpStatus, 400);
        return true;
      },
    );
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

  it("handles collections.updateMembership cleanly with productIdsToRemove", async () => {
    let callCount = 0;
    const transport: HttpTransport = async (_url, init) => {
      callCount++;
      const body = JSON.parse(String(init?.body || "{}")) as { query: string };
      if (body.query.includes("GetCollectionSources")) {
        return createMockResponse({
          data: {
            collection: {
              id: "gid://shopify/Collection/manual-1",
              title: "Manual Collection",
            },
          },
        });
      }
      if (body.query.includes("CollectionRemoveProducts") || body.query.includes("CollectionUpdateMembership")) {
        return createMockResponse({
          data: {
            collectionRemoveProducts: {
              userErrors: [],
            },
            collectionUpdate: {
              collection: {
                id: "gid://shopify/Collection/manual-1",
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
    assert.equal(data.removedCount, 1);
    assert.equal(callCount, 2);
  });

  it("safely normalizes missing or malformed product image and url fields", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-img-edge",
        shopDomain: "store-img-edge.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);

    const fakeTransport: HttpTransport = async (_url, init) => {
      const body = JSON.parse(String(init?.body || "{}")) as { query: string };
      if (body.query.includes("ProductsList")) {
        return createMockResponse({
          data: {
            products: {
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
              edges: [
                {
                  cursor: "cur_1",
                  node: {
                    id: "gid://shopify/Product/1",
                    title: "Product Without Images",
                    handle: "prod-no-img",
                    status: "ACTIVE",
                    tags: [],
                    onlineStoreUrl: null,
                    featuredImage: null,
                    seo: null,
                    createdAt: "2026-09-01",
                    updatedAt: "2026-09-20",
                    variants: { edges: [] },
                  },
                },
                {
                  cursor: "cur_2",
                  node: {
                    id: "gid://shopify/Product/2",
                    title: "Product With Empty Image URL",
                    handle: "prod-empty-url",
                    status: "ACTIVE",
                    tags: [],
                    onlineStoreUrl: "",
                    featuredImage: { id: "img-bad", url: "", altText: "empty" },
                    seo: null,
                    createdAt: "2026-09-01",
                    updatedAt: "2026-09-20",
                    variants: { edges: [] },
                  },
                },
              ],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const listRes = await dispatcher.dispatch({
      storeId: "store-img-edge",
      operation: "products.list",
      payload: {},
    });

    assert.equal(listRes.success, true);
    const products = (listRes.data as { products: ProductSummary[] }).products;
    assert.equal(products[0].onlineStoreUrl, undefined);
    assert.equal(products[0].featuredImage, undefined);
    assert.equal(products[0].images, undefined);

    assert.equal(products[1].onlineStoreUrl, "");
    assert.equal(products[1].featuredImage, undefined);
  });

  it("handles products.create and products.update preview with images, url, and description", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-preview-img",
        shopDomain: "store-preview-img.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: async () => createMockResponse({}),
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const createPreview = await dispatcher.dispatch({
      storeId: "store-preview-img",
      operation: "products.create",
      mode: "preview",
      payload: {
        product: {
          title: "Preview With Images",
          description: "Preview plain description",
          onlineStoreUrl: "https://store.example.com/products/preview-with-images",
          featuredImage: {
            id: "gid://shopify/ProductImage/preview-1",
            url: "https://cdn.shopify.com/preview-1.jpg",
            altText: "Preview Image 1",
            width: 800,
            height: 800,
          },
          images: [
            {
              id: "gid://shopify/ProductImage/preview-1",
              url: "https://cdn.shopify.com/preview-1.jpg",
              altText: "Preview Image 1",
              width: 800,
              height: 800,
            },
          ],
        },
      },
    });

    assert.equal(createPreview.success, true);
    const createdProduct = (createPreview.data as { product: ProductSummary }).product;
    assert.equal(createdProduct.description, "Preview plain description");
    assert.equal(createdProduct.onlineStoreUrl, "https://store.example.com/products/preview-with-images");
    assert.deepEqual(createdProduct.featuredImage, {
      id: "gid://shopify/ProductImage/preview-1",
      url: "https://cdn.shopify.com/preview-1.jpg",
      altText: "Preview Image 1",
      width: 800,
      height: 800,
    });
    assert.equal(createdProduct.images?.length, 1);

    const updatePreview = await dispatcher.dispatch({
      storeId: "store-preview-img",
      operation: "products.update",
      mode: "preview",
      payload: {
        id: "gid://shopify/Product/existing-1",
        product: {
          title: "Updated Preview",
          description: "Updated plain description",
          onlineStoreUrl: "https://store.example.com/products/updated-preview",
          featuredImage: {
            url: "https://cdn.shopify.com/updated-preview.jpg",
          },
        },
      },
    });

    assert.equal(updatePreview.success, true);
    const updatedProduct = (updatePreview.data as { product: ProductSummary }).product;
    assert.equal(updatedProduct.description, "Updated plain description");
    assert.equal(updatedProduct.onlineStoreUrl, "https://store.example.com/products/updated-preview");
    assert.deepEqual(updatedProduct.featuredImage, {
      id: undefined,
      url: "https://cdn.shopify.com/updated-preview.jpg",
      altText: undefined,
      width: undefined,
      height: undefined,
    });
  });

  it("safely handles products.get with null edges, whitespace urls, and null dimensions", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-edges",
        shopDomain: "store-edges.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const fakeTransport: HttpTransport = async () => {
      return createMockResponse({
        data: {
          product: {
            id: "gid://shopify/Product/sparse-1",
            title: "Sparse Product",
            handle: "sparse-product",
            description: null,
            descriptionHtml: null,
            status: "ACTIVE",
            tags: [],
            onlineStoreUrl: null,
            featuredImage: {
              id: "gid://shopify/ProductImage/f1",
              url: "  https://cdn.shopify.com/trimmed.jpg  ",
              altText: null,
              width: null,
              height: null,
            },
            images: {
              edges: [
                null,
                {
                  node: {
                    id: "gid://shopify/ProductImage/i1",
                    url: "   ",
                    altText: "whitespace url",
                    width: null,
                    height: null,
                  },
                },
                {
                  node: {
                    id: null,
                    url: "https://cdn.shopify.com/valid.jpg",
                    altText: "Valid Image",
                    width: 1200,
                    height: 1200,
                  },
                },
              ],
            },
            createdAt: "2026-09-01",
            updatedAt: "2026-09-20",
            variants: { edges: [] },
          },
        },
      });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-edges",
      operation: "products.get",
      payload: { id: "gid://shopify/Product/sparse-1" },
    });

    assert.equal(res.success, true);
    const product = (res.data as { product: ProductSummary }).product;
    assert.equal(product.description, undefined);
    assert.equal(product.onlineStoreUrl, undefined);
    assert.deepEqual(product.featuredImage, {
      id: "gid://shopify/ProductImage/f1",
      url: "https://cdn.shopify.com/trimmed.jpg",
      altText: undefined,
      width: undefined,
      height: undefined,
    });
    // Whitespace url and null edge filtered out, valid image retained
    assert.equal(product.images?.length, 1);
    assert.deepEqual(product.images?.[0], {
      id: undefined,
      url: "https://cdn.shopify.com/valid.jpg",
      altText: "Valid Image",
      width: 1200,
      height: 1200,
    });
  });

  it("filters empty and whitespace URLs in preview and falls back description in write operations", async () => {
    let capturedCreateVariables: Record<string, unknown> | undefined;
    let capturedUpdateVariables: Record<string, unknown> | undefined;

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-write-fallback",
        shopDomain: "store-write-fallback.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productCreate")) {
        capturedCreateVariables = body.variables;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/created-10",
                title: "Created Product",
                handle: "created-product",
                description: "Plain text description",
                descriptionHtml: "<p>Plain text description</p>",
                status: "DRAFT",
                tags: [],
                onlineStoreUrl: "https://store.myshopify.com/products/created-product",
                featuredImage: null,
                images: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("productUpdate")) {
        capturedUpdateVariables = body.variables;
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/updated-10",
                title: "Updated Product",
                handle: "updated-product",
                description: "Plain text updated description",
                descriptionHtml: "<p>Plain text updated description</p>",
                status: "ACTIVE",
                tags: [],
                onlineStoreUrl: "https://store.myshopify.com/products/updated-product",
                featuredImage: null,
                images: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
                variants: { edges: [] },
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
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    // Preview mode: filters whitespace/empty URLs
    const previewRes = await dispatcher.dispatch({
      storeId: "store-write-fallback",
      operation: "products.create",
      mode: "preview",
      payload: {
        product: {
          title: "Preview Filter Test",
          featuredImage: { url: "   " },
          images: [{ url: "" }, { url: "  " }, { url: "https://cdn.shopify.com/valid.jpg" }],
        },
      },
    });
    assert.equal(previewRes.success, true);
    if (!previewRes.success) {
      assert.fail("previewRes should succeed");
    }
    const previewProd = (previewRes.data as { product: ProductSummary }).product;
    assert.equal(previewProd.featuredImage, undefined);
    assert.equal(previewProd.images?.length, 1);
    assert.equal(previewProd.images?.[0].url, "https://cdn.shopify.com/valid.jpg");

    // Apply mode: description falls back to descriptionHtml when descriptionHtml omitted
    await dispatcher.dispatch({
      storeId: "store-write-fallback",
      operation: "products.create",
      mode: "apply",
      requestId: "req-create-desc-fallback",
      payload: {
        product: {
          title: "Created with description",
          description: "Plain description fallback",
        },
      },
    });
    const createInput = (capturedCreateVariables?.product as Record<string, unknown>);
    assert.equal(createInput.descriptionHtml, "Plain description fallback");

    await dispatcher.dispatch({
      storeId: "store-write-fallback",
      operation: "products.update",
      mode: "apply",
      requestId: "req-update-desc-fallback",
      payload: {
        id: "gid://shopify/Product/updated-10",
        product: {
          description: "Updated description fallback",
        },
      },
    });
    const updateInput = (capturedUpdateVariables?.product as Record<string, unknown>);
    assert.equal(updateInput.descriptionHtml, "Updated description fallback");
  });

  it("preserves idempotency state as RECONCILIATION_REQUIRED on products.create partial-write and blocks duplicate creation on retry", async () => {
    let productCreateCalls = 0;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productCreate(")) {
        productCreateCalls++;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/partial-123",
                title: "Partial Product",
                handle: "partial-product",
                status: "DRAFT",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
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
              productVariants: null,
              userErrors: [{ field: ["variants", "price"], message: "Invalid variant price" }],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const idempotencyStore = new InMemoryIdempotencyStore();
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-partial-test",
        shopDomain: "test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: client,
      idempotencyStore,
    });

    // First call: partial write fails on step 2
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-partial-test",
          operation: "products.create",
          mode: "apply",
          requestId: "req-partial-write-1",
          payload: {
            product: {
              title: "Partial Product",
              variants: [{ price: "invalid-price" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.reconciliationRequired, true);
        assert.equal(err.details?.createdProductId, "gid://shopify/Product/partial-123");
        assert.equal(err.details?.reconciliationRequired, true);
        return true;
      },
    );

    // Verify idempotency store recorded RECONCILIATION_REQUIRED
    const record = await idempotencyStore.get("store-partial-test:req-partial-write-1");
    assert.ok(record, "Idempotency key must not be deleted on partial write");
    assert.equal(record?.state, "RECONCILIATION_REQUIRED");

    // Second call: retry with same requestId MUST be rejected with 409 SHOPIFY_PARTIAL_WRITE
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-partial-test",
          operation: "products.create",
          mode: "apply",
          requestId: "req-partial-write-1",
          payload: {
            product: {
              title: "Partial Product",
              variants: [{ price: "invalid-price" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.details?.createdProductId, "gid://shopify/Product/partial-123");
        return true;
      },
    );

    // Ensure productCreate was NOT called again (preventing duplicate product)
    assert.equal(productCreateCalls, 1);
  });

  it("maps featuredImage and images into media input for products.create and products.update in apply mode", async () => {
    let capturedCreateMedia: unknown;
    let capturedUpdateMedia: unknown;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productCreate(")) {
        capturedCreateMedia = body.variables.media;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/media-prod",
                title: "Media Product",
                handle: "media-product",
                status: "ACTIVE",
                featuredImage: {
                  id: "gid://shopify/ProductImage/feat-1",
                  url: "https://example.com/feat.jpg",
                  altText: "Main featured",
                  width: 800,
                  height: 600,
                },
                images: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductImage/feat-1",
                        url: "https://example.com/feat.jpg",
                        altText: "Main featured",
                      },
                    },
                    {
                      node: {
                        id: "gid://shopify/ProductImage/extra-1",
                        url: "https://example.com/extra.jpg",
                        altText: "Extra shot",
                      },
                    },
                  ],
                },
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("productUpdate(")) {
        capturedUpdateMedia = body.variables.media;
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/media-prod",
                title: "Updated Media Product",
                handle: "media-product",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-media-test",
        shopDomain: "media.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    // products.create in apply mode with featuredImage and images
    const createRes = await dispatcher.dispatch({
      storeId: "store-media-test",
      operation: "products.create",
      mode: "apply",
      requestId: "req-media-create-1",
      payload: {
        product: {
          title: "Media Product",
          featuredImage: { url: "https://example.com/feat.jpg", altText: "Main featured" },
          images: [
            { url: "https://example.com/feat.jpg" }, // duplicate URL filtered
            { url: "https://example.com/extra.jpg", altText: "Extra shot" },
          ],
        },
      },
    });

    assert.equal(createRes.success, true);
    assert.deepEqual(capturedCreateMedia, [
      { originalSource: "https://example.com/feat.jpg", mediaContentType: "IMAGE", alt: "Main featured" },
      { originalSource: "https://example.com/extra.jpg", mediaContentType: "IMAGE", alt: "Extra shot" },
    ]);

    // products.update in apply mode with featuredImage and images
    const updateRes = await dispatcher.dispatch({
      storeId: "store-media-test",
      operation: "products.update",
      mode: "apply",
      requestId: "req-media-update-1",
      payload: {
        id: "gid://shopify/Product/media-prod",
        product: {
          title: "Updated Media Product",
          featuredImage: { url: "https://example.com/update-feat.jpg", altText: "Updated main" },
        },
      },
    });

    assert.equal(updateRes.success, true);
    assert.deepEqual(capturedUpdateMedia, [
      { originalSource: "https://example.com/update-feat.jpg", mediaContentType: "IMAGE", alt: "Updated main" },
    ]);
  });

  it("products.bulkUpdate preserves errorCode and reconciliationRequired on individual items and sets top-level awareness", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        const prodId = (body.variables.product as Record<string, unknown>).id;
        if (prodId === "gid://shopify/Product/fail-timeout") {
          throw new GatewayError("Write timeout", "SHOPIFY_UNKNOWN_WRITE_STATE", 500);
        }
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: prodId,
                title: "Updated Bulk Product",
                handle: "updated-bulk-product",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const idempotencyStore = new InMemoryIdempotencyStore();
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-bulk-test",
        shopDomain: "bulk.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: client,
      idempotencyStore,
    });

    const bulkRes = await dispatcher.dispatch({
      storeId: "store-bulk-test",
      operation: "products.bulkUpdate",
      mode: "apply",
      requestId: "req-bulk-unknown-1",
      payload: {
        products: [
          { id: "gid://shopify/Product/ok-1", product: { title: "OK Product" } },
          { id: "gid://shopify/Product/fail-timeout", product: { title: "Timed out Product" } },
        ],
      },
    });

    assert.equal(bulkRes.success, true);
    if (!bulkRes.success) {
      assert.fail("bulkRes should succeed");
    }

    const data = bulkRes.data as {
      successCount: number;
      failedCount: number;
      reconciliationRequired?: boolean;
      items: readonly { id: string; ok: boolean; errorCode?: string; reconciliationRequired?: boolean }[];
    };

    assert.equal(data.successCount, 1);
    assert.equal(data.failedCount, 1);
    assert.equal(data.reconciliationRequired, true);

    const okItem = data.items.find((i) => i.id === "gid://shopify/Product/ok-1");
    assert.ok(okItem);
    assert.equal(okItem.ok, true);

    const failItem = data.items.find((i) => i.id === "gid://shopify/Product/fail-timeout");
    assert.ok(failItem);
    assert.equal(failItem.ok, false);
    assert.equal(failItem.errorCode, "SHOPIFY_UNKNOWN_WRITE_STATE");
    assert.equal(failItem.reconciliationRequired, true);

    // Verify idempotency store recorded RECONCILIATION_REQUIRED
    const record = await idempotencyStore.get("store-bulk-test:req-bulk-unknown-1");
    assert.ok(record);
    assert.equal(record?.state, "RECONCILIATION_REQUIRED");
  });

  it("stores.list and stores.get return connected: undefined for unverified stores in data plane", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "unverified-store",
        shopDomain: "unverified.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: {} as any });

    const listRes = await dispatcher.dispatch({
      operation: "stores.list",
      payload: {},
    });
    assert.equal(listRes.success, true);
    if (listRes.success) {
      const data = listRes.data as { stores: readonly { storeId: string; connected?: boolean }[] };
      assert.equal(data.stores[0].connected, undefined);
    }

    const getRes = await dispatcher.dispatch({
      operation: "stores.get",
      payload: { targetStoreId: "unverified-store" },
    });
    assert.equal(getRes.success, true);
    if (getRes.success) {
      const data = getRes.data as { store: { storeId: string; connected?: boolean } | null };
      assert.equal(data.store?.connected, undefined);
    }
  });

  it("collections.create and collections.update map description properly from descriptionHtml or description", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("collectionCreate(")) {
        return createMockResponse({
          data: {
            collectionCreate: {
              collection: {
                id: "gid://shopify/Collection/create-desc-1",
                title: "Created Collection",
                handle: "created-collection",
                description: null,
                descriptionHtml: "<p>Created HTML description</p>",
                productsCount: { count: 0 },
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("collectionUpdate(")) {
        return createMockResponse({
          data: {
            collectionUpdate: {
              collection: {
                id: "gid://shopify/Collection/update-desc-1",
                title: "Updated Collection",
                handle: "updated-collection",
                description: "Plain text description",
                descriptionHtml: "<p>Updated HTML description</p>",
                productsCount: { count: 0 },
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-collection-test",
        shopDomain: "collection.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const createRes = await dispatcher.dispatch({
      storeId: "store-collection-test",
      operation: "collections.create",
      mode: "apply",
      requestId: "req-col-desc-create",
      payload: { collection: { title: "Created Collection" } },
    });
    assert.equal(createRes.success, true);
    if (createRes.success) {
      const data = createRes.data as { collection: { description?: string } };
      assert.equal(data.collection.description, "Created HTML description");
    }

    const updateRes = await dispatcher.dispatch({
      storeId: "store-collection-test",
      operation: "collections.update",
      mode: "apply",
      requestId: "req-col-desc-update",
      payload: { id: "gid://shopify/Collection/update-desc-1", collection: { title: "Updated Collection" } },
    });
    assert.equal(updateRes.success, true);
    if (updateRes.success) {
      const data = updateRes.data as { collection: { description?: string } };
      assert.equal(data.collection.description, "Plain text description");
    }
  });

  it("retains idempotency RECONCILIATION_REQUIRED even when a mismatched payload is submitted with same requestId", async () => {
    let productCreateCalls = 0;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productCreate(")) {
        productCreateCalls++;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/rec-mismatch-prod",
                title: "Mismatch Test Prod",
                handle: "mismatch-test-prod",
                status: "DRAFT",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
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
              productVariants: null,
              userErrors: [{ field: ["variants"], message: "Variant creation error" }],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const idempotencyStore = new InMemoryIdempotencyStore();
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-idemp-test",
        shopDomain: "idemp.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: client,
      idempotencyStore,
    });

    const initialPayload = {
      product: {
        title: "Mismatch Test Prod",
        variants: [{ price: "25.00" }],
      },
    };

    // 1. Initial call fails during variant creation -> partial write
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-idemp-test",
          operation: "products.create",
          mode: "apply",
          requestId: "req-rec-mismatch-1",
          payload: initialPayload,
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.reconciliationRequired, true);
        assert.equal(err.details?.createdProductId, "gid://shopify/Product/rec-mismatch-prod");
        return true;
      },
    );
    assert.equal(productCreateCalls, 1);

    // Verify idempotency store is RECONCILIATION_REQUIRED
    const entryAfterFail = await idempotencyStore.get("store-idemp-test:req-rec-mismatch-1");
    assert.ok(entryAfterFail);
    assert.equal(entryAfterFail.state, "RECONCILIATION_REQUIRED");

    // 2. Someone submits the SAME requestId with a DIFFERENT payload (e.g. attacker or client bug)
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-idemp-test",
          operation: "products.create",
          mode: "apply",
          requestId: "req-rec-mismatch-1",
          payload: { product: { title: "Completely Different Payload" } },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_USER_ERROR");
        assert.equal(err.httpStatus, 409);
        assert.ok(err.message.includes("different payload"));
        return true;
      },
    );

    // CRITICAL: The idempotency store must NOT have been deleted by the mismatched payload rejection!
    const entryAfterMismatch = await idempotencyStore.get("store-idemp-test:req-rec-mismatch-1");
    assert.ok(entryAfterMismatch, "Idempotency entry must NOT be deleted by mismatched payload call");
    assert.equal(entryAfterMismatch.state, "RECONCILIATION_REQUIRED");

    // 3. Retry with original payload must STILL be rejected with SHOPIFY_PARTIAL_WRITE, preventing duplicate creation
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-idemp-test",
          operation: "products.create",
          mode: "apply",
          requestId: "req-rec-mismatch-1",
          payload: initialPayload,
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.details?.createdProductId, "gid://shopify/Product/rec-mismatch-prod");
        return true;
      },
    );

    // Ensure productCreate was STILL called only once!
    assert.equal(productCreateCalls, 1);
  });

  it("extracts media with string URLs, src fallbacks, and decodes multi-paragraph HTML descriptions", async () => {
    let capturedMedia: unknown;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productCreate(")) {
        capturedMedia = body.variables.media;
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/media-extra-prod",
                title: "Media Extra Product",
                handle: "media-extra-product",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("collectionCreate(")) {
        return createMockResponse({
          data: {
            collectionCreate: {
              collection: {
                id: "gid://shopify/Collection/html-desc-col",
                title: "HTML Collection",
                handle: "html-collection",
                description: null,
                descriptionHtml: "<p>First paragraph.</p><p>Second &amp; third paragraph with &quot;quotes&quot;.</p>",
                productsCount: { count: 0 },
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-media-robust-test",
        shopDomain: "media-robust.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    // Test product create with featuredImage (src/alt) and images (string url + object src/alt)
    await dispatcher.dispatch({
      storeId: "store-media-robust-test",
      operation: "products.create",
      mode: "apply",
      requestId: "req-media-robust",
      payload: {
        product: {
          title: "Media Extra Product",
          featuredImage: { src: "https://example.com/featured-src.png", alt: "Featured Alt" },
          images: [
            "https://example.com/string-url.png",
            { src: "https://example.com/extra-src.png", alt: "Extra Alt" },
          ],
        },
      },
    });

    assert.deepEqual(capturedMedia, [
      { originalSource: "https://example.com/featured-src.png", mediaContentType: "IMAGE", alt: "Featured Alt" },
      { originalSource: "https://example.com/string-url.png", mediaContentType: "IMAGE" },
      { originalSource: "https://example.com/extra-src.png", mediaContentType: "IMAGE", alt: "Extra Alt" },
    ]);

    // Test collection description with HTML entities and paragraph spacing
    const colRes = await dispatcher.dispatch({
      storeId: "store-media-robust-test",
      operation: "collections.create",
      mode: "apply",
      requestId: "req-col-html-desc",
      payload: { collection: { title: "HTML Collection" } },
    });
    assert.equal(colRes.success, true);
    if (colRes.success) {
      const data = colRes.data as { collection: { description?: string } };
      assert.equal(
        data.collection.description,
        'First paragraph. Second & third paragraph with "quotes".',
      );
    }
  });

  it("StoreControlPlane marks onboarded stores as connected: true in getStore and listStores", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("StoreConnectionTest")) {
        return createMockResponse({
          data: {
            shop: {
              id: "gid://shopify/Shop/12345",
              name: "Control Plane Verified Shop",
              myshopifyDomain: "verified.myshopify.com",
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([]);
    const tokenProvider = new CompositeTokenProvider();
    const client = new ShopifyGraphqlClient({
      tokenProvider,
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const controlPlane = new StoreControlPlane({
      storeRegistry: registry,
      tokenProvider,
      graphqlClient: client,
    });

    // Onboard store
    const regResult = await controlPlane.registerStore({
      storeId: "verified-store-1",
      shopDomain: "verified.myshopify.com",
      auth: { type: "static_access_token", accessToken: "shpat_verified_token" },
    });
    assert.equal(regResult.store.connected, true);

    // Check getStore
    const getResult = await controlPlane.getStore("verified-store-1");
    assert.ok(getResult.store);
    assert.equal(getResult.store.connected, true);

    // Check listStores
    const listResult = await controlPlane.listStores();
    assert.equal(listResult.stores.length, 1);
    assert.equal(listResult.stores[0].connected, true);

    // Disconnect
    await controlPlane.disconnectStore("verified-store-1");
    const getAfterDisconnect = await controlPlane.getStore("verified-store-1");
    assert.equal(getAfterDisconnect.store, null);
  });
});

describe("Gateway: Level 2 Hardening (Auth, Timeouts, Auto-Recovery, Idempotency Pruning)", () => {
  it("verifies gateway auth token with X-Gateway-Key and Authorization Bearer header", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-auth-test",
        shopDomain: "store-auth-test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const fakeTransport: HttpTransport = async () =>
      createMockResponse({ data: { shop: { name: "Auth Test Store", currencyCode: "USD" } } });
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
    const handler = createGatewayHttpHandler(dispatcher, { authToken: "my-gateway-secret-key" });

    // 1. Missing auth header -> 401 SHOPIFY_AUTH_FAILED
    const reqNoAuth = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: "store-auth-test", operation: "connection.test", payload: {} }),
    });
    const resNoAuth = await handler(reqNoAuth);
    assert.equal(resNoAuth.status, 401);
    const bodyNoAuth = (await resNoAuth.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyNoAuth.success, false);
    assert.equal(bodyNoAuth.error.code, "SHOPIFY_AUTH_FAILED");

    // 2. Mismatched auth header -> 401 SHOPIFY_AUTH_FAILED
    const reqBadAuth = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Key": "wrong-key" },
      body: JSON.stringify({ storeId: "store-auth-test", operation: "connection.test", payload: {} }),
    });
    const resBadAuth = await handler(reqBadAuth);
    assert.equal(resBadAuth.status, 401);

    // 3. Valid X-Gateway-Key -> 200 OK
    const reqValidKey = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Gateway-Key": "my-gateway-secret-key" },
      body: JSON.stringify({ storeId: "store-auth-test", operation: "connection.test", payload: {} }),
    });
    const resValidKey = await handler(reqValidKey);
    assert.equal(resValidKey.status, 200);

    // 4. Valid Authorization: Bearer <token> -> 200 OK
    const reqValidBearer = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer my-gateway-secret-key" },
      body: JSON.stringify({ storeId: "store-auth-test", operation: "connection.test", payload: {} }),
    });
    const resValidBearer = await handler(reqValidBearer);
    assert.equal(resValidBearer.status, 200);
  });

  it("enforces MAX_BODY_BYTES (5MB) and rejects payload too large with HTTP 413", async () => {
    const registry = new InMemoryStoreRegistry();
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: {} as ShopifyGraphqlClient });
    const handler = createGatewayHttpHandler(dispatcher, { maxBodyBytes: 1024 }); // 1KB limit for test

    // Content-length header > limit
    const reqHeaderOver = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": "2048" },
      body: JSON.stringify({ data: "short" }),
    });
    const resHeaderOver = await handler(reqHeaderOver);
    assert.equal(resHeaderOver.status, 413);
    const bodyHeaderOver = (await resHeaderOver.json()) as { success: boolean; error: { code: string } };
    assert.equal(bodyHeaderOver.error.code, "SHOPIFY_INVALID_INPUT");

    // Actual body > limit
    const largeString = "x".repeat(2048);
    const reqBodyOver = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ large: largeString }),
    });
    const resBodyOver = await handler(reqBodyOver);
    assert.equal(resBodyOver.status, 413);
  });

  it("applies default timeouts and maps write mutation timeout to SHOPIFY_UNKNOWN_WRITE_STATE", async () => {
    const store: StoreConfig = {
      storeId: "store-timeout",
      shopDomain: "store-timeout.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    };

    // Hanging transport
    const hangingTransport: HttpTransport = async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: hangingTransport,
    });

    // Write mutation timeout -> SHOPIFY_UNKNOWN_WRITE_STATE with reconciliationRequired = true
    await assert.rejects(
      async () => {
        await client.query(store, "mutation { productCreate { product { id } } }", {}, {
          isWrite: true,
          timeoutMs: 20, // override default for fast test
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );

    // Read query timeout -> SHOPIFY_NETWORK_ERROR with httpStatus 504
    await assert.rejects(
      async () => {
        await client.query(store, "query { products { edges { node { id } } } }", {}, {
          isWrite: false,
          timeoutMs: 20,
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
        assert.equal(err.httpStatus, 504);
        return true;
      },
    );
  });

  it("recovers automatically from Shopify HTTP 401 by invalidating token cache and retrying once", async () => {
    let tokenFetchCount = 0;
    let transportCallCount = 0;

    const mockTokenProvider: CompositeTokenProvider = {
      getToken: async () => {
        tokenFetchCount++;
        return `fresh-token-${tokenFetchCount}`;
      },
      invalidate: () => {
        // cache invalidated
      },
    } as unknown as CompositeTokenProvider;

    const fakeTransport: HttpTransport = async (_url, init) => {
      transportCallCount++;
      const headers = init?.headers as Record<string, string>;
      if (headers["X-Shopify-Access-Token"] === "fresh-token-1") {
        // First attempt returns 401 Unauthorized
        return createMockResponse({ errors: "Unauthorized" }, 401);
      }
      // Retry with fresh-token-2 succeeds
      return createMockResponse({
        data: {
          product: { id: "gid://shopify/Product/rec-1", title: "Recovered Product" },
        },
      });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: mockTokenProvider,
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const store: StoreConfig = {
      storeId: "store-recovery",
      shopDomain: "store-recovery.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "client_credentials", clientId: "cid", clientSecret: "csec" },
    };

    const result = await client.query<{ product: { id: string; title: string } }>(
      store,
      "query { product { id title } }",
    );

    assert.equal(result.product.title, "Recovered Product");
    assert.equal(transportCallCount, 2);
    assert.equal(tokenFetchCount, 2);
  });

  it("fails with SHOPIFY_AUTH_FAILED if retry after 401 also returns 401 (no infinite loop)", async () => {
    let transportCallCount = 0;

    const mockTokenProvider: CompositeTokenProvider = {
      getToken: async () => "bad-token",
      invalidate: () => {},
    } as unknown as CompositeTokenProvider;

    const fakeTransport: HttpTransport = async () => {
      transportCallCount++;
      return createMockResponse({ errors: "Unauthorized" }, 401);
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: mockTokenProvider,
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const store: StoreConfig = {
      storeId: "store-perm-401",
      shopDomain: "store-perm-401.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "client_credentials", clientId: "cid", clientSecret: "csec" },
    };

    await assert.rejects(
      async () => {
        await client.query(store, "query { shop { name } }");
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_AUTH_FAILED");
        assert.equal(err.httpStatus, 401);
        return true;
      },
    );

    // Exactly 2 attempts: initial + 1 retry
    assert.equal(transportCallCount, 2);
  });

  it("prunes expired entries from InMemoryIdempotencyStore to prevent memory leaks", async () => {
    const store = new InMemoryIdempotencyStore({
      defaultTtlMs: 20,
      pruneIntervalMs: 0, // disable automatic interval for deterministic unit test
      maxEntries: 2,
    });

    await store.set("k1", {
      state: "COMPLETED",
      operation: "products.create",
      payloadHash: "hash1",
      createdAtMs: Date.now(),
    }, 10); // 10ms TTL

    await store.set("k2", {
      state: "COMPLETED",
      operation: "products.create",
      payloadHash: "hash2",
      createdAtMs: Date.now(),
    }, 100_000); // 100s TTL

    // Wait 25ms for k1 to expire
    await new Promise((r) => setTimeout(r, 25));

    // Proactive pruneExpired removes k1
    const pruned = store.pruneExpired();
    assert.equal(pruned, 1);

    // k1 is gone, k2 remains
    assert.equal(await store.get("k1"), null);
    const item2 = await store.get("k2");
    assert.ok(item2);
    assert.equal(item2.payloadHash, "hash2");

    store.destroy();
  });

  it("aborts OAuth token exchange when request hangs and throws 504 timeout error", async () => {
    const store: StoreConfig = {
      storeId: "store-oauth-timeout",
      shopDomain: "store-oauth-timeout.myshopify.com",
      apiVersion: "2026-07",
      auth: {
        type: "client_credentials",
        clientId: "cid",
        clientSecret: "csec",
      },
    };

    const hangingTransport: HttpTransport = async (_url, init) => {
      return new Promise<Response>((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const abortErr = new Error("The operation was aborted");
            abortErr.name = "AbortError";
            reject(abortErr);
          });
        }
      });
    };

    const provider = new ClientCredentialsTokenProvider({
      transport: hangingTransport,
      timeoutMs: 20,
    });

    await assert.rejects(
      async () => {
        await provider.getToken(store);
      },
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
        assert.equal(err.httpStatus, 504);
        return true;
      },
    );
  });

  it("recovers automatically when Shopify returns GraphQL UNAUTHORIZED error", async () => {
    let callCount = 0;
    const mockTokenProvider: CompositeTokenProvider = {
      getToken: async () => {
        callCount++;
        return `token-${callCount}`;
      },
      invalidate: () => {},
    } as unknown as CompositeTokenProvider;

    const fakeTransport: HttpTransport = async (_url, init) => {
      const headers = init?.headers as Record<string, string>;
      if (headers["X-Shopify-Access-Token"] === "token-1") {
        return createMockResponse({
          errors: [{ message: "Unauthorized access", extensions: { code: "UNAUTHORIZED" } }],
        });
      }
      return createMockResponse({
        data: { shop: { name: "Recovered Shop" } },
      });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider: mockTokenProvider,
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });

    const store: StoreConfig = {
      storeId: "store-graphql-401",
      shopDomain: "store-graphql-401.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "client_credentials", clientId: "cid", clientSecret: "csec" },
    };

    const result = await client.query<{ shop: { name: string } }>(store, "query { shop { name } }");
    assert.equal(result.shop.name, "Recovered Shop");
    assert.equal(callCount, 2);
  });

  it("allows unauthenticated access when authToken is not configured", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-open",
        shopDomain: "store-open.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const fakeTransport: HttpTransport = async () =>
      createMockResponse({ data: { shop: { name: "Open Store", currencyCode: "USD" } } });
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });
    const handler = createGatewayHttpHandler(dispatcher, {});

    const req = new Request("http://localhost:8787/api/shopify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ storeId: "store-open", operation: "connection.test", payload: {} }),
    });
    const res = await handler(req);
    assert.equal(res.status, 200);
  });

  it("binds startGatewayServer to 127.0.0.1 by default", async () => {
    const { startGatewayServer } = await import("../server");
    const server = startGatewayServer({ port: 3098 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const addr = server.address() as import("node:net").AddressInfo;
    assert.ok(addr);
    assert.equal(addr.address, "127.0.0.1");
    assert.equal(addr.port, 3098);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("rejects unauthenticated requests with 401 before body buffering even when payload exceeds maxBodyBytes", async () => {
    const { startGatewayServer } = await import("../server");
    const server = startGatewayServer({
      port: 3105,
      authToken: "secret-token-l2",
      maxBodyBytes: 1024,
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      // Send an unauthenticated request with a 2048-byte body
      const res = await fetch("http://127.0.0.1:3105/api/shopify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ large: "x".repeat(2048) }),
      });
      // MUST be 401 (not 413) because auth is evaluated immediately before buffering
      assert.equal(res.status, 401);
      const json = (await res.json()) as { error: { code: string } };
      assert.equal(json.error.code, "SHOPIFY_AUTH_FAILED");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects non-POST requests to /api/shopify with HTTP 405 Method Not Allowed in server", async () => {
    const { startGatewayServer } = await import("../server");
    const server = startGatewayServer({ port: 3106 });
    await new Promise((resolve) => setTimeout(resolve, 50));

    try {
      const res = await fetch("http://127.0.0.1:3106/api/shopify", {
        method: "GET",
      });
      assert.equal(res.status, 405);
      const json = (await res.json()) as { error: { code: string } };
      assert.equal(json.error.code, "SHOPIFY_INVALID_INPUT");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("ClientCredentialsTokenProvider deduplicates concurrent in-flight OAuth token exchange requests", async () => {
    let exchangeCalls = 0;
    const fakeTransport: HttpTransport = async () => {
      exchangeCalls++;
      await new Promise((r) => setTimeout(r, 20));
      return createMockResponse({ access_token: "dedup-token", expires_in: 3600 });
    };

    const provider = new ClientCredentialsTokenProvider({
      transport: fakeTransport,
      clock: () => 1_000_000,
    });

    const store: StoreConfig = {
      storeId: "store-dedup",
      shopDomain: "dedup.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "client_credentials", clientId: "cid", clientSecret: "csec" },
    };

    // Run 5 concurrent getToken calls simultaneously
    const tokens = await Promise.all([
      provider.getToken(store),
      provider.getToken(store),
      provider.getToken(store),
      provider.getToken(store),
      provider.getToken(store),
    ]);

    assert.equal(exchangeCalls, 1);
    for (const t of tokens) {
      assert.equal(t, "dedup-token");
    }
  });

  it("InMemoryIdempotencyStore evicts oldest entries when maxEntries is reached with unexpired entries", async () => {
    const store = new InMemoryIdempotencyStore({
      defaultTtlMs: 100_000,
      pruneIntervalMs: 0,
      maxEntries: 2,
    });

    await store.set("k1", { state: "COMPLETED", operation: "products.create", payloadHash: "h1", createdAtMs: 1 });
    await store.set("k2", { state: "COMPLETED", operation: "products.create", payloadHash: "h2", createdAtMs: 2 });
    assert.ok(await store.get("k1"));
    assert.ok(await store.get("k2"));

    // Adding k3 when maxEntries is 2 and none expired evicts oldest (k1)
    await store.set("k3", { state: "COMPLETED", operation: "products.create", payloadHash: "h3", createdAtMs: 3 });
    assert.equal(await store.get("k1"), null);
    assert.ok(await store.get("k2"));
    assert.ok(await store.get("k3"));

    store.destroy();
  });

  it("deterministicStringify correctly handles undefined values in objects and arrays", () => {
    const objWithUndef = { a: undefined, b: "hello", c: 42 };
    const objWithoutUndef = { b: "hello", c: 42 };
    assert.equal(deterministicStringify(objWithUndef), deterministicStringify(objWithoutUndef));

    const arrWithUndef = [1, undefined, "test"];
    assert.equal(deterministicStringify(arrWithUndef), '[1,null,"test"]');
  });

  it("write mutation failure retains reconciliationRequired: true across 500, JSON error, and missing data", async () => {
    const store: StoreConfig = {
      storeId: "store-write-rec",
      shopDomain: "rec.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    };

    // 1. Non-ok response (500)
    const client500 = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: async () => createMockResponse("Internal Server Error", 500),
    });

    await assert.rejects(
      async () => client500.query(store, "mutation { x }", {}, { isWrite: true }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );

    // 2. Malformed JSON
    const clientBadJson = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: async () =>
        new Response("not json", { status: 200, headers: { "Content-Type": "application/json" } }),
    });

    await assert.rejects(
      async () => clientBadJson.query(store, "mutation { x }", {}, { isWrite: true }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );

    // 3. Missing data payload
    const clientNullData = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: async () => createMockResponse({ data: null }, 200),
    });

    await assert.rejects(
      async () => clientNullData.query(store, "mutation { x }", {}, { isWrite: true }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_UNKNOWN_WRITE_STATE");
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );
  });
});

describe("Gateway: Architectural & Operational Hardening (P1)", () => {
  it("products.update with existing image id updates alt text via fileUpdate and does not create new media", async () => {
    let capturedFileUpdate: unknown = null;
    let capturedCreateMedia: unknown = null;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/seo-test-1",
                title: "SEO Product",
                handle: "seo-product",
                status: "ACTIVE",
                featuredImage: {
                  id: "gid://shopify/ProductImage/img-1",
                  url: "https://example.com/img1.jpg",
                  altText: "Old Alt",
                },
                images: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductImage/img-1",
                        url: "https://example.com/img1.jpg",
                        altText: "Old Alt",
                      },
                    },
                  ],
                },
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        capturedFileUpdate = body.variables.files;
        return createMockResponse({
          data: {
            fileUpdate: {
              files: [{ id: "gid://shopify/ProductImage/img-1", alt: "Optimized SEO Alt" }],
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("productCreateMedia(")) {
        capturedCreateMedia = body.variables.media;
        return createMockResponse({
          data: {
            productCreateMedia: {
              media: [],
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-seo-test",
        shopDomain: "seo.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-seo-test",
      operation: "products.update",
      mode: "apply",
      requestId: "req-seo-test-1",
      payload: {
        id: "gid://shopify/Product/seo-test-1",
        product: {
          title: "SEO Product",
          images: [
            {
              id: "gid://shopify/ProductImage/img-1",
              altText: "Optimized SEO Alt",
            },
          ],
        },
      },
    });

    assert.equal(res.success, true);
    assert.deepEqual(capturedFileUpdate, [
      { id: "gid://shopify/ProductImage/img-1", alt: "Optimized SEO Alt" },
    ]);
    assert.equal(capturedCreateMedia, null);
  });

  it("products.update with new image (url but no id) appends as new media directly via productUpdate mutation", async () => {
    let capturedFileUpdate: unknown = null;
    let capturedCreateMedia: unknown = null;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        capturedCreateMedia = body.variables.media;
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/new-img-test",
                title: "Product With New Image",
                handle: "prod-new-img",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        capturedFileUpdate = body.variables.files;
        return createMockResponse({ data: { fileUpdate: { files: [], userErrors: [] } } });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-new-img",
        shopDomain: "new-img.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-new-img",
      operation: "products.update",
      mode: "apply",
      requestId: "req-new-img-1",
      payload: {
        id: "gid://shopify/Product/new-img-test",
        product: {
          images: [
            {
              url: "https://example.com/new-photo.jpg",
              altText: "New Image Alt",
            },
          ],
        },
      },
    });

    assert.equal(res.success, true);
    assert.equal(capturedFileUpdate, null);
    assert.deepEqual(capturedCreateMedia, [
      {
        originalSource: "https://example.com/new-photo.jpg",
        mediaContentType: "IMAGE",
        alt: "New Image Alt",
      },
    ]);
  });

  it("products.update throws SHOPIFY_PARTIAL_WRITE with reconciliationRequired: true if fileUpdate fails after product update", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/fail-file-update",
                title: "Updated Title",
                handle: "fail-file-update",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        return createMockResponse({
          data: {
            fileUpdate: {
              files: null,
              userErrors: [{ field: ["files", "0"], message: "File not found" }],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const idempotencyStore = new InMemoryIdempotencyStore();
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-partial-update",
        shopDomain: "partial.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({
      storeRegistry: registry,
      graphqlClient: client,
      idempotencyStore,
    });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-partial-update",
          operation: "products.update",
          mode: "apply",
          requestId: "req-update-partial-file-1",
          payload: {
            id: "gid://shopify/Product/fail-file-update",
            product: {
              title: "Updated Title",
              images: [{ id: "gid://shopify/ProductImage/nonexistent", altText: "New Alt" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.reconciliationRequired, true);
        assert.equal(err.details?.updatedProductId, "gid://shopify/Product/fail-file-update");
        return true;
      },
    );

    // Retrying with the same requestId must ALSO return SHOPIFY_PARTIAL_WRITE
    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-partial-update",
          operation: "products.update",
          mode: "apply",
          requestId: "req-update-partial-file-1",
          payload: {
            id: "gid://shopify/Product/fail-file-update",
            product: {
              title: "Updated Title",
              images: [{ id: "gid://shopify/ProductImage/nonexistent", altText: "New Alt" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );
  });

  it("products.update throws SHOPIFY_PARTIAL_WRITE with reconciliationRequired: true if fileUpdate fails after product update", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/fail-file-update",
                title: "Updated Title",
                handle: "fail-file-update",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        return createMockResponse({
          data: {
            fileUpdate: {
              files: null,
              userErrors: [{ field: ["files", "0"], message: "File alt update failed" }],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-partial-file",
        shopDomain: "partial-file.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-partial-file",
          operation: "products.update",
          mode: "apply",
          requestId: "req-partial-file-1",
          payload: {
            id: "gid://shopify/Product/fail-file-update",
            product: {
              title: "Updated Title",
              images: [{ id: "gid://shopify/ProductImage/img-bad", altText: "Bad Img Alt" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.reconciliationRequired, true);
        assert.equal(err.details?.updatedProductId, "gid://shopify/Product/fail-file-update");
        return true;
      },
    );
  });

  it("products.update with media error in single productUpdate mutation throws SHOPIFY_USER_ERROR without partial write", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: null,
              userErrors: [{ field: ["media", "0"], message: "Media URL inaccessible" }],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-atomic-media",
        shopDomain: "atomic-media.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-atomic-media",
          operation: "products.update",
          mode: "apply",
          requestId: "req-atomic-media-1",
          payload: {
            id: "gid://shopify/Product/fail-media-atomic",
            product: {
              title: "Updated Title",
              images: [{ url: "https://example.com/bad.jpg", altText: "Bad Img" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_USER_ERROR");
        assert.equal(err.reconciliationRequired, false);
        return true;
      },
    );
  });

  it("startGatewayServer refuses to start on 0.0.0.0 or external host without GATEWAY_AUTH_TOKEN", async () => {
    const { startGatewayServer } = await import("../server");
    const origEnv = process.env.GATEWAY_AUTH_TOKEN;
    process.env.GATEWAY_AUTH_TOKEN = "";
    try {
      assert.throws(
        () => {
          startGatewayServer({ host: "0.0.0.0", port: 3190, authToken: "" });
        },
        (err: unknown) => {
          assert.ok(err instanceof Error);
          assert.match(err.message, /unauthenticated public exposure is prohibited/i);
          return true;
        },
      );
    } finally {
      if (origEnv !== undefined) {
        process.env.GATEWAY_AUTH_TOKEN = origEnv;
      } else {
        delete process.env.GATEWAY_AUTH_TOKEN;
      }
    }
  });

  it("startGatewayServer allows binding to 0.0.0.0 when authToken is provided", async () => {
    const { startGatewayServer } = await import("../server");
    const server = startGatewayServer({ host: "0.0.0.0", port: 3191, authToken: "safe-token" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const addr = server.address() as import("node:net").AddressInfo;
    assert.ok(addr);
    assert.equal(addr.port, 3191);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("createStoreTransport caches ProxyAgent instances across calls for same proxy URL", async () => {
    const { proxyAgentPool, clearProxyAgentPool } = await import("../proxy-transport");
    clearProxyAgentPool();

    const store1: StoreConfig = {
      storeId: "store-proxy-cache-1",
      shopDomain: "proxy-cache-1.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: { url: "http://proxy.pool.internal:8080", failClosed: true },
    };
    const store2: StoreConfig = {
      storeId: "store-proxy-cache-2",
      shopDomain: "proxy-cache-2.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: { url: "http://proxy.pool.internal:8080", failClosed: true },
    };

    createStoreTransport(store1);
    const agent1 = proxyAgentPool.get("http://proxy.pool.internal:8080/");
    assert.ok(agent1);

    createStoreTransport(store2);
    const agent2 = proxyAgentPool.get("http://proxy.pool.internal:8080/");
    assert.equal(agent1, agent2, "ProxyAgent must be reused from connection pool");
  });

  it("createStoreTransport rejects unsupported proxy protocols with SHOPIFY_NETWORK_ERROR", () => {
    const store: StoreConfig = {
      storeId: "store-socks",
      shopDomain: "socks.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: { url: "socks5://10.0.0.1:1080" },
    };

    assert.throws(
      () => createStoreTransport(store),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
        assert.equal(err.httpStatus, 502);
        assert.match(err.message, /only 'http:' and 'https:' are supported/i);
        return true;
      },
    );
  });

  it("createStoreTransport rejects malformed proxy URLs with SHOPIFY_NETWORK_ERROR", () => {
    const store: StoreConfig = {
      storeId: "store-bad-url",
      shopDomain: "bad-url.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: { url: "::not-a-valid-url::" },
    };

    assert.throws(
      () => createStoreTransport(store),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_NETWORK_ERROR");
        assert.equal(err.httpStatus, 502);
        assert.match(err.message, /invalid URL format/i);
        return true;
      },
    );
  });

  it("ShopifyGraphqlClient immediately throws SHOPIFY_THROTTLED when wait exceeds 30000ms", async () => {
    const throttle = new InMemoryThrottleManager();
    const tokenProvider = new StaticAccessTokenProvider();
    const transport: HttpTransport = async () => {
      return createMockResponse({
        errors: [{ message: "Throttled", extensions: { code: "THROTTLED" } }],
        extensions: {
          cost: {
            requestedQueryCost: 5000,
            actualQueryCost: 50,
            throttleStatus: {
              maximumAvailable: 1000,
              currentlyAvailable: 0,
              restoreRate: 50, // 5000 / 50 = 100 seconds
            },
          },
        },
      });
    };

    const client = new ShopifyGraphqlClient({
      tokenProvider,
      throttleManager: throttle,
      baseTransport: transport,
    });

    const store: StoreConfig = {
      storeId: "store-heavy-throttle",
      shopDomain: "heavy.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    };

    const startTime = Date.now();
    await assert.rejects(
      async () => client.query(store, "{ shop { name } }"),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_THROTTLED");
        assert.equal(err.retryAfterSeconds, 100);
        return true;
      },
    );
    const elapsed = Date.now() - startTime;
    assert.ok(elapsed < 2000, `Expected immediate return without long sleep, elapsed: ${elapsed}ms`);
  });

  it("products.list query does not request variants selection while products.get does", async () => {
    let capturedListQuery = "";
    let capturedGetQuery = "";

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("ProductsList(")) {
        capturedListQuery = body.query;
        return createMockResponse({
          data: {
            products: {
              pageInfo: { hasNextPage: false, hasPreviousPage: false },
              edges: [],
            },
          },
        });
      }
      if (body.query.includes("ProductsGet(")) {
        capturedGetQuery = body.query;
        return createMockResponse({
          data: {
            product: {
              id: "gid://shopify/Product/1",
              title: "P1",
              handle: "p1",
              status: "ACTIVE",
              variants: {
                edges: [{ node: { id: "gid://shopify/ProductVariant/v1", title: "V1", price: "10.00" } }],
              },
              createdAt: "2026-09-01",
              updatedAt: "2026-09-20",
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-query-check",
        shopDomain: "query.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await dispatcher.dispatch({ storeId: "store-query-check", operation: "products.list", payload: {} });
    assert.ok(!capturedListQuery.includes("variants("), "products.list query must not contain variants");
    assert.ok(capturedListQuery.includes("descriptionHtml"), "products.list query must include descriptionHtml");

    await dispatcher.dispatch({ storeId: "store-query-check", operation: "products.get", payload: { id: "gid://shopify/Product/1" } });
    assert.ok(capturedGetQuery.includes("variants("), "products.get query must retain variants");
  });

  it("products.update with numeric image id and null altText handles ID correctly and clears alt", async () => {
    let capturedFiles: unknown = null;
    let createdMedia: unknown = null;

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/100",
                title: "Updated",
                handle: "updated",
                status: "ACTIVE",
                featuredImage: {
                  id: "gid://shopify/ProductImage/9999",
                  url: "https://example.com/feat.jpg",
                  altText: "Old Alt",
                },
                images: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductImage/9999",
                        url: "https://example.com/feat.jpg",
                        altText: "Old Alt",
                      },
                    },
                  ],
                },
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        capturedFiles = body.variables.files;
        return createMockResponse({
          data: {
            fileUpdate: {
              files: [{ id: "9999", alt: "" }],
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("productCreateMedia(")) {
        createdMedia = body.variables.media;
        return createMockResponse({ data: { productCreateMedia: { media: [], userErrors: [] } } });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-num-id",
        shopDomain: "num-id.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-num-id",
      operation: "products.update",
      mode: "apply",
      requestId: "req-num-id",
      payload: {
        id: "gid://shopify/Product/100",
        product: {
          images: [
            {
              id: 9999 as unknown as string,
              url: "https://example.com/feat.jpg",
              altText: null as unknown as string,
            },
          ],
        },
      },
    });

    assert.equal(res.success, true);
    assert.deepEqual(capturedFiles, [{ id: "9999", alt: "" }]);
    assert.equal(createdMedia, null);
    const prod = (res as { data: { product: ProductSummary } }).data.product;
    assert.equal(prod.featuredImage?.altText, "");
    assert.equal(prod.images?.[0]?.altText, "");
  });

  it("products.update throws SHOPIFY_PARTIAL_WRITE if fileUpdate or productCreateMedia returns null payload", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/null-payload",
                title: "Title",
                handle: "handle",
                status: "ACTIVE",
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      if (body.query.includes("fileUpdate(")) {
        // Return null fileUpdate payload without userErrors
        return createMockResponse({
          data: { fileUpdate: null },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-null-payload",
        shopDomain: "null.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-null-payload",
          operation: "products.update",
          mode: "apply",
          requestId: "req-null-payload",
          payload: {
            id: "gid://shopify/Product/null-payload",
            product: {
              images: [{ id: "gid://shopify/MediaImage/1", altText: "New Alt" }],
            },
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.reconciliationRequired, true);
        return true;
      },
    );
  });

  it("products.update in preview mode preserves existing image altText updates and string images", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-preview-check",
        shopDomain: "preview.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-preview-check",
      operation: "products.update",
      mode: "preview",
      payload: {
        id: "gid://shopify/Product/preview-1",
        product: {
          featuredImage: { id: "gid://shopify/MediaImage/feat", altText: "Featured Alt" },
          images: [
            { id: "gid://shopify/MediaImage/1", altText: "Alt 1" },
            "https://example.com/string-img.jpg",
          ],
        },
      },
    });

    assert.equal(res.success, true);
    const prod = (res as { data: { product: ProductSummary } }).data.product;
    assert.ok(prod.featuredImage);
    assert.equal(prod.featuredImage?.id, "gid://shopify/MediaImage/feat");
    assert.equal(prod.featuredImage?.altText, "Featured Alt");
    assert.equal(prod.images?.length, 2);
    assert.equal(prod.images?.[0]?.id, "gid://shopify/MediaImage/1");
    assert.equal(prod.images?.[0]?.altText, "Alt 1");
    assert.equal(prod.images?.[1]?.url, "https://example.com/string-img.jpg");
  });

  it("startGatewayServer allows binding to ::1 without GATEWAY_AUTH_TOKEN", async () => {
    const { startGatewayServer } = await import("../server");
    const server = startGatewayServer({ host: "::1", port: 3192 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const addr = server.address() as import("node:net").AddressInfo;
    assert.ok(addr);
    assert.equal(addr.port, 3192);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("createStoreTransport supports proxy with username only and preserves AbortError", async () => {
    const store: StoreConfig = {
      storeId: "store-proxy-user",
      shopDomain: "proxy-user.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: { url: "http://proxy.internal:8080", username: "token_user", failClosed: true },
    };

    let capturedInit: RequestInit | undefined;
    const mockFetch: HttpTransport = async (_url, init) => {
      capturedInit = init;
      throw new DOMException("The operation was aborted.", "AbortError");
    };

    const transport = createStoreTransport(store, mockFetch);
    const abortController = new AbortController();
    abortController.abort();

    await assert.rejects(
      async () => transport("https://proxy-user.myshopify.com/api", { signal: abortController.signal }),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.equal(err.name, "AbortError");
        return true;
      },
    );

    assert.ok((capturedInit as Record<string, unknown> | undefined)?.dispatcher);
  });

  it("variants.bulkUpdate groups variants by parent productId into a single mutation per product", async () => {
    const capturedMutations: { productId: string; variants: unknown[]; requestId?: string }[] = [];

    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productVariantsBulkUpdate(")) {
        capturedMutations.push({
          productId: String(body.variables.productId),
          variants: body.variables.variants as unknown[],
        });
        const variantsInput = body.variables.variants as { id: string }[];
        return createMockResponse({
          data: {
            productVariantsBulkUpdate: {
              productVariants: variantsInput.map((v) => ({
                id: v.id,
                title: "Updated",
                price: "25.00",
                inventoryQuantity: 10,
                product: { id: body.variables.productId },
              })),
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-bulk-group",
        shopDomain: "bulk-group.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const bulkRes = await dispatcher.dispatch({
      storeId: "store-bulk-group",
      operation: "variants.bulkUpdate",
      mode: "apply",
      requestId: "req-bulk-grouped",
      payload: {
        variants: [
          {
            id: "gid://shopify/ProductVariant/v-1",
            productId: "gid://shopify/Product/prod-A",
            variant: { price: "20.00" },
          },
          {
            id: "gid://shopify/ProductVariant/v-2",
            productId: "gid://shopify/Product/prod-A",
            variant: { price: "22.00" },
          },
          {
            id: "gid://shopify/ProductVariant/v-3",
            productId: "gid://shopify/Product/prod-B",
            variant: { price: "30.00" },
          },
          {
            id: "gid://shopify/ProductVariant/v-4",
            productId: "gid://shopify/Product/prod-B",
            variant: { price: "35.00" },
          },
          {
            id: "gid://shopify/ProductVariant/v-5",
            productId: "gid://shopify/Product/prod-A",
            variant: { price: "24.00" },
          },
        ],
      },
    });

    assert.equal(bulkRes.success, true);
    // Exactly 2 mutations for 2 distinct products instead of 5 individual mutations
    assert.equal(capturedMutations.length, 2);
    assert.equal(capturedMutations[0].productId, "gid://shopify/Product/prod-A");
    assert.equal(capturedMutations[0].variants.length, 3);
    assert.equal(capturedMutations[1].productId, "gid://shopify/Product/prod-B");
    assert.equal(capturedMutations[1].variants.length, 2);

    const data = bulkRes.data as { updatedVariantIds: string[]; count: number };
    assert.equal(data.count, 5);
    assert.deepEqual(data.updatedVariantIds, [
      "gid://shopify/ProductVariant/v-1",
      "gid://shopify/ProductVariant/v-2",
      "gid://shopify/ProductVariant/v-5",
      "gid://shopify/ProductVariant/v-3",
      "gid://shopify/ProductVariant/v-4",
    ]);
  });

  it("products.get populates hasMoreVariants and hasMoreImages from pageInfo.hasNextPage", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("ProductsGet(")) {
        return createMockResponse({
          data: {
            product: {
              id: "gid://shopify/Product/large-prod",
              title: "Large Product",
              handle: "large-product",
              status: "ACTIVE",
              images: {
                pageInfo: { hasNextPage: true },
                edges: [{ node: { id: "gid://shopify/ProductImage/1", url: "https://example.com/1.jpg" } }],
              },
              variants: {
                pageInfo: { hasNextPage: true },
                edges: [{ node: { id: "gid://shopify/ProductVariant/1", title: "V1", price: "10.00" } }],
              },
              createdAt: "2026-09-01",
              updatedAt: "2026-09-20",
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-pagination-check",
        shopDomain: "pag.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-pagination-check",
      operation: "products.get",
      mode: "apply",
      payload: { id: "gid://shopify/Product/large-prod" },
    });

    assert.equal(res.success, true);
    const prod = (res as { data: { product: ProductSummary } }).data.product;
    assert.equal(prod.hasMoreVariants, true);
    assert.equal(prod.hasMoreImages, true);
  });

  it("variants.bulkUpdate across multiple products throws SHOPIFY_PARTIAL_WRITE with reconciliationRequired: true if a subsequent product fails", async () => {
    let callCount = 0;
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productVariantsBulkUpdate(")) {
        callCount++;
        const prodId = body.variables.productId as string;
        if (prodId === "gid://shopify/Product/prod-A") {
          return createMockResponse({
            data: {
              productVariantsBulkUpdate: {
                productVariants: [{ id: "gid://shopify/ProductVariant/v-1", title: "V1", price: "20.00", product: { id: prodId } }],
                userErrors: [],
              },
            },
          });
        }
        if (prodId === "gid://shopify/Product/prod-B") {
          return createMockResponse({
            data: {
              productVariantsBulkUpdate: {
                productVariants: null,
                userErrors: [{ field: ["variants", "0", "price"], message: "Invalid price" }],
              },
            },
          });
        }
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-bulk-partial",
        shopDomain: "bulk-partial.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-bulk-partial",
          operation: "variants.bulkUpdate",
          mode: "apply",
          requestId: "req-bulk-partial",
          payload: {
            variants: [
              {
                id: "gid://shopify/ProductVariant/v-1",
                productId: "gid://shopify/Product/prod-A",
                variant: { price: "20.00" },
              },
              {
                id: "gid://shopify/ProductVariant/v-2",
                productId: "gid://shopify/Product/prod-B",
                variant: { price: "invalid" },
              },
            ],
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(err.httpStatus, 409);
        assert.equal(err.reconciliationRequired, true);
        assert.deepEqual(err.details?.updatedVariantIds, ["gid://shopify/ProductVariant/v-1"]);
        assert.equal(err.details?.failedProductId, "gid://shopify/Product/prod-B");
        return true;
      },
    );
    assert.equal(callCount, 2);
  });

  it("variants.bulkUpdate throws SHOPIFY_USER_ERROR if productVariantsBulkUpdate returns null payload", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("productVariantsBulkUpdate(")) {
        return createMockResponse({
          data: {
            productVariantsBulkUpdate: null,
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-null-variants",
        shopDomain: "null-variants.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      async () =>
        dispatcher.dispatch({
          storeId: "store-null-variants",
          operation: "variants.bulkUpdate",
          mode: "apply",
          requestId: "req-null-variants",
          payload: {
            variants: [
              {
                id: "gid://shopify/ProductVariant/v-1",
                productId: "gid://shopify/Product/prod-1",
                variant: { price: "20.00" },
              },
            ],
          },
        }),
      (err: unknown) => {
        assert.ok(err instanceof GatewayError);
        assert.equal(err.code, "SHOPIFY_USER_ERROR");
        assert.match(err.message, /productVariantsBulkUpdate returned no data/i);
        return true;
      },
    );
  });

  it("products.update does not produce duplicate images when productUpdate mutation returns created images", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({
          data: {
            productUpdate: {
              product: {
                id: "gid://shopify/Product/no-dup-img",
                title: "Product No Duplicate Images",
                handle: "prod-no-dup-img",
                status: "ACTIVE",
                featuredImage: {
                  id: "gid://shopify/ProductImage/img-new",
                  url: "https://cdn.shopify.com/s/files/img-new.jpg",
                  altText: "New Image Alt",
                },
                images: {
                  edges: [
                    {
                      node: {
                        id: "gid://shopify/ProductImage/img-new",
                        url: "https://cdn.shopify.com/s/files/img-new.jpg",
                        altText: "New Image Alt",
                      },
                    },
                  ],
                },
                variants: { edges: [] },
                createdAt: "2026-09-01",
                updatedAt: "2026-09-20",
              },
              userErrors: [],
            },
          },
        });
      }
      return createMockResponse({});
    };

    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-no-dup",
        shopDomain: "no-dup.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-no-dup",
      operation: "products.update",
      mode: "apply",
      requestId: "req-no-dup-1",
      payload: {
        id: "gid://shopify/Product/no-dup-img",
        product: {
          images: [{ url: "https://example.com/external-new.jpg", altText: "New Image Alt" }],
        },
      },
    });

    assert.equal(res.success, true);
    const prod = (res as { data: { product: ProductSummary } }).data.product;
    assert.equal(prod.images?.length, 1);
    assert.equal(prod.images?.[0]?.id, "gid://shopify/ProductImage/img-new");
    assert.equal(prod.images?.[0]?.url, "https://cdn.shopify.com/s/files/img-new.jpg");
  });

  it("products.update in preview mode maps null altText to empty string and sets hasMoreVariants/hasMoreImages to false", async () => {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-preview-null-alt",
        shopDomain: "preview-null-alt.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "tok" },
      },
    ]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const res = await dispatcher.dispatch({
      storeId: "store-preview-null-alt",
      operation: "products.update",
      mode: "preview",
      payload: {
        id: "gid://shopify/Product/prev-null-alt",
        product: {
          title: "Preview Product",
          featuredImage: {
            id: "gid://shopify/ProductImage/f1",
            url: "https://example.com/f1.jpg",
            altText: null as unknown as string,
          },
          images: [
            {
              id: "gid://shopify/ProductImage/i1",
              url: "https://example.com/i1.jpg",
              altText: null as unknown as string,
            },
          ],
        },
      },
    });

    assert.equal(res.success, true);
    const prod = (res as { data: { product: ProductSummary } }).data.product;
    assert.equal(prod.featuredImage?.altText, "");
    assert.equal(prod.images?.[0]?.altText, "");
    assert.equal(prod.hasMoreVariants, false);
    assert.equal(prod.hasMoreImages, false);
  });

  it("uses the undici-compatible transport with ProxyAgent instead of Node global fetch", async () => {
    const store: StoreConfig = {
      storeId: "proxy-compatible-fetch",
      shopDomain: "proxy-compatible-fetch.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
      proxy: {
        url: "http://proxy.internal:8080",
        username: "proxyuser",
        password: "proxypassword",
        failClosed: true,
      },
    };
    let proxyTransportCalled = false;
    let capturedInit: RequestInit | undefined;
    const proxyTransport: HttpTransport = async (_url, init) => {
      proxyTransportCalled = true;
      capturedInit = init;
      return createMockResponse({ ok: true });
    };

    const transport = createStoreTransport(store, globalThis.fetch, proxyTransport);
    await transport("https://example.com/graphql");

    assert.equal(proxyTransportCalled, true);
    assert.ok((capturedInit as Record<string, unknown> | undefined)?.dispatcher);
  });

  it("products.update synchronizes managed variants without changing manual variants", async () => {
    let capturedVariants: unknown;
    let deletedVariantIds: unknown;
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string; variables: Record<string, unknown> };
      if (body.query.includes("PipelineProductState")) {
        return createMockResponse({ data: { node: {
          media: { nodes: [] },
          variants: { nodes: [
            { id: "gid://shopify/ProductVariant/manual" },
            { id: "gid://shopify/ProductVariant/old-1" },
            { id: "gid://shopify/ProductVariant/old-2" },
          ] },
        } } });
      }
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({ data: { productUpdate: {
          product: {
            id: "gid://shopify/Product/sync-variants",
            title: "Synced product",
            handle: "synced-product",
            status: "ACTIVE",
            variants: { edges: [] },
            createdAt: "2026-09-01",
            updatedAt: "2026-09-22",
          },
          userErrors: [],
        } } });
      }
      if (body.query.includes("ProductVariantsBulkUpdateForSync")) {
        capturedVariants = body.variables.variants;
        return createMockResponse({ data: { productVariantsBulkUpdate: {
          productVariants: [
            {
              id: "gid://shopify/ProductVariant/old-1", title: "Twin", price: "29.95",
              inventoryItem: { sku: "TWIN" },
            },
          ],
          userErrors: [],
        } } });
      }
      if (body.query.includes("ProductVariantsBulkDeleteForSync")) {
        deletedVariantIds = body.variables.variantsIds;
        return createMockResponse({ data: { productVariantsBulkDelete: {
          product: { id: "gid://shopify/Product/sync-variants" },
          userErrors: [],
        } } });
      }
      return createMockResponse({});
    };
    const registry = new InMemoryStoreRegistry([{
      storeId: "store-sync-variants",
      shopDomain: "sync-variants.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    }]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    const response = await dispatcher.dispatch({
      storeId: "store-sync-variants",
      operation: "products.update",
      mode: "apply",
      requestId: "req-sync-variants",
      payload: {
        id: "gid://shopify/Product/sync-variants",
        product: {
          variantIdsToManage: [
            "gid://shopify/ProductVariant/old-1",
            "gid://shopify/ProductVariant/old-2",
          ],
          variants: [
            { price: "29.95", sku: "TWIN", optionValues: [{ optionName: "Size", name: "Twin" }] },
          ],
        },
      },
    });

    assert.equal(response.success, true);
    assert.deepEqual(capturedVariants, [
      {
        id: "gid://shopify/ProductVariant/old-1",
        price: "29.95",
        inventoryItem: { sku: "TWIN", tracked: false },
        inventoryPolicy: "CONTINUE",
        optionValues: [{ optionName: "Size", name: "Twin" }],
      },
    ]);
    assert.deepEqual(deletedVariantIds, ["gid://shopify/ProductVariant/old-2"]);
    const product = (response as { data: { product: ProductSummary } }).data.product;
    assert.equal(product.variants.length, 1);
    assert.equal(product.variants[0]?.sku, "TWIN");
  });

  it("products.update reports reconciliation when managed variant synchronization fails after product update", async () => {
    const fakeTransport: HttpTransport = async (_url, options) => {
      const body = JSON.parse(options?.body as string) as { query: string };
      if (body.query.includes("PipelineProductState")) {
        return createMockResponse({ data: { node: {
          media: { nodes: [] },
          variants: { nodes: [{ id: "gid://shopify/ProductVariant/old-1" }] },
        } } });
      }
      if (body.query.includes("productUpdate(")) {
        return createMockResponse({ data: { productUpdate: {
          product: {
            id: "gid://shopify/Product/partial-variants",
            title: "Partial variants",
            handle: "partial-variants",
            status: "ACTIVE",
            variants: { edges: [] },
            createdAt: "2026-09-01",
            updatedAt: "2026-09-22",
          },
          userErrors: [],
        } } });
      }
      if (body.query.includes("ProductVariantsBulkUpdateForSync")) {
        return createMockResponse({ data: { productVariantsBulkUpdate: {
          productVariants: null,
          userErrors: [{ field: ["variants", "0"], message: "Invalid option value" }],
        } } });
      }
      return createMockResponse({});
    };
    const registry = new InMemoryStoreRegistry([{
      storeId: "store-partial-variants",
      shopDomain: "partial-variants.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "tok" },
    }]);
    const client = new ShopifyGraphqlClient({
      tokenProvider: new StaticAccessTokenProvider(),
      throttleManager: new InMemoryThrottleManager(),
      baseTransport: fakeTransport,
    });
    const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: client });

    await assert.rejects(
      () => dispatcher.dispatch({
        storeId: "store-partial-variants",
        operation: "products.update",
        mode: "apply",
        requestId: "req-partial-variants",
        payload: {
          id: "gid://shopify/Product/partial-variants",
          product: { variants: [{ price: "29.95", optionValues: [{ optionName: "Size", name: "Twin" }] }] },
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof GatewayError);
        assert.equal(error.code, "SHOPIFY_PARTIAL_WRITE");
        assert.equal(error.reconciliationRequired, true);
        assert.equal(error.details?.updatedProductId, "gid://shopify/Product/partial-variants");
        return true;
      },
    );
  });

  describe("Gateway: variants.bulkCreate, files.create, and metafields.set", () => {
    function setupTestGateway(mockGraphqlDataOrTransport: unknown) {
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

    it("executes variants.bulkCreate in preview mode without calling Shopify", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "variants.bulkCreate",
        mode: "preview",
        payload: {
          productId: "gid://shopify/Product/123",
          variants: [
            {
              price: "29.99",
              optionValues: [{ optionName: "Size", name: "Medium" }],
            },
          ],
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as { createdCount: number; variants: readonly { title: string; price: string }[] };
      assert.equal(data.createdCount, 1);
      assert.equal(data.variants[0]?.title, "Medium");
      assert.equal(data.variants[0]?.price, "29.99");
    });

    it("executes variants.bulkCreate in apply mode with productVariantsBulkCreate", async () => {
      let requestPayload: unknown;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/v-created-1",
                  title: "Medium",
                  price: "29.99",
                  compareAtPrice: "39.99",
                  barcode: "123456",
                  inventoryItem: { sku: "SKU-MED" },
                },
              ],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "variants.bulkCreate",
        mode: "apply",
        requestId: "req-bulk-create-1",
        payload: {
          productId: "gid://shopify/Product/123",
          variants: [
            {
              price: "29.99",
              compareAtPrice: "39.99",
              sku: "SKU-MED",
              barcode: "123456",
              optionValues: [{ optionName: "Size", name: "Medium" }],
            },
          ],
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { createdCount: number; variants: readonly { id: string; sku?: string }[] };
      assert.equal(data.createdCount, 1);
      assert.equal(data.variants[0]?.id, "gid://shopify/ProductVariant/v-created-1");
      assert.equal(data.variants[0]?.sku, "SKU-MED");
      assert.ok(requestPayload);
    });

    it("executes files.create in preview mode without calling Shopify", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.create",
        mode: "preview",
        payload: {
          originalSource: "https://example.com/asset.jpg",
          filename: "custom-preview.jpg",
          alt: "Custom Preview",
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as { fileId: string; shopifyCdnUrl: string; fileStatus: string; alt?: string };
      assert.equal(data.fileStatus, "READY");
      assert.ok(data.shopifyCdnUrl.includes("custom-preview.jpg"));
      assert.equal(data.alt, "Custom Preview");
    });

    it("executes files.create in apply mode with polling until READY", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        callCount += 1;
        const body = JSON.parse(init?.body as string) as Record<string, string>;
        if (callCount === 1) {
          assert.ok(body.query.includes("fileCreate"));
          return createMockResponse({
            data: {
              fileCreate: {
                files: [
                  {
                    id: "gid://shopify/MediaImage/file-1",
                    fileStatus: "PROCESSING",
                    alt: "Alt 1",
                  },
                ],
                userErrors: [],
              },
            },
          });
        }
        assert.ok(body.query.includes("GetFileNode"));
        return createMockResponse({
          data: {
            node: {
              id: "gid://shopify/MediaImage/file-1",
              fileStatus: "READY",
              alt: "Alt 1",
              image: {
                url: "https://cdn.shopify.com/s/files/1/0000/0000/files/file-1.jpg",
              },
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.create",
        mode: "apply",
        requestId: "req-file-create-1",
        payload: {
          originalSource: "https://example.com/asset.jpg",
          filename: "file-1.jpg",
          alt: "Alt 1",
          pollIntervalMs: 1,
          maxPollAttempts: 3,
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { fileId: string; shopifyCdnUrl: string; fileStatus: string };
      assert.equal(data.fileId, "gid://shopify/MediaImage/file-1");
      assert.equal(data.fileStatus, "READY");
      assert.equal(data.shopifyCdnUrl, "https://cdn.shopify.com/s/files/1/0000/0000/files/file-1.jpg");
      assert.equal(callCount, 2);
    });

    it("executes files.bulkCreate in preview mode without calling Shopify", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.bulkCreate",
        mode: "preview",
        payload: {
          files: [
            {
              originalSource: "https://example.com/asset-1.jpg",
              filename: "preview-1.jpg",
              alt: "Preview 1",
            },
            {
              originalSource: "https://example.com/asset-2.jpg",
              filename: "preview-2.jpg",
              alt: "Preview 2",
            },
          ],
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as {
        files: readonly { originalSource: string; shopifyCdnUrl: string; fileStatus: string; alt?: string }[];
        totalCount: number;
        successCount: number;
        failedCount: number;
      };
      assert.equal(data.totalCount, 2);
      assert.equal(data.successCount, 2);
      assert.equal(data.failedCount, 0);
      assert.equal(data.files[0].fileStatus, "READY");
      assert.ok(data.files[0].shopifyCdnUrl.includes("preview-1.jpg"));
      assert.equal(data.files[1].originalSource, "https://example.com/asset-2.jpg");
    });

    it("executes files.bulkCreate in apply mode with batch polling until READY", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        callCount += 1;
        const body = JSON.parse(init?.body as string) as Record<string, string>;
        if (callCount === 1) {
          assert.ok(body.query.includes("fileCreate"));
          return createMockResponse({
            data: {
              fileCreate: {
                files: [
                  {
                    id: "gid://shopify/MediaImage/file-b1",
                    fileStatus: "PROCESSING",
                    alt: "Alt B1",
                  },
                  {
                    id: "gid://shopify/MediaImage/file-b2",
                    fileStatus: "READY",
                    alt: "Alt B2",
                    image: {
                      url: "https://cdn.shopify.com/s/files/1/0000/0000/files/file-b2.jpg",
                    },
                  },
                ],
                userErrors: [],
              },
            },
          });
        }
        assert.ok(body.query.includes("GetFileNodes"));
        return createMockResponse({
          data: {
            nodes: [
              {
                id: "gid://shopify/MediaImage/file-b1",
                fileStatus: "READY",
                alt: "Alt B1",
                image: {
                  url: "https://cdn.shopify.com/s/files/1/0000/0000/files/file-b1.jpg",
                },
              },
            ],
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.bulkCreate",
        mode: "apply",
        requestId: "req-file-bulk-create-1",
        payload: {
          files: [
            {
              originalSource: "https://example.com/asset-b1.jpg",
              filename: "file-b1.jpg",
              alt: "Alt B1",
            },
            {
              originalSource: "https://example.com/asset-b2.jpg",
              filename: "file-b2.jpg",
              alt: "Alt B2",
            },
          ],
          pollIntervalMs: 1,
          maxPollAttempts: 3,
        },
      });

      assert.equal(res.success, true);
      const data = res.data as {
        files: readonly { originalSource: string; fileId: string; shopifyCdnUrl: string; fileStatus: string }[];
        totalCount: number;
        successCount: number;
        failedCount: number;
      };
      assert.equal(data.totalCount, 2);
      assert.equal(data.successCount, 2);
      assert.equal(data.failedCount, 0);
      assert.equal(data.files[0].fileId, "gid://shopify/MediaImage/file-b1");
      assert.equal(data.files[0].shopifyCdnUrl, "https://cdn.shopify.com/s/files/1/0000/0000/files/file-b1.jpg");
      assert.equal(data.files[1].shopifyCdnUrl, "https://cdn.shopify.com/s/files/1/0000/0000/files/file-b2.jpg");
      assert.equal(callCount, 2);
    });

    it("executes metafields.set in preview mode without calling Shopify", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "preview",
        payload: {
          ownerId: "gid://shopify/Product/123",
          namespace: "custom",
          key: "amazon_customizer",
          value: "{\"test\":true}",
          type: "json",
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as { success: boolean; metafieldId?: string; metafields: readonly { key: string }[] };
      assert.equal(data.success, true);
      assert.equal(data.metafields[0]?.key, "amazon_customizer");
    });

    it("executes metafields.set in apply mode with metafieldsSet mutation", async () => {
      let requestPayload: unknown;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            metafieldsSet: {
              metafields: [
                {
                  id: "gid://shopify/Metafield/mf-1",
                  namespace: "custom",
                  key: "amazon_customizer",
                  type: "json",
                  value: "{\"config\":1}",
                  ownerType: "PRODUCT",
                },
              ],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "apply",
        requestId: "req-meta-1",
        payload: {
          ownerId: "gid://shopify/Product/123",
          namespace: "custom",
          key: "amazon_customizer",
          value: "{\"config\":1}",
          type: "json",
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { success: boolean; metafieldId?: string };
      assert.equal(data.success, true);
      assert.equal(data.metafieldId, "gid://shopify/Metafield/mf-1");
      assert.ok(requestPayload);
    });

    it("executes metafields.set in apply mode with batch metafields array", async () => {
      let requestPayload: unknown;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            metafieldsSet: {
              metafields: [
                {
                  id: "gid://shopify/Metafield/mf-batch-1",
                  namespace: "custom",
                  key: "key1",
                  type: "json",
                  value: "{\"k\":1}",
                  ownerType: "PRODUCT",
                },
                {
                  id: "gid://shopify/Metafield/mf-batch-2",
                  namespace: "custom",
                  key: "key2",
                  type: "json",
                  value: "{\"k\":2}",
                  ownerType: "PRODUCT",
                },
              ],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "apply",
        requestId: "req-meta-batch",
        payload: {
          metafields: [
            {
              productId: "gid://shopify/Product/123",
              namespace: "custom",
              key: "key1",
              value: "{\"k\":1}",
            },
            {
              productId: "gid://shopify/Product/123",
              namespace: "custom",
              key: "key2",
              value: "{\"k\":2}",
            },
          ],
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { success: boolean; metafields: readonly { id: string; key: string }[] };
      assert.equal(data.success, true);
      assert.equal(data.metafields.length, 2);
      assert.equal(data.metafields[0]?.id, "gid://shopify/Metafield/mf-batch-1");
      assert.equal(data.metafields[1]?.id, "gid://shopify/Metafield/mf-batch-2");
      assert.ok(requestPayload);
    });

    it("executes products.create preserving gallery photos sent via media array", async () => {
      let requestPayload: { query: string; variables: { media?: unknown[]; product?: unknown } } | undefined;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/media-prod-1",
                title: "Media Product",
                handle: "media-product",
                tags: [],
                createdAt: "2026-09-22T00:00:00Z",
                updatedAt: "2026-09-22T00:00:00Z",
              },
              userErrors: [],
            },
          },
        });
      });

      // 1. Preview mode preserves media in images
      const previewRes = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.create",
        mode: "preview",
        payload: {
          product: {
            title: "Media Product",
            media: [
              { originalSource: "https://example.com/photo1.jpg", alt: "Photo 1" },
              { originalSource: "https://example.com/photo2.jpg", alt: "Photo 2" },
            ],
          },
        },
      });

      assert.equal(previewRes.success, true);
      const previewProd = (previewRes.data as { product: ProductSummary }).product;
      assert.equal(previewProd.images?.length, 2);
      assert.equal(previewProd.images?.[0]?.url, "https://example.com/photo1.jpg");
      assert.equal(previewProd.images?.[0]?.altText, "Photo 1");

      // 2. Apply mode sends media in mutation variables
      const applyRes = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.create",
        mode: "apply",
        requestId: "req-prod-media-1",
        payload: {
          product: {
            title: "Media Product",
            media: [
              { originalSource: "https://example.com/photo1.jpg", alt: "Photo 1", mediaContentType: "IMAGE" },
              { originalSource: "https://example.com/photo2.jpg", alt: "Photo 2", mediaContentType: "IMAGE" },
            ],
          },
        },
      });

      assert.equal(applyRes.success, true);
      assert.ok(requestPayload);
      assert.ok(Array.isArray(requestPayload.variables.media));
      assert.equal(requestPayload.variables.media.length, 2);
      assert.deepEqual(requestPayload.variables.media[0], {
        originalSource: "https://example.com/photo1.jpg",
        mediaContentType: "IMAGE",
        alt: "Photo 1",
      });
    });

    it("rejects variants.bulkCreate when productId is missing", async () => {
      const dispatcher = setupTestGateway({});
      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "variants.bulkCreate",
            mode: "apply",
            requestId: "req-err-1",
            payload: {
              productId: "",
              variants: [{ price: "10.00" }],
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_USER_ERROR");
          assert.ok(err.message.includes("Product id is required"));
          return true;
        },
      );
    });

    it("handles files.create failure when fileStatus is FAILED during polling", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async () => {
        callCount++;
        if (callCount === 1) {
          return createMockResponse({
            data: {
              fileCreate: {
                files: [{ id: "gid://shopify/MediaImage/fail-file-1", fileStatus: "PROCESSING" }],
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({
          data: {
            node: { id: "gid://shopify/MediaImage/fail-file-1", fileStatus: "FAILED" },
          },
        });
      });

      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "files.create",
            mode: "apply",
            requestId: "req-file-fail",
            payload: {
              originalSource: "https://example.com/broken.jpg",
              pollIntervalMs: 1,
              maxPollAttempts: 3,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_USER_ERROR");
          assert.ok(err.message.includes("File processing failed"));
          return true;
        },
      );
    });

    it("handles files.create timeout when polling expires without URL", async () => {
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as Record<string, string>;
        if (body.query.includes("fileCreate")) {
          return createMockResponse({
            data: {
              fileCreate: {
                files: [{ id: "gid://shopify/MediaImage/timeout-file-1", fileStatus: "PROCESSING" }],
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({
          data: {
            node: { id: "gid://shopify/MediaImage/timeout-file-1", fileStatus: "PROCESSING" },
          },
        });
      });

      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "files.create",
            mode: "apply",
            requestId: "req-file-timeout",
            payload: {
              originalSource: "https://example.com/slow.jpg",
              pollIntervalMs: 1,
              maxPollAttempts: 2,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_USER_ERROR");
          assert.ok(err.message.includes("timed out"));
          return true;
        },
      );
    });

    it("fails files.create immediately when fileCreate returns FAILED without polling", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async () => {
        callCount++;
        return createMockResponse({
          data: {
            fileCreate: {
              files: [{ id: "gid://shopify/MediaImage/fail-immediate", fileStatus: "FAILED" }],
              userErrors: [],
            },
          },
        });
      });

      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "files.create",
            mode: "apply",
            requestId: "req-file-fail-imm",
            payload: {
              originalSource: "https://example.com/bad.jpg",
              pollIntervalMs: 10,
              maxPollAttempts: 5,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_USER_ERROR");
          assert.ok(err.message.includes("File processing failed"));
          return true;
        },
      );
      assert.equal(callCount, 1);
    });

    it("handles files.create timeout when polling expires and status is still PROCESSING even if url exists", async () => {
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string) as Record<string, string>;
        if (body.query.includes("fileCreate")) {
          return createMockResponse({
            data: {
              fileCreate: {
                files: [{ id: "gid://shopify/MediaImage/timeout-file-2", fileStatus: "PROCESSING" }],
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({
          data: {
            node: {
              id: "gid://shopify/MediaImage/timeout-file-2",
              fileStatus: "PROCESSING",
              image: { url: "https://cdn.shopify.com/s/files/partial.jpg" },
            },
          },
        });
      });

      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "files.create",
            mode: "apply",
            requestId: "req-file-timeout-processing",
            payload: {
              originalSource: "https://example.com/slow-proc.jpg",
              pollIntervalMs: 1,
              maxPollAttempts: 2,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_USER_ERROR");
          assert.ok(err.message.includes("timed out"));
          return true;
        },
      );
    });

    it("executes variants.bulkCreate with empty variants array returning 0 without calling Shopify", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async () => {
        callCount++;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "variants.bulkCreate",
        mode: "apply",
        requestId: "req-bulk-empty",
        payload: {
          productId: "gid://shopify/Product/empty-vars",
          variants: [],
        },
      });

      assert.equal(callCount, 0);
      assert.equal(res.success, true);
      const data = res.data as { createdCount: number; variants: readonly unknown[] };
      assert.equal(data.createdCount, 0);
      assert.equal(data.variants.length, 0);
    });

    it("executes variants.bulkCreate defaulting optionValues to Title: Default Title when absent", async () => {
      let requestPayload: { query: string; variables: { variants?: Record<string, unknown>[] } } | undefined;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            productVariantsBulkCreate: {
              productVariants: [
                {
                  id: "gid://shopify/ProductVariant/v-def-1",
                  title: "Default Title",
                  price: "15.00",
                },
              ],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "variants.bulkCreate",
        mode: "apply",
        requestId: "req-bulk-def-title",
        payload: {
          productId: "gid://shopify/Product/p-def",
          variants: [{ price: "15.00" }],
        },
      });

      assert.equal(res.success, true);
      assert.ok(requestPayload);
      assert.deepEqual(requestPayload.variables.variants?.[0]?.optionValues, [
        { optionName: "Title", name: "Default Title" },
      ]);
    });

    it("executes metafields.set with top-level ownerId inheriting down to array items", async () => {
      let requestPayload: { query: string; variables: { metafields?: Record<string, unknown>[] } } | undefined;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            metafieldsSet: {
              metafields: [
                {
                  id: "gid://shopify/Metafield/mf-inherited-1",
                  namespace: "custom",
                  key: "key_inherited",
                  type: "json",
                  value: "{\"test\":1}",
                  ownerType: "PRODUCT",
                },
              ],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "apply",
        requestId: "req-meta-top-owner",
        payload: {
          ownerId: "gid://shopify/Product/top-owner-1",
          metafields: [
            {
              namespace: "custom",
              key: "key_inherited",
              value: { test: 1 },
            },
          ],
        },
      });

      assert.equal(res.success, true);
      assert.ok(requestPayload);
      assert.equal(requestPayload.variables.metafields?.[0]?.ownerId, "gid://shopify/Product/top-owner-1");
      assert.equal(requestPayload.variables.metafields?.[0]?.value, "{\"test\":1}");
    });

    it("executes files.delete in preview mode without calling Shopify", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.delete",
        mode: "preview",
        payload: {
          fileIds: ["gid://shopify/MediaImage/file-del-1", "gid://shopify/MediaImage/file-del-2"],
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as { success: boolean; deletedFileIds: readonly string[] };
      assert.equal(data.success, true);
      assert.deepEqual(data.deletedFileIds, [
        "gid://shopify/MediaImage/file-del-1",
        "gid://shopify/MediaImage/file-del-2",
      ]);
    });

    it("executes files.delete in apply mode calling fileDelete mutation", async () => {
      let requestPayload: { query: string; variables: { fileIds?: string[] } } | undefined;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        requestPayload = JSON.parse(init?.body as string);
        return createMockResponse({
          data: {
            fileDelete: {
              deletedFileIds: ["gid://shopify/MediaImage/file-del-1"],
              userErrors: [],
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.delete",
        mode: "apply",
        requestId: "req-file-del-1",
        payload: {
          fileIds: ["gid://shopify/MediaImage/file-del-1"],
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { success: boolean; deletedFileIds: readonly string[] };
      assert.deepEqual(data.deletedFileIds, ["gid://shopify/MediaImage/file-del-1"]);
      assert.ok(requestPayload?.query.includes("fileDelete"));
      assert.deepEqual(requestPayload?.variables.fileIds, ["gid://shopify/MediaImage/file-del-1"]);
    });

    it("executes metafields.get in preview mode", async () => {
      let called = false;
      const dispatcher = setupTestGateway(async () => {
        called = true;
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.get",
        mode: "preview",
        payload: {
          ownerId: "gid://shopify/Product/123",
          namespace: "custom",
          key: "amazon_customizer",
        },
      });

      assert.equal(called, false);
      assert.equal(res.success, true);
      const data = res.data as { id?: string; value: string | null };
      assert.equal(data.value, null);
    });

    it("executes metafields.get in apply mode returning parsed value", async () => {
      const dispatcher = setupTestGateway(async () => {
        return createMockResponse({
          data: {
            node: {
              id: "gid://shopify/Product/123",
              metafield: {
                id: "gid://shopify/Metafield/mf-read-1",
                namespace: "custom",
                key: "amazon_customizer",
                value: "{\"surfaces\":[]}",
                type: "json",
              },
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.get",
        mode: "apply",
        payload: {
          ownerId: "gid://shopify/Product/123",
          namespace: "custom",
          key: "amazon_customizer",
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { id?: string; value: string | null; namespace?: string; key?: string };
      assert.equal(data.id, "gid://shopify/Metafield/mf-read-1");
      assert.equal(data.value, "{\"surfaces\":[]}");
      assert.equal(data.namespace, "custom");
      assert.equal(data.key, "amazon_customizer");
    });
  });

  describe("Gateway Hardening: Polling, Security, MediaImage, Metafields, Category, StoreId", () => {
    function setupTestGateway(mockGraphqlDataOrTransport: unknown) {
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

    it("files.bulkCreate continues polling when file has temporary shopifyCdnUrl but status is PROCESSING", async () => {
      let callCount = 0;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        callCount++;
        const body = JSON.parse(init?.body as string);
        if (callCount === 1) {
          // Mutation response: returns file node with temporary cdn url but PROCESSING status
          return createMockResponse({
            data: {
              fileCreate: {
                files: [
                  {
                    id: "gid://shopify/MediaImage/temp-url-file",
                    fileStatus: "PROCESSING",
                    image: { url: "https://cdn.shopify.com/temp-processing.jpg" },
                  },
                ],
                userErrors: [],
              },
            },
          });
        }
        // Poll response: returns READY status and final cdn url
        assert.ok(body.query.includes("nodes(ids: $ids)"));
        return createMockResponse({
          data: {
            nodes: [
              {
                id: "gid://shopify/MediaImage/temp-url-file",
                fileStatus: "READY",
                image: { url: "https://cdn.shopify.com/final-ready.jpg" },
              },
            ],
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.bulkCreate",
        mode: "apply",
        requestId: "req-poll-temp-url",
        payload: {
          files: [{ originalSource: "https://example.com/asset.jpg" }],
          pollIntervalMs: 5,
          maxPollAttempts: 3,
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { files: readonly { fileStatus: string; shopifyCdnUrl?: string }[]; successCount: number };
      assert.equal(data.successCount, 1);
      assert.equal(data.files[0]?.fileStatus, "READY");
      assert.equal(data.files[0]?.shopifyCdnUrl, "https://cdn.shopify.com/final-ready.jpg");
      assert.ok(callCount >= 2, "Must have polled despite temporary shopifyCdnUrl");
    });

    it("files.bulkCreate times out when polling expires and status is still PROCESSING even with shopifyCdnUrl", async () => {
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query.includes("fileCreate(")) {
          return createMockResponse({
            data: {
              fileCreate: {
                files: [
                  {
                    id: "gid://shopify/MediaImage/stuck-file",
                    fileStatus: "PROCESSING",
                    image: { url: "https://cdn.shopify.com/stuck-temp.jpg" },
                  },
                ],
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({
          data: {
            nodes: [
              {
                id: "gid://shopify/MediaImage/stuck-file",
                fileStatus: "PROCESSING",
                image: { url: "https://cdn.shopify.com/stuck-temp.jpg" },
              },
            ],
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.bulkCreate",
        mode: "apply",
        requestId: "req-poll-timeout",
        payload: {
          files: [{ originalSource: "https://example.com/asset.jpg" }],
          pollIntervalMs: 5,
          maxPollAttempts: 2,
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { files: readonly { fileStatus: string }[]; failedCount: number };
      assert.equal(data.failedCount, 1);
      assert.equal(data.files[0]?.fileStatus, "TIMED_OUT");
    });

    it("Vite dev server plugin refuses startup on 0.0.0.0, true, or LAN host without GATEWAY_AUTH_TOKEN", () => {
      const origToken = process.env.GATEWAY_AUTH_TOKEN;
      process.env.GATEWAY_AUTH_TOKEN = "";
      const plugin = shopifyGatewayDevPlugin({ authToken: "" });

      const invokeConfigureServer = (p: unknown, serverMock: unknown) => {
        const plugin = p as { configureServer?: ((s: unknown) => void) | { handler?: (s: unknown) => void } };
        if (typeof plugin.configureServer === "function") {
          plugin.configureServer(serverMock);
        } else if (plugin.configureServer && typeof plugin.configureServer.handler === "function") {
          plugin.configureServer.handler(serverMock);
        }
      };

      try {
        // 1. host = "0.0.0.0"
        assert.throws(
          () => {
            invokeConfigureServer(plugin, {
              config: { server: { host: "0.0.0.0" } },
              middlewares: { use: () => {} },
            });
          },
          {
            message: /Refusing to start vite dev server on host '0\.0\.0\.0' without GATEWAY_AUTH_TOKEN/,
          },
        );

        // 2. host = true (Vite shorthand for 0.0.0.0)
        assert.throws(
          () => {
            invokeConfigureServer(plugin, {
              config: { server: { host: true } },
              middlewares: { use: () => {} },
            });
          },
          {
            message: /Refusing to start vite dev server on host '0\.0\.0\.0' without GATEWAY_AUTH_TOKEN/,
          },
        );

        // 3. host = LAN IP "192.168.1.50"
        assert.throws(
          () => {
            invokeConfigureServer(plugin, {
              config: { server: { host: "192.168.1.50" } },
              middlewares: { use: () => {} },
            });
          },
          {
            message: /Refusing to start vite dev server on host '192\.168\.1\.50' without GATEWAY_AUTH_TOKEN/,
          },
        );

        // 4. Localhost allowed without token
        assert.doesNotThrow(() => {
          invokeConfigureServer(plugin, {
            config: { server: { host: "localhost" } },
            middlewares: { use: () => {} },
          });
        });
        assert.doesNotThrow(() => {
          invokeConfigureServer(plugin, {
            config: { server: { host: "127.0.0.1" } },
            middlewares: { use: () => {} },
          });
        });
        assert.doesNotThrow(() => {
          invokeConfigureServer(plugin, {
            config: { server: { host: undefined } },
            middlewares: { use: () => {} },
          });
        });
      } finally {
        if (origToken !== undefined) {
          process.env.GATEWAY_AUTH_TOKEN = origToken;
        }
      }

      const securePlugin = shopifyGatewayDevPlugin({ authToken: "sec-token-123" });
      assert.doesNotThrow(() => {
        invokeConfigureServer(securePlugin, {
          config: { server: { host: "0.0.0.0" } },
          middlewares: { use: () => {} },
        });
      });
    });

    it("Vite dev server plugin allows same-origin requests and blocks cross-origin requests", async () => {
      let middleware: ((req: any, res: any, next: () => void) => Promise<void>) | undefined;
      const plugin = shopifyGatewayDevPlugin({ authToken: "test-token-123" });
      const invokeConfigureServer = (p: unknown, serverMock: unknown) => {
        const plugin = p as { configureServer?: ((s: unknown) => void) | { handler?: (s: unknown) => void } };
        if (typeof plugin.configureServer === "function") {
          plugin.configureServer(serverMock);
        } else if (plugin.configureServer && typeof plugin.configureServer.handler === "function") {
          plugin.configureServer.handler(serverMock);
        }
      };
      invokeConfigureServer(plugin, {
        config: { server: { host: "localhost" } },
        middlewares: {
          use: (fn: any) => {
            middleware = fn;
          },
        },
      });

      assert.ok(middleware);

      // 1. Cross-origin request without token is rejected with 401
      const crossOriginReq = {
        url: "/api/shopify",
        method: "POST",
        headers: {
          "sec-fetch-site": "cross-site",
          origin: "http://evil.com",
          host: "localhost:5173",
        },
      };
      let crossOriginStatus = 0;
      let crossOriginBody = "";
      const crossOriginRes = {
        statusCode: 200,
        setHeader: () => {},
        end: (body: string) => {
          crossOriginStatus = crossOriginRes.statusCode;
          crossOriginBody = body;
        },
      };
      await middleware(crossOriginReq, crossOriginRes, () => {});
      assert.equal(crossOriginStatus, 401);
      assert.match(crossOriginBody, /SHOPIFY_AUTH_FAILED/);

      // 2. Spoofed origin (suffix attack) is rejected with 401
      const spoofedReq = {
        url: "/api/shopify",
        method: "POST",
        headers: {
          origin: "http://localhost:5173.evil.com",
          host: "localhost:5173",
        },
      };
      let spoofedStatus = 0;
      const spoofedRes = {
        statusCode: 200,
        setHeader: () => {},
        end: () => {
          spoofedStatus = spoofedRes.statusCode;
        },
      };
      await middleware(spoofedReq, spoofedRes, () => {});
      assert.equal(spoofedStatus, 401);

      // 3. Same-origin request has token injected into headers
      const sameOriginReq: any = {
        url: "/api/shopify",
        method: "POST",
        headers: {
          "sec-fetch-site": "same-origin",
          host: "localhost:5173",
        },
      };
      const sameOriginRes = {
        statusCode: 200,
        setHeader: () => {},
        end: () => {},
      };
      await middleware(sameOriginReq, sameOriginRes, () => {});
      assert.equal(sameOriginReq.headers["x-gateway-key"], "test-token-123");
    });

    it("isLocalHost correctly classifies local and non-local hostnames", () => {
      assert.equal(isLocalHost(undefined), true);
      assert.equal(isLocalHost(false), true);
      assert.equal(isLocalHost("127.0.0.1"), true);
      assert.equal(isLocalHost("localhost"), true);
      assert.equal(isLocalHost("::1"), true);
      assert.equal(isLocalHost("[::1]"), true);
      assert.equal(isLocalHost(true), false);
      assert.equal(isLocalHost("0.0.0.0"), false);
      assert.equal(isLocalHost("192.168.1.1"), false);
      assert.equal(isLocalHost("example.com"), false);
    });

    it("products.get queries media(first: 50) and maps MediaImage nodes while excluding non-image media", async () => {
      let capturedQuery = "";
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        capturedQuery = body.query;
        return createMockResponse({
          data: {
            product: {
              id: "gid://shopify/Product/media-prod-1",
              title: "Media Product",
              handle: "media-product",
              status: "ACTIVE",
              featuredImage: {
                id: "gid://shopify/ProductImage/feat-1",
                url: "https://example.com/featured.jpg",
                altText: "Feat Alt",
              },
              media: {
                pageInfo: { hasNextPage: false, endCursor: "cursor-1" },
                nodes: [
                  {
                    id: "gid://shopify/MediaImage/img-node-101",
                    alt: "Photo 1",
                    mediaContentType: "IMAGE",
                    image: {
                      url: "https://example.com/photo-1.jpg",
                      width: 1200,
                      height: 1200,
                    },
                  },
                  {
                    id: "gid://shopify/Video/video-node-202",
                    alt: "Promo Video",
                    mediaContentType: "VIDEO",
                    image: null,
                  },
                  {
                    id: "gid://shopify/Model3d/model-node-303",
                    alt: "3D Model",
                    mediaContentType: "MODEL_3D",
                    image: null,
                  },
                ],
              },
              variants: { edges: [] },
              createdAt: "2026-09-01",
              updatedAt: "2026-09-22",
            },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.get",
        payload: { id: "gid://shopify/Product/media-prod-1" },
      });

      assert.equal(res.success, true);
      assert.ok(capturedQuery.includes("media(first: 50)"), "PRODUCTS_GET_QUERY must query media(first: 50)");
      const product = (res.data as { product: ProductSummary }).product;
      assert.ok(product.images);
      assert.equal(product.images.length, 1, "Non-image media (video, 3d model) must be filtered out");
      assert.equal(product.images[0]?.id, "gid://shopify/MediaImage/img-node-101", "ID must be MediaImage GID");
      assert.equal(product.images[0]?.url, "https://example.com/photo-1.jpg");
      assert.equal(product.images[0]?.altText, "Photo 1");
    });

    it("products.update forwards MediaImage.id to fileUpdate mutation", async () => {
      let capturedFilesUpdate: unknown = null;
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query.includes("productUpdate(")) {
          return createMockResponse({
            data: {
              productUpdate: {
                product: {
                  id: "gid://shopify/Product/up-1",
                  title: "Updated",
                  handle: "updated",
                  status: "ACTIVE",
                  variants: { edges: [] },
                  createdAt: "2026-09-01",
                  updatedAt: "2026-09-22",
                },
                userErrors: [],
              },
            },
          });
        }
        if (body.query.includes("fileUpdate(")) {
          capturedFilesUpdate = body.variables.files;
          return createMockResponse({
            data: {
              fileUpdate: {
                files: [{ id: "gid://shopify/MediaImage/img-node-101", alt: "Updated Alt Text" }],
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.update",
        mode: "apply",
        requestId: "req-update-media",
        payload: {
          id: "gid://shopify/Product/up-1",
          product: {
            images: [
              {
                id: "gid://shopify/MediaImage/img-node-101",
                altText: "Updated Alt Text",
              },
            ],
          },
        },
      });

      assert.equal(res.success, true);
      assert.deepEqual(capturedFilesUpdate, [
        { id: "gid://shopify/MediaImage/img-node-101", alt: "Updated Alt Text" },
      ]);
    });

    it("metafields.set enforces UTF-8 byte length safety and rejects values exceeding 128KB limit", async () => {
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        return createMockResponse({
          data: {
            metafieldsSet: {
              metafields: [{ id: "gid://shopify/Metafield/mf-1", namespace: "custom", key: "k", type: "json", value: "{}" }],
              userErrors: [],
            },
          },
        });
      });

      // 1. Valid ASCII string
      const validAscii = "A".repeat(1000);
      const resAscii = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "preview",
        payload: {
          productId: "gid://shopify/Product/1",
          namespace: "custom",
          key: "k",
          value: validAscii,
        },
      });
      assert.equal(resAscii.success, true);

      // 2. Valid Vietnamese diacritics string
      const validVietnamese = "Sản phẩm áo thun cao cấp cho mùa hè tươi mát!";
      const resVi = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "metafields.set",
        mode: "preview",
        payload: {
          productId: "gid://shopify/Product/1",
          namespace: "custom",
          key: "k",
          value: validVietnamese,
        },
      });
      assert.equal(resVi.success, true);

      // 3. ASCII exceeding 131072 bytes (128KB limit)
      const oversizedAscii = "x".repeat(131073);
      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "metafields.set",
            mode: "apply",
            requestId: "req-mf-large",
            payload: {
              productId: "gid://shopify/Product/1",
              namespace: "custom",
              key: "k",
              value: oversizedAscii,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
          assert.equal(err.httpStatus, 400);
          assert.equal(err.message, "Metafield value exceeds Shopify 128KB UTF-8 byte limit");
          return true;
        },
      );

      // 4. Multibyte string (emoji or Vietnamese characters) where character length < 128K but UTF-8 bytes > 131072
      // Each "ế" is 3 bytes in UTF-8. 45000 characters = 135,000 bytes > 131,072 bytes!
      const oversizedMultiByte = "ế".repeat(45000);
      assert.ok(oversizedMultiByte.length < 131072, "Char length is under 128K");
      assert.ok(Buffer.byteLength(oversizedMultiByte, "utf8") > 131072, "Byte length exceeds 128KB limit");

      await assert.rejects(
        async () => {
          await dispatcher.dispatch({
            storeId: "store-test",
            operation: "metafields.set",
            mode: "preview",
            payload: {
              productId: "gid://shopify/Product/1",
              namespace: "custom",
              key: "k",
              value: oversizedMultiByte,
            },
          });
        },
        (err: unknown) => {
          assert.ok(err instanceof GatewayError);
          assert.equal(err.code, "SHOPIFY_INVALID_INPUT");
          assert.equal(err.httpStatus, 400);
          assert.equal(err.message, "Metafield value exceeds Shopify 128KB UTF-8 byte limit");
          return true;
        },
      );
    });

    it("products.create and products.update map categoryId to category in GraphQL variables", async () => {
      let capturedCreateVars: { product?: { category?: string } } | null = null;
      let capturedUpdateVars: { product?: { category?: string } } | null = null;

      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query.includes("productCreate(")) {
          capturedCreateVars = body.variables;
          return createMockResponse({
            data: {
              productCreate: {
                product: { id: "gid://shopify/Product/cat-1", title: "P1", handle: "p1", status: "ACTIVE", variants: { edges: [] }, createdAt: "2026-09-01", updatedAt: "2026-09-22" },
                userErrors: [],
              },
            },
          });
        }
        if (body.query.includes("productUpdate(")) {
          capturedUpdateVars = body.variables;
          return createMockResponse({
            data: {
              productUpdate: {
                product: { id: "gid://shopify/Product/cat-1", title: "P1", handle: "p1", status: "ACTIVE", variants: { edges: [] }, createdAt: "2026-09-01", updatedAt: "2026-09-22" },
                userErrors: [],
              },
            },
          });
        }
        return createMockResponse({});
      });

      // 1. products.create with categoryId
      await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.create",
        mode: "apply",
        requestId: "req-cat-create",
        payload: {
          product: {
            title: "T-Shirt",
            categoryId: "gid://shopify/TaxonomyCategory/aa-10",
          },
        },
      });
      assert.equal(
        (capturedCreateVars as { product?: { category?: string } } | null)?.product?.category,
        "gid://shopify/TaxonomyCategory/aa-10",
      );

      // 2. products.update with categoryId
      await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.update",
        mode: "apply",
        requestId: "req-cat-update",
        payload: {
          id: "gid://shopify/Product/cat-1",
          product: {
            categoryId: "gid://shopify/TaxonomyCategory/bb-20",
          },
        },
      });
      assert.equal(
        (capturedUpdateVars as { product?: { category?: string } } | null)?.product?.category,
        "gid://shopify/TaxonomyCategory/bb-20",
      );
    });

    it("Gateway dispatcher normalizes storeId with whitespace safely", async () => {
      const dispatcher = setupTestGateway(async () => {
        return createMockResponse({
          data: {
            shop: { myshopifyDomain: "quickstart-demo.myshopify.com", name: "Quickstart Demo Store", currencyCode: "USD" },
          },
        });
      });

      const res = await dispatcher.dispatch({
        storeId: "   store-test   ",
        operation: "connection.test",
        payload: {},
      });

      assert.equal(res.success, true);
      assert.equal(res.storeId, "store-test");
    });

    it("storeRegistry normalizes storeId with leading/trailing whitespace in getStore, hasStore, and removeStore", () => {
      const registry = new InMemoryStoreRegistry([
        {
          storeId: "my-shop",
          shopDomain: "my-shop.myshopify.com",
          apiVersion: "2026-07",
          auth: { type: "static", staticToken: "tok" },
        },
      ]);

      assert.equal(registry.hasStore("   my-shop   "), true);
      const store = registry.getStore("   my-shop   ");
      assert.ok(store);
      assert.equal(store?.storeId, "my-shop");

      registry.removeStore("   my-shop   ");
      assert.equal(registry.hasStore("my-shop"), false);
      assert.equal(registry.getStore("my-shop"), undefined);
    });

    it("files.bulkCreate with >250 files correctly splits node polling into chunks of 250", async () => {
      const polledChunks: string[][] = [];
      const totalFilesCount = 252;
      const initialFiles = Array.from({ length: totalFilesCount }, (_, i) => ({
        id: `gid://shopify/MediaImage/${1000 + i}`,
        fileStatus: "PROCESSING",
        url: null,
      }));

      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query.includes("fileCreate(")) {
          return createMockResponse({
            data: {
              fileCreate: {
                files: initialFiles,
                userErrors: [],
              },
            },
          });
        }
        if (body.query.includes("GetFileNodes(")) {
          const ids = body.variables.ids as string[];
          polledChunks.push(ids);
          return createMockResponse({
            data: {
              nodes: ids.map((id) => ({
                id,
                fileStatus: "READY",
                alt: null,
                image: { url: `https://cdn.shopify.com/files/${id.replace(/[^0-9]/g, "")}.jpg`, width: 100, height: 100 },
              })),
            },
          });
        }
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "files.bulkCreate",
        mode: "apply",
        requestId: "req-chunk-polling-test",
        payload: {
          pollIntervalMs: 0,
          maxPollAttempts: 2,
          files: Array.from({ length: totalFilesCount }, (_, i) => ({
            originalSource: `https://example.com/asset-${i}.jpg`,
          })),
        },
      });

      assert.equal(res.success, true);
      const data = res.data as { totalCount: number; successCount: number; failedCount: number };
      assert.equal(data.totalCount, totalFilesCount);
      assert.equal(data.successCount, totalFilesCount);
      assert.equal(data.failedCount, 0);

      // Verify that polling chunked the 252 IDs into chunks: [250 items, 2 items]
      assert.equal(polledChunks.length, 2);
      assert.equal(polledChunks[0]?.length, 250);
      assert.equal(polledChunks[1]?.length, 2);
    });

    it("products.get with mixed media types (IMAGE, VIDEO, MODEL_3D, EXTERNAL_VIDEO) excludes non-image media and preserves image order", async () => {
      const dispatcher = setupTestGateway(async (_url: string, init?: RequestInit) => {
        const body = JSON.parse(init?.body as string);
        if (body.query.includes("ProductsGet(")) {
          return createMockResponse({
            data: {
              product: {
                id: "gid://shopify/Product/mixed-media-1",
                title: "Mixed Media Product",
                handle: "mixed-media-product",
                status: "ACTIVE",
                media: {
                  pageInfo: { hasNextPage: false, endCursor: null },
                  nodes: [
                    {
                      id: "gid://shopify/MediaImage/img-1",
                      alt: "Image 1",
                      mediaContentType: "IMAGE",
                      image: { url: "https://cdn.shopify.com/img-1.jpg", width: 800, height: 800 },
                    },
                    {
                      id: "gid://shopify/Video/video-1",
                      alt: "Product Demo Video",
                      mediaContentType: "VIDEO",
                      image: null,
                    },
                    {
                      id: "gid://shopify/Model3d/model-1",
                      alt: "3D AR Model",
                      mediaContentType: "MODEL_3D",
                      image: null,
                    },
                    {
                      id: "gid://shopify/MediaImage/img-2",
                      alt: "Image 2",
                      mediaContentType: "IMAGE",
                      image: { url: "https://cdn.shopify.com/img-2.jpg", width: 1000, height: 1000 },
                    },
                    {
                      id: "gid://shopify/ExternalVideo/ext-vid-1",
                      alt: "YouTube Review",
                      mediaContentType: "EXTERNAL_VIDEO",
                      image: null,
                    },
                  ],
                },
                variants: { edges: [] },
                createdAt: "2026-09-01T00:00:00Z",
                updatedAt: "2026-09-22T00:00:00Z",
              },
            },
          });
        }
        return createMockResponse({});
      });

      const res = await dispatcher.dispatch({
        storeId: "store-test",
        operation: "products.get",
        payload: { id: "gid://shopify/Product/mixed-media-1" },
      });

      assert.equal(res.success, true);
      const product = (res.data as { product: { images: readonly { id?: string; url: string; altText?: string }[] } }).product;
      assert.equal(product.images.length, 2);
      assert.equal(product.images[0]?.id, "gid://shopify/MediaImage/img-1");
      assert.equal(product.images[0]?.altText, "Image 1");
      assert.equal(product.images[1]?.id, "gid://shopify/MediaImage/img-2");
      assert.equal(product.images[1]?.altText, "Image 2");
    });
  });
});




