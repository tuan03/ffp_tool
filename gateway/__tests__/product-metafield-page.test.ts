import assert from "node:assert/strict";
import test from "node:test";

import { GatewayError } from "../errors";
import { GatewayDispatcher } from "../dispatcher";
import { executeProductMetafieldPage } from "../operations/product-metafield-page";
import { ShopifyGraphqlClient } from "../shopify-graphql-client";
import { InMemoryStoreRegistry } from "../store-registry";
import { InMemoryThrottleManager } from "../throttle-manager";
import { StaticAccessTokenProvider } from "../token-provider";
import type { StoreConfig } from "../types";

const store: StoreConfig = {
  storeId: "new-store", shopDomain: "new-store.myshopify.com", apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test-only" },
};
const product = { id: "gid://shopify/Product/123", title: "Existing product", status: "DRAFT", metafield: { value: "B0EXIST001" } };

test("product metafield page reads thin unfiltered product data without writes or index changes", async () => {
  const client = {
    async query<T>(targetStore: StoreConfig, query: string, variables?: Record<string, unknown>, options?: { isWrite?: boolean }): Promise<T> {
      assert.equal(targetStore, store);
      assert.ok(query.includes("metafield(namespace: $namespace, key: $key)"));
      assert.ok(query.includes("sortKey: ID"));
      assert.doesNotMatch(query, /mutation|metafieldDefinition|descriptionHtml|variants|query:/);
      assert.equal(options?.isWrite, undefined);
      assert.deepEqual(variables, { namespace: "custom", key: "amazon_asin", first: 200, after: "previous" });
      return { products: { nodes: [product], pageInfo: { hasNextPage: true, endCursor: "next" } } } as T;
    },
  };
  const page = await executeProductMetafieldPage(store, client, { namespace: "custom", key: "amazon_asin", first: 200, after: "previous" });
  assert.equal(page.shopDomain, store.shopDomain);
  assert.deepEqual(page.products, [{ id: product.id, title: product.title, status: "DRAFT", value: "B0EXIST001" }]);
  assert.deepEqual(page.pageInfo, { hasNextPage: true, endCursor: "next" });
});

test("product metafield page validates input before any Shopify request", async () => {
  const client = { async query<T>(): Promise<T> { throw new Error("Must not call Shopify"); } };
  for (const payload of [null, { namespace: "", key: "amazon_asin" }, { namespace: "custom", key: "bad key" },
    { namespace: "custom", key: "amazon_asin", first: 251 }, { namespace: "custom", key: "amazon_asin", after: "" }]) {
    await assert.rejects(executeProductMetafieldPage(store, client, payload), (error: unknown) => error instanceof GatewayError && error.code === "SHOPIFY_INVALID_INPUT");
  }
});

test("product metafield page fails closed on malformed products and non-advancing pagination", async () => {
  for (const raw of [null, {}, { products: { nodes: [null], pageInfo: { hasNextPage: false, endCursor: null } } },
    { products: { nodes: [{ ...product, metafield: {} }], pageInfo: { hasNextPage: false, endCursor: null } } },
    { products: { nodes: [product], pageInfo: { hasNextPage: true, endCursor: null } } },
    { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "previous" } } }]) {
    const client = { async query<T>(): Promise<T> { return raw as T; } };
    await assert.rejects(executeProductMetafieldPage(store, client, { namespace: "custom", key: "amazon_asin", after: "previous" }),
      (error: unknown) => error instanceof GatewayError && error.code === "SHOPIFY_NETWORK_ERROR");
  }
});

test("product metafield page returns null when a product has no metafield", async () => {
  const client = { async query<T>(): Promise<T> { return { products: { nodes: [{ ...product, metafield: null }], pageInfo: { hasNextPage: false, endCursor: null } } } as T; } };
  const page = await executeProductMetafieldPage(store, client, { namespace: "custom", key: "amazon_asin" });
  assert.equal(page.products[0]?.value, null);
});

test("Gateway dispatches metafieldPage as a store-scoped read without apply mode or idempotency requestId", async () => {
  let reads = 0;
  const client = new ShopifyGraphqlClient({
    tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (url, init) => {
      reads++;
      assert.equal(url, `https://${store.shopDomain}/admin/api/${store.apiVersion}/graphql.json`);
      const body = JSON.parse(String(init?.body));
      assert.match(body.query, /^query ProductMetafieldPage/);
      return new Response(JSON.stringify({ data: { products: { nodes: [product], pageInfo: { hasNextPage: false, endCursor: null } } } }));
    },
  });
  const dispatcher = new GatewayDispatcher({ storeRegistry: new InMemoryStoreRegistry([store]), graphqlClient: client });
  const result = await dispatcher.dispatch({ storeId: store.storeId, operation: "products.metafieldPage", payload: { namespace: "custom", key: "amazon_asin" } });
  assert.equal(result.success, true);
  assert.equal(result.storeId, store.storeId);
  assert.equal(reads, 1);
  await assert.rejects(dispatcher.dispatch({ storeId: "other-store", operation: "products.metafieldPage", payload: { namespace: "custom", key: "amazon_asin" } }),
    (error: unknown) => error instanceof GatewayError && error.code === "SHOPIFY_NOT_FOUND");
  assert.equal(reads, 1);
});
