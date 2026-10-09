import assert from "node:assert/strict";
import test from "node:test";

import { findExistingAmazonProducts } from "./pipeline-amazon-duplicates.ts";

test("checks exact child ASINs even when the family parent differs", async () => {
  const queries = [];
  const matches = await findExistingAmazonProducts({
    product: { asin: "B0CHILD001", parentAsin: "B0PARENT01", sourceVariants: [{ asin: "B0CHILD001" }] },
    query: async (query, variables) => {
      queries.push(variables);
      if (query.includes("metafieldDefinition")) return { definition: { capabilities: { adminFilterable: { status: "FILTERABLE" } } } };
      return { products: { nodes: [{ id: "gid://shopify/Product/1", asin: { value: "B0CHILD001" } }], pageInfo: { hasNextPage: false } } };
    },
  });
  assert.deepEqual(matches, [{ asin: "B0CHILD001", productId: "gid://shopify/Product/1" }]);
  assert.match(queries[1].query, /amazon_asin/);
  assert.doesNotMatch(queries[1].query, /amazon_parent_asin/);
});

test("does not mistake unrelated search results for duplicates and follows pagination", async () => {
  const matches = await findExistingAmazonProducts({
    product: { asin: "B0CHILD001" },
    query: async (query, variables) => {
      if (query.includes("metafieldDefinition")) return { definition: { capabilities: { adminFilterable: { status: "FILTERABLE" } } } };
      return variables.cursor
        ? { products: { nodes: [{ id: "gid://shopify/Product/2", asin: { value: "B0CHILD001" } }], pageInfo: { hasNextPage: false } } }
        : { products: { nodes: [{ id: "gid://shopify/Product/1", asin: { value: "B0OTHER001" } }], pageInfo: { hasNextPage: true, endCursor: "next" } } };
    },
  });
  assert.equal(matches[0].productId, "gid://shopify/Product/2");
});

test("a new ASIN is allowed but unavailable filtering or transport errors block handoff", async () => {
  const product = { asin: "B0CHILD001" };
  assert.deepEqual(await findExistingAmazonProducts({ product, query: async (query) => query.includes("metafieldDefinition")
    ? { definition: { capabilities: { adminFilterable: { status: "FILTERABLE" } } } }
    : { products: { nodes: [], pageInfo: { hasNextPage: false } } } }), []);
  await assert.rejects(findExistingAmazonProducts({ product, query: async () => ({ definition: null }) }), /NOT_SEARCHABLE/);
  await assert.rejects(findExistingAmazonProducts({ product, query: async () => { throw new Error("offline"); } }), /offline/);
});

test("does not discard a new child when a product contains mixed existing and new variants", async () => {
  const matches = await findExistingAmazonProducts({
    product: { asin: "B0CHILD001", sourceVariants: [{ asin: "B0CHILD001" }, { asin: "B0CHILD002" }, null] },
    query: async (query, variables) => query.includes("metafieldDefinition")
      ? { definition: { capabilities: { adminFilterable: { status: "FILTERABLE" } } } }
      : { products: { nodes: variables.query.includes("B0CHILD001")
        ? [{ id: "gid://shopify/Product/1", asin: { value: "B0CHILD001" } }] : [], pageInfo: { hasNextPage: false } } },
  });
  assert.deepEqual(matches, []);
});

test("does not silently accept incomplete pagination or products without an exact ASIN", async () => {
  await assert.rejects(findExistingAmazonProducts({ product: { asin: "B0CHILD001" }, query: async query =>
    query.includes("metafieldDefinition") ? { definition: { capabilities: { adminFilterable: { status: "FILTERABLE" } } } }
      : { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } } }), /PAGINATION_FAILED/);
  await assert.rejects(findExistingAmazonProducts({ product: {}, query: async () => { throw new Error("should not query"); } }), /EXACT_ASIN_REQUIRED/);
});
