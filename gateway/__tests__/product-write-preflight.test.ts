import assert from "node:assert/strict";
import test from "node:test";

import { GatewayError, InMemoryThrottleManager, ShopifyGraphqlClient, StaticAccessTokenProvider } from "../index";
import { executeProductsCreate, executeProductsUpdate } from "../operations/products-write";
import type { StoreConfig } from "../types";

const store: StoreConfig = { storeId: "sample", shopDomain: "sample.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "test-only" } };

function createClient(response: unknown, onRequest: (query: string) => void = () => undefined): ShopifyGraphqlClient {
  return new ShopifyGraphqlClient({ tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => {
      const request: { query: string } = JSON.parse(String(init?.body));
      onRequest(request.query);
      return new Response(JSON.stringify({ data: response }), { headers: { "content-type": "application/json" } });
    } });
}

test("create rejects four options before upload or GraphQL requests", async () => {
  const client = createClient({}, () => assert.fail("no external work before validation"));
  await assert.rejects(executeProductsCreate(store, client, { product: { title: "Sample", media: [{ originalSource: "https://example.com/image.png" }],
    variants: [{ price: "10.00", optionValues: ["A", "B", "C", "D"].map(optionName => ({ optionName, name: "Yes" })) }] } }),
  error => error instanceof GatewayError && error.details?.productWriteNotStarted === true);
});

test("create validation rejection proves no product write while missing response stays uncertain", async () => {
  await assert.rejects(executeProductsCreate(store, createClient({ productCreate: { product: null, userErrors: [{ message: "Invalid title", field: ["title"] }] } }), { product: { title: "Sample" } }),
    error => error instanceof GatewayError && error.details?.productWriteNotStarted === true && !error.reconciliationRequired);
  await assert.rejects(executeProductsCreate(store, createClient({ productCreate: { product: null, userErrors: [] } }), { product: { title: "Sample" } }),
    error => error instanceof GatewayError && error.reconciliationRequired);
});

test("create returning both a product and errors preserves the partial product for reconciliation", async () => {
  await assert.rejects(executeProductsCreate(store, createClient({ productCreate: { product: { id: "gid://shopify/Product/1" }, userErrors: [{ message: "Partial failure" }] } }), { product: { title: "Sample" } }),
    error => error instanceof GatewayError && error.reconciliationRequired && error.details?.createdProductId === "gid://shopify/Product/1");
});

test("update rejects option additions that exceed the existing three axes before mutation", async () => {
  const client = createClient({ node: { options: [{ name: "A" }, { name: "B" }, { name: "C" }], variants: { nodes: [] } } }, query => assert.doesNotMatch(query, /mutation/));
  await assert.rejects(executeProductsUpdate(store, client, { id: "gid://shopify/Product/1", product: { variants: [{ price: "10", optionValues: [{ optionName: "D", name: "d" }] }] } }),
    error => error instanceof GatewayError && error.details?.productWriteNotStarted === true);
});
