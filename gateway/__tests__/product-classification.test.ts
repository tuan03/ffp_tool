import assert from "node:assert/strict";
import test from "node:test";

import { createClassificationCatalogLoader, validateLiveProductClassification, validateProductClassification } from "../seo-worker/product-classification";
import type { StoreConfig } from "../types";

const catalog = { collections: [{ id: "gid://shopify/Collection/1", title: "Cats", description: "Cat designs" }], productTypes: ["Handbag"] };

test("classification accepts one store collection and canonicalizes existing product types", () => {
  const result = validateProductClassification({ status: "ready", collectionId: catalog.collections[0].id, productType: " handbag  ", reason: "Visible cat handbag" }, catalog);
  assert.equal(result.status, "ready");
  assert.equal(result.productType, "Handbag");
});

test("classification permits new types but rejects absent or cross-store collections", () => {
  assert.equal(validateProductClassification({ status: "ready", collectionId: catalog.collections[0].id, productType: "Wallet", reason: "Visible wallet" }, catalog).productType, "Wallet");
  assert.equal(validateProductClassification({ status: "ready", collectionId: "gid://shopify/Collection/99", productType: "Wallet", reason: "Wrong store" }, catalog).status, "needs_review");
  assert.equal(validateProductClassification(undefined, catalog).status, "needs_review");
});

test("catalog reads all pages, excludes automatic collections and coalesces reads per store", async () => {
  const calls: string[] = [];
  const loader = createClassificationCatalogLoader({ query: async <T>(store: StoreConfig, document: string, variables?: Record<string, unknown>): Promise<T> => {
    const kind = document.includes("ClassificationCollections") ? "collections" : "productTypes";
    calls.push(`${store.storeId}:${kind}:${variables?.after ?? "first"}`);
    const second = Boolean(variables?.after);
    const response = kind === "collections" ? { collections: {
      edges: [{ node: { id: `gid://shopify/Collection/${store.storeId}-${second ? 2 : 1}`, title: "Cats", description: "Cats", ruleSet: null } },
        { node: { id: "automatic", title: "Rule based", description: "", ruleSet: {} } }],
      pageInfo: { hasNextPage: !second, endCursor: "second" },
    } } : { productTypes: { edges: [{ node: second ? "Wallet" : "Handbag" }], pageInfo: { hasNextPage: !second, endCursor: "second" } } };
    return response as T;
  } }, id => ({ storeId: id, shopDomain: `${id}.myshopify.com` } as StoreConfig));
  const [first, concurrent] = await Promise.all([loader("one"), loader("one")]);
  assert.deepEqual(first, concurrent);
  assert.equal(first.collections.length, 2);
  assert.deepEqual(first.productTypes, ["Handbag", "Wallet"]);
  assert.equal(calls.length, 4);
  await loader("one");
  assert.equal(calls.length, 4);
  const second = await loader("two");
  assert.equal(calls.length, 8);
  assert.notEqual(second.collections[0].id, first.collections[0].id);
});

test("catalog failures are not cached as an empty successful catalog", async () => {
  let calls = 0;
  const loader = createClassificationCatalogLoader({ query: async () => { calls += 1; throw new Error("offline"); } },
    id => ({ storeId: id, shopDomain: `${id}.myshopify.com` } as StoreConfig));
  await assert.rejects(loader("one"), /offline/);
  await assert.rejects(loader("one"), /offline/);
  assert.equal(calls, 2);
});

test("live pre-write check rejects deleted or newly automated collections despite a cached selection", async () => {
  const id = catalog.collections[0].id;
  for (const collection of [null, { id, ruleSet: {} }, { id: "wrong-store", ruleSet: null }, { id, ruleSet: null }]) {
    const result = await validateLiveProductClassification({ catalog,
      candidate: { status: "ready", collectionId: id, productType: "Handbag", reason: "Viewed image" },
      store: { storeId: "one", shopDomain: "one.myshopify.com" } as StoreConfig,
      client: { query: async <T>(store: StoreConfig, _document: string, variables?: Record<string, unknown>): Promise<T> => {
        assert.equal(store.storeId, "one"); assert.equal(variables?.id, id);
        return { collection } as T;
      } },
    });
    assert.equal(result.status, collection?.id === id && collection.ruleSet === null ? "ready" : "needs_review");
  }
});
