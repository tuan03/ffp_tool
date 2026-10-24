import assert from "node:assert/strict";
import test from "node:test";

import {
  executeProductPublicationStatus,
  executeProductPublishAll,
  executeProductSetPublication,
} from "../operations/publications";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";
import { GatewayDispatcher } from "../dispatcher";
import { InMemoryStoreRegistry } from "../store-registry";

const store = { storeId: "sample", shopDomain: "sample.myshopify.com", apiVersion: "2026-07" } as StoreConfig;

function clientWithQuery(query: (document: string, variables?: Record<string, unknown>) => Promise<unknown>): ShopifyGraphqlClient {
  return { query: (_store: StoreConfig, document: string, variables?: Record<string, unknown>) => query(document, variables) } as ShopifyGraphqlClient;
}

test("publishes every accessible sales channel across pages and verifies publication", async () => {
  const writes: string[] = [];
  const client = clientWithQuery(async (document, variables) => {
    if (document.includes("query SalesChannels")) return {
      publications: { nodes: variables?.after ? [{ id: "gid://shopify/Publication/2", name: "POS", catalog: { __typename: "AppCatalog" } }]
        : [{ id: "gid://shopify/Publication/1", name: "Online Store", catalog: { __typename: "AppCatalog" } },
          { id: "gid://shopify/Publication/3", name: "Market", catalog: { __typename: "MarketCatalog" } }],
      pageInfo: { hasNextPage: !variables?.after, endCursor: variables?.after ? null : "next" } },
    };
    if (document.includes("mutation PublishChannel")) { writes.push(String(variables?.publicationId)); return { publishablePublish: { userErrors: [] } }; }
    return { product: { status: "ACTIVE", publishedOnPublication: writes.includes(String(variables?.publicationId)) } };
  });
  const result = await executeProductPublishAll(store, client, { productId: "gid://shopify/Product/1" });
  assert.equal(result.status, "completed");
  assert.deepEqual(writes, ["gid://shopify/Publication/1", "gid://shopify/Publication/2"]);
  assert.equal(result.channels.length, 2);
});

test("channel failure remains partial and retry skips channels already published", async () => {
  let writes = 0;
  const result = await executeProductPublishAll(store, clientWithQuery(async document => {
    if (document.includes("query SalesChannels")) return { publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store", catalog: null }], pageInfo: { hasNextPage: false } } };
    if (document.includes("mutation")) { writes += 1; return { publishablePublish: { userErrors: [{ message: "Channel rejects product" }] } }; }
    return { product: { status: "ACTIVE", publishedOnPublication: false } };
  }), { productId: "gid://shopify/Product/1" });
  assert.equal(result.status, "partial");
  assert.equal(result.channels[0].published, false);
  assert.equal(writes, 1);
  await executeProductPublishAll(store, clientWithQuery(async document => {
    if (document.includes("query SalesChannels")) return { publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online Store", catalog: null }], pageInfo: { hasNextPage: false } } };
    assert.ok(!document.includes("mutation"));
    return { product: { status: "ACTIVE", publishedOnPublication: true } };
  }), { productId: "gid://shopify/Product/1" });
});

test("missing scopes, empty channels, inactive product and broken pagination cannot report success", async () => {
  await assert.rejects(executeProductPublishAll(store, clientWithQuery(async () => { throw new Error("Access denied"); }), { productId: "gid://shopify/Product/1" }), /Access denied/);
  const empty = await executeProductPublishAll(store, clientWithQuery(async () => ({ publications: { nodes: [], pageInfo: { hasNextPage: false } } })), { productId: "gid://shopify/Product/1" });
  assert.equal(empty.status, "failed");
  await assert.rejects(executeProductPublishAll(store, clientWithQuery(async () => ({ publications: { nodes: [], pageInfo: { hasNextPage: true } } })), { productId: "gid://shopify/Product/1" }), /pagination/i);
  const inactive = await executeProductPublishAll(store, clientWithQuery(async document => document.includes("SalesChannels")
    ? { publications: { nodes: [{ id: "gid://shopify/Publication/1", name: "Online", catalog: null }], pageInfo: { hasNextPage: false } } }
    : { product: { status: "DRAFT", publishedOnPublication: false } }), { productId: "gid://shopify/Product/1" });
  assert.equal(inactive.status, "partial");
});

test("publication operation respects preview, request IDs and cached replay", async () => {
  const registry = new InMemoryStoreRegistry();
  registry.registerStore({ ...store, auth: { type: "static", staticToken: "test-only" } });
  let reads = 0;
  const dispatcher = new GatewayDispatcher({ storeRegistry: registry, graphqlClient: clientWithQuery(async () => {
    reads += 1;
    return { publications: { nodes: [], pageInfo: { hasNextPage: false } } };
  }) });
  const input = { storeId: "sample", operation: "products.publishAll", payload: { productId: "gid://shopify/Product/1" } };
  await dispatcher.dispatch({ ...input, mode: "preview" });
  assert.equal(reads, 0);
  await assert.rejects(dispatcher.dispatch({ ...input, mode: "preview", payload: { productId: "invalid" } }), /product ID/);
  await assert.rejects(dispatcher.dispatch({ ...input, mode: "apply" }), /requestId/);
  await dispatcher.dispatch({ ...input, mode: "apply", requestId: "publish-1" });
  await dispatcher.dispatch({ ...input, mode: "apply", requestId: "publish-1" });
  assert.equal(reads, 1);
  await dispatcher.dispatch({ ...input, mode: "apply", requestId: "publish-2" });
  assert.equal(reads, 2);
});

test("reads product publication status for one exact app catalog", async () => {
  const client = clientWithQuery(async (document, variables) => {
    if (document.includes("query PublicationChannels")) {
      return {
        publications: {
          nodes: [
            { id: "gid://shopify/Publication/1", catalog: { __typename: "AppCatalog", title: "Online Store" } },
            { id: "gid://shopify/Publication/2", catalog: { __typename: "AppCatalog", title: "Shop" } },
          ],
          pageInfo: { hasNextPage: false },
        },
      };
    }
    assert.deepEqual(variables, {
      ids: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
      publicationId: "gid://shopify/Publication/2",
    });
    return {
      nodes: [
        { id: "gid://shopify/Product/1", status: "ACTIVE", publishedOnPublication: true },
        { id: "gid://shopify/Product/2", status: "ACTIVE", publishedOnPublication: false },
      ],
    };
  });

  const result = await executeProductPublicationStatus(store, client, {
    productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
    publicationName: "Shop",
  });

  assert.equal(result.publication.id, "gid://shopify/Publication/2");
  assert.deepEqual(result.products, [
    { id: "gid://shopify/Product/1", status: "ACTIVE", published: true },
    { id: "gid://shopify/Product/2", status: "ACTIVE", published: false },
  ]);
});

test("updates only changed products on one publication and verifies the result", async () => {
  const publishedIds = new Set(["gid://shopify/Product/1"]);
  let mutationInput: unknown;
  const client = clientWithQuery(async (document, variables) => {
    if (document.includes("query PublicationChannels")) {
      return {
        publications: {
          nodes: [{ id: "gid://shopify/Publication/2", catalog: { __typename: "AppCatalog", title: "Shop" } }],
          pageInfo: { hasNextPage: false },
        },
      };
    }
    if (document.includes("mutation UpdatePublicationProducts")) {
      mutationInput = variables?.input;
      for (const id of (variables?.input as { publishablesToAdd: readonly string[] }).publishablesToAdd) {
        publishedIds.add(id);
      }
      return { publicationUpdate: { publication: { id: variables?.id }, userErrors: [] } };
    }
    return {
      nodes: (variables?.ids as readonly string[]).map(id => ({
        id,
        status: "ACTIVE",
        publishedOnPublication: publishedIds.has(id),
      })),
    };
  });

  const result = await executeProductSetPublication(store, client, {
    productIds: ["gid://shopify/Product/1", "gid://shopify/Product/2"],
    publicationName: "Shop",
    published: true,
  });

  assert.deepEqual(mutationInput, { publishablesToAdd: ["gid://shopify/Product/2"] });
  assert.equal(result.changed, 1);
  assert.equal(result.unchanged, 1);
  assert.ok(result.products.every(product => product.published));
});

test("publication targeting rejects ambiguous catalogs, invalid IDs and oversized batches", async () => {
  const ambiguousClient = clientWithQuery(async () => ({
    publications: {
      nodes: [
        { id: "gid://shopify/Publication/1", catalog: { __typename: "AppCatalog", title: "Shop" } },
        { id: "gid://shopify/Publication/2", catalog: { __typename: "AppCatalog", title: "shop" } },
      ],
      pageInfo: { hasNextPage: false },
    },
  }));

  await assert.rejects(
    executeProductPublicationStatus(store, ambiguousClient, {
      productIds: ["gid://shopify/Product/1"],
      publicationName: "Shop",
    }),
    /exactly one/i,
  );
  await assert.rejects(
    executeProductPublicationStatus(store, ambiguousClient, {
      productIds: ["invalid"],
      publicationName: "Shop",
    }),
    /product ID/i,
  );
  await assert.rejects(
    executeProductPublicationStatus(store, ambiguousClient, {
      productIds: Array.from({ length: 101 }, (_, index) => `gid://shopify/Product/${index + 1}`),
      publicationName: "Shop",
    }),
    /100/i,
  );
});
