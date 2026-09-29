import assert from "node:assert/strict";
import test from "node:test";

import {
  InMemoryThrottleManager,
  ShopifyGraphqlClient,
  StaticAccessTokenProvider,
} from "../index";
import type { HttpTransport, StoreConfig } from "../index";
import { executeProductsUpdate } from "../operations/products-write";
import {
  ensureUrlRedirect,
  safeEnsureUrlRedirect,
} from "../operations/url-redirects";

const testStore: StoreConfig = {
  storeId: "test-store",
  shopDomain: "test-store.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "shpat_test_token" },
};

function createMockClient(
  handler: (queryStr: string, variables?: Record<string, unknown>) => unknown,
): ShopifyGraphqlClient {
  const graphqlTransport: HttpTransport = async (_url, init) => {
    let bodyObj: { query?: string; variables?: Record<string, unknown> } = {};
    if (typeof init?.body === "string") {
      try {
        bodyObj = JSON.parse(init.body);
      } catch {
        // ignore
      }
    }
    const responseData = handler(bodyObj.query ?? "", bodyObj.variables);
    return new Response(JSON.stringify({ data: responseData }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  return new ShopifyGraphqlClient({
    tokenProvider: new StaticAccessTokenProvider(),
    throttleManager: new InMemoryThrottleManager(),
    baseTransport: graphqlTransport,
  });
}

test("ensureUrlRedirect: skips when oldHandle equals newHandle or either is blank", async () => {
  const calls: string[] = [];
  const client = createMockClient((query) => {
    calls.push(query);
    return {};
  });

  const res1 = await ensureUrlRedirect(client, testStore, "same-handle", "same-handle");
  assert.equal(res1.action, "skipped");
  assert.equal(res1.success, true);

  const res2 = await ensureUrlRedirect(client, testStore, "", "new-handle");
  assert.equal(res2.action, "skipped");
  assert.equal(res2.success, true);

  assert.equal(calls.length, 0, "No GraphQL calls should be made if handles match or empty");
});

test("ensureUrlRedirect: creates 301 redirect when handle changes", async () => {
  let createdPayload: unknown = null;
  const client = createMockClient((query, variables) => {
    if (query.includes("urlRedirectCreate")) {
      createdPayload = variables?.urlRedirect;
      return {
        urlRedirectCreate: {
          urlRedirect: {
            id: "gid://shopify/UrlRedirect/1001",
            path: "/products/vintage-tee",
            target: "/products/retro-tee",
          },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  });

  const res = await ensureUrlRedirect(client, testStore, "vintage-tee", "retro-tee");
  assert.equal(res.success, true);
  assert.equal(res.action, "created");
  assert.equal(res.redirectId, "gid://shopify/UrlRedirect/1001");
  assert.deepEqual(createdPayload, {
    path: "/products/vintage-tee",
    target: "/products/retro-tee",
  });
});

test("ensureUrlRedirect: TAKEN error queries existing redirect and is idempotent if target matches", async () => {
  const executedOperations: string[] = [];
  const client = createMockClient((query, variables) => {
    if (query.includes("urlRedirectCreate")) {
      executedOperations.push("urlRedirectCreate");
      return {
        urlRedirectCreate: {
          urlRedirect: null,
          userErrors: [
            {
              code: "TAKEN",
              field: ["path"],
              message: "Path has already been taken.",
            },
          ],
        },
      };
    }
    if (query.includes("urlRedirects")) {
      executedOperations.push(`urlRedirects:${variables?.query}`);
      return {
        urlRedirects: {
          edges: [
            {
              node: {
                id: "gid://shopify/UrlRedirect/2002",
                path: "/products/old-slug",
                target: "/products/new-slug",
              },
            },
          ],
        },
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  });

  const res = await ensureUrlRedirect(client, testStore, "old-slug", "new-slug");
  assert.equal(res.success, true);
  assert.equal(res.action, "already_exists");
  assert.equal(res.redirectId, "gid://shopify/UrlRedirect/2002");
  assert.deepEqual(executedOperations, [
    "urlRedirectCreate",
    "urlRedirects:path:/products/old-slug",
  ]);
});

test("ensureUrlRedirect: TAKEN error updates destination if target differs", async () => {
  const executedOperations: string[] = [];
  let updateVariables: unknown = null;

  const client = createMockClient((query, variables) => {
    if (query.includes("urlRedirectCreate")) {
      executedOperations.push("urlRedirectCreate");
      return {
        urlRedirectCreate: {
          urlRedirect: null,
          userErrors: [
            {
              code: "TAKEN",
              field: ["path"],
              message: "Path has already been taken.",
            },
          ],
        },
      };
    }
    if (query.includes("urlRedirects")) {
      executedOperations.push("urlRedirects");
      return {
        urlRedirects: {
          edges: [
            {
              node: {
                id: "gid://shopify/UrlRedirect/3003",
                path: "/products/old-slug",
                target: "/products/intermediate-slug", // different target!
              },
            },
          ],
        },
      };
    }
    if (query.includes("urlRedirectUpdate")) {
      executedOperations.push("urlRedirectUpdate");
      updateVariables = variables;
      return {
        urlRedirectUpdate: {
          urlRedirect: {
            id: "gid://shopify/UrlRedirect/3003",
            path: "/products/old-slug",
            target: "/products/final-slug",
          },
          userErrors: [],
        },
      };
    }
    throw new Error(`Unexpected query: ${query}`);
  });

  const res = await ensureUrlRedirect(client, testStore, "old-slug", "final-slug");
  assert.equal(res.success, true);
  assert.equal(res.action, "updated");
  assert.equal(res.redirectId, "gid://shopify/UrlRedirect/3003");
  assert.deepEqual(executedOperations, [
    "urlRedirectCreate",
    "urlRedirects",
    "urlRedirectUpdate",
  ]);
  assert.deepEqual(updateVariables, {
    id: "gid://shopify/UrlRedirect/3003",
    urlRedirect: { target: "/products/final-slug" },
  });
});

test("safeEnsureUrlRedirect: catches error and returns warning without throwing", async () => {
  const client = createMockClient(() => {
    throw new Error("Shopify network timeout on redirect");
  });

  const res = await safeEnsureUrlRedirect(client, testStore, "handle-a", "handle-b");
  assert.equal(res.success, false);
  assert.equal(res.action, "skipped");
  assert.match(res.warning ?? "", /could not be created/);
});

test("executeProductsUpdate: handle change non-fatal isolation does not fail product update if redirect errors", async () => {
  const client = createMockClient((query) => {
    // 1. Initial product get query
    if (query.includes("query ProductsGet")) {
      return {
        product: {
          id: "gid://shopify/Product/123",
          title: "Old Product",
          handle: "old-product-handle",
          updatedAt: "2026-09-28T10:00:00Z",
          status: "ACTIVE",
          tags: [],
          variants: { edges: [] },
          media: { nodes: [] },
        },
      };
    }
    // 2. Product update mutation
    if (query.includes("mutation ProductUpdate")) {
      return {
        productUpdate: {
          product: {
            id: "gid://shopify/Product/123",
            title: "Updated Product",
            handle: "new-product-handle",
            updatedAt: "2026-09-28T10:05:00Z",
            status: "ACTIVE",
            tags: [],
            variants: { edges: [] },
            media: { nodes: [] },
          },
          userErrors: [],
        },
      };
    }
    // 3. Url redirect create mutation fails!
    if (query.includes("urlRedirectCreate")) {
      throw new Error("Simulated redirect service failure");
    }
    return {};
  });

  // Execute product update where handle changes from old-product-handle to new-product-handle
  const result = await executeProductsUpdate(testStore, client, {
    id: "gid://shopify/Product/123",
    product: {
      handle: "new-product-handle",
      title: "Updated Product",
    },
  });

  assert.equal(result.product.id, "gid://shopify/Product/123");
  assert.equal(result.product.handle, "new-product-handle");
  assert.equal(result.product.title, "Updated Product");
});
