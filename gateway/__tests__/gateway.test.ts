import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  createGatewayHttpHandler,
  createStoreTransport,
  GatewayDispatcher,
  GatewayError,
  InMemoryStoreRegistry,
  InMemoryThrottleManager,
  sanitizeErrorMessage,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
  ClientCredentialsTokenProvider,
  type StoreConfig,
  type HttpTransport,
} from "../index";

function createMockResponse(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

describe("Gateway: StoreRegistry", () => {
  it("resolves registered store and rejects unknown store", () => {
    const registry = new InMemoryStoreRegistry();
    registry.registerStore({
      storeId: "store-a",
      shopDomain: "store-a.myshopify.com",
      apiVersion: "2026-07",
      auth: { type: "static", staticToken: "shpat_test_a" },
    });

    const store = registry.getStore("store-a");
    assert.ok(store);
    assert.equal(store.shopDomain, "store-a.myshopify.com");

    const unknown = registry.getStore("store-unknown");
    assert.equal(unknown, undefined);
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
    const tokenProvider = new StaticAccessTokenProvider();

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
  function setupGateway(mockGraphqlData: unknown) {
    const registry = new InMemoryStoreRegistry([
      {
        storeId: "store-test",
        shopDomain: "store-test.myshopify.com",
        apiVersion: "2026-07",
        auth: { type: "static", staticToken: "shpat_mock_123" },
      },
    ]);

    const fakeTransport: HttpTransport = async () => createMockResponse(mockGraphqlData);
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

  it("executes products.list with cursor pagination", async () => {
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
      },
    });

    const res = await dispatcher.dispatch({
      storeId: "store-test",
      operation: "collections.list",
      payload: { limit: 5 },
    });

    assert.equal(res.success, true);
    const data = res.data as { collections: { title: string; productsCount: number }[] };
    assert.equal(data.collections[0].title, "Summer Collection");
    assert.equal(data.collections[0].productsCount, 42);
  });

  it("rejects Phase 3 write operations with explicit NOT_IMPLEMENTED error", async () => {
    const dispatcher = setupGateway({});

    const writeOps = [
      "products.create",
      "products.update",
      "products.bulkUpdate",
      "products.delete",
      "variants.update",
      "variants.bulkUpdate",
      "collections.create",
      "collections.update",
      "collections.delete",
      "collections.updateMembership",
    ];

    for (const op of writeOps) {
      await assert.rejects(
        async () =>
          dispatcher.dispatch({
            storeId: "store-test",
            operation: op,
            payload: {},
          }),
        (err: unknown) =>
          err instanceof GatewayError &&
          err.code === "NOT_IMPLEMENTED" &&
          err.httpStatus === 400,
        `Operation ${op} must reject with NOT_IMPLEMENTED in Phase 3`,
      );
    }
  });
});

describe("Gateway: HTTP Server Handler", () => {
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
    const json = await res.json() as { success: boolean; data: { isConnected: boolean } };
    assert.equal(json.success, true);
    assert.equal(json.data.isConnected, true);
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
