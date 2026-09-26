import assert from "node:assert/strict";
import test from "node:test";

import { executeAmazonAsinPreflight } from "../operations/amazon-asin-preflight";
import type { StoreConfig } from "../types";

const store: StoreConfig = {
  storeId: "capozen",
  shopDomain: "example.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test-token" },
};

test("preflight finds exact custom.amazon_asin matches and checks every distinct ASIN", async () => {
  const searched: string[] = [];
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("metafieldDefinition(identifier")) {
        return { metafieldDefinition: { type: { name: "single_line_text_field" }, capabilities: { adminFilterable: { enabled: true, status: "FILTERABLE" } } } } as T;
      }
      const search = String(variables?.query);
      searched.push(search);
      const asin = search.match(/"([A-Z0-9]{10})"/)?.[1];
      return { products: { nodes: asin === "B012345678"
        ? [{ id: "gid://shopify/Product/123", title: "Existing product", metafield: { value: asin } }]
        : [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, { asins: ["B012345678", "B098765432", "B012345678"] }, "apply");
  assert.equal(result.ready, true);
  assert.deepEqual(result.matches, [{
    asin: "B012345678", productId: "gid://shopify/Product/123", title: "Existing product",
    adminUrl: "https://example.myshopify.com/admin/products/123",
  }]);
  assert.equal(searched.length, 2);
  assert.ok(searched.every((search) => search.startsWith("metafields.custom.amazon_asin:")));
});

test("preflight enables missing filter and blocks while Shopify indexes it", async () => {
  let definitionReads = 0;
  let productQueries = 0;
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("metafieldDefinition(identifier")) {
        definitionReads++;
        return { metafieldDefinition: definitionReads === 1 ? null : {
          type: { name: "single_line_text_field" },
          capabilities: { adminFilterable: { enabled: true, status: "IN_PROGRESS" } },
        } } as T;
      }
      if (query.includes("metafieldDefinitionCreate")) return { metafieldDefinitionCreate: { userErrors: [] } } as T;
      productQueries++;
      return { products: { nodes: [] } } as T;
    },
  };

  assert.deepEqual(await executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "apply"), {
    ready: false, matches: [],
  });
  assert.equal(definitionReads, 2);
  assert.equal(productQueries, 0);
});

test("preflight enables an existing definition before searching", async () => {
  let definitionReads = 0;
  let updated = false;
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("metafieldDefinition(identifier")) {
        definitionReads++;
        return { metafieldDefinition: {
          type: { name: "single_line_text_field" },
          capabilities: { adminFilterable: { enabled: definitionReads > 1, status: definitionReads > 1 ? "FILTERABLE" : "NOT_FILTERABLE" } },
        } } as T;
      }
      if (query.includes("metafieldDefinitionUpdate")) {
        updated = true;
        return { metafieldDefinitionUpdate: { userErrors: [] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "apply");
  assert.equal(updated, true);
  assert.equal(result.ready, true);
  assert.deepEqual(result.matches, []);
});

test("preflight rejects invalid ASINs and never mutates Shopify in preview", async () => {
  const client = { async query<T>(): Promise<T> { throw new Error("Shopify must not be called"); } };
  await assert.rejects(executeAmazonAsinPreflight(store, client, { asins: ["not-an-asin"] }, "apply"));
  await assert.rejects(executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "preview"));
});
