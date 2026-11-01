import assert from "node:assert/strict";
import test from "node:test";

import { GatewayError } from "../errors";
import { executeEtsyListingPreflight } from "../operations/etsy-listing-preflight";
import type { StoreConfig } from "../types";

const store: StoreConfig = {
  storeId: "capozen",
  shopDomain: "example.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test-token" },
};

const readyDefinitions = {
  listingId: {
    type: { name: "single_line_text_field" },
    capabilities: { adminFilterable: { enabled: true, status: "FILTERABLE" } },
  },
  listingUrl: { type: { name: "single_line_text_field" } },
  variantProductId: { type: { name: "single_line_text_field" } },
};

test("Etsy preflight follows product pages instead of declaring a later match missing", async () => {
  const client = { async query<T>(_store: StoreConfig, document: string, variables?: Record<string, unknown>): Promise<T> {
    if (document.includes("query EtsyListingDefinitions")) return readyDefinitions as T;
    if (!variables?.cursor) return { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "page-2" } } } as T;
    return { products: { nodes: [{ id: "gid://shopify/Product/1", title: "Existing", tags: [], listingIdMetafield: { value: "1234567890" },
      listingUrlMetafield: null, variants: { nodes: [] } }], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
  } };
  const result = await executeEtsyListingPreflight(store, client, { listingIds: ["1234567890"] }, "apply");
  assert.equal(result.matches.length, 1);
  assert.deepEqual(result.allowedListingIds, []);
});

test("Etsy preflight creates missing metafield definitions and tolerates legacy url type for etsy_listing_url", async () => {
  const executedDocuments: string[] = [];
  let definitionChecks = 0;

  const client = {
    async query<T>(_store: StoreConfig, document: string): Promise<T> {
      executedDocuments.push(document);
      if (document.includes("query EtsyListingDefinitions")) {
        definitionChecks += 1;
        if (definitionChecks === 1) {
          return {
            listingId: null,
            listingUrl: { type: { name: "url" } },
            variantProductId: null,
          } as T;
        }
        return {
          listingId: readyDefinitions.listingId,
          listingUrl: { type: { name: "url" } },
          variantProductId: readyDefinitions.variantProductId,
        } as T;
      }
      if (document.includes("mutation ")) {
        return {
          metafieldDefinitionCreate: { userErrors: [] },
          metafieldDefinitionUpdate: { userErrors: [] },
        } as T;
      }
      return { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  };

  const result = await executeEtsyListingPreflight(
    store,
    client,
    { listingIds: ["1234567890"] },
    "apply",
  );

  assert.equal(result.ready, true);
  assert.deepEqual(result.allowedListingIds, ["1234567890"]);
  assert.ok(executedDocuments.some((doc) => doc.includes("CreateEtsyListingIdDefinition")));
  assert.ok(executedDocuments.some((doc) => doc.includes("CreateEtsyVariantProductIdDefinition")));
  assert.ok(!executedDocuments.some((doc) => doc.includes("CreateEtsyListingUrlDefinition")));
});

test("Etsy preflight detects duplicates from etsy_listing_id, legacy url, variant etsy_product_id, tags, and SKUs", async () => {
  const client = {
    async query<T>(_store: StoreConfig, document: string, variables?: Record<string, unknown>): Promise<T> {
      if (document.includes("query EtsyListingDefinitions")) {
        return readyDefinitions as T;
      }
      const query = String(variables?.query ?? "");
      if (query === 'metafields.custom.etsy_listing_id:"111111111"') {
        return {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "gid://shopify/Product/101",
                title: "Direct Metafield Match",
                handle: "direct-match",
                tags: [],
                listingIdMetafield: { value: "111111111" },
                listingUrlMetafield: null,
                variants: { nodes: [] },
              },
            ],
          },
        } as T;
      }
      if (query.includes("222222222") && !query.startsWith("metafields.custom.etsy_listing_id:")) {
        return {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "gid://shopify/Product/202",
                title: "Legacy Etsy Variant Match",
                handle: "legacy-variant",
                tags: [],
                listingIdMetafield: null,
                listingUrlMetafield: { value: "https://www.etsy.com/listing/222222222/custom-mug" },
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/9001",
                      sku: "ETSY-888888888",
                      etsyProductIdMetafield: { value: "888888888" },
                    },
                  ],
                },
              },
            ],
          },
        } as T;
      }
      if (query.includes("333333333") && !query.startsWith("metafields.custom.etsy_listing_id:")) {
        return {
          products: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: [
              {
                id: "gid://shopify/Product/303",
                title: "Legacy SKU Match",
                handle: "legacy-sku",
                tags: [],
                listingIdMetafield: null,
                listingUrlMetafield: null,
                variants: {
                  nodes: [
                    {
                      id: "gid://shopify/ProductVariant/9002",
                      sku: "ETSY-333333333-ABCDEF12",
                      etsyProductIdMetafield: null,
                    },
                  ],
                },
              },
            ],
          },
        } as T;
      }
      return { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  };

  const result = await executeEtsyListingPreflight(
    store,
    client,
    {
      listingIds: ["111111111", "222222222", "333333333", "444444444"],
      listings: [
        { listingId: "111111111" },
        { listingId: "222222222", variantProductIds: ["888888888"] },
        { listingId: "333333333" },
        { listingId: "444444444", status: "queue_cleared", databaseStatus: "queue_cleared" },
      ],
    },
    "apply",
  );

  assert.deepEqual(
    result.listings.map((item) => ({ listingId: item.listingId, status: item.status })),
    [
      { listingId: "111111111", status: "existing" },
      { listingId: "222222222", status: "existing" },
      { listingId: "333333333", status: "existing" },
      { listingId: "444444444", status: "queue_cleared" },
    ],
  );
  // Cancelled/cleared queue items must remain allowed to recrawl!
  assert.deepEqual(result.allowedListingIds, ["444444444"]);
});

test("Etsy preflight blocks active processing jobs and fails closed when Shopify cannot be read", async () => {
  const activeClient = {
    async query<T>(_store: StoreConfig, document: string): Promise<T> {
      if (document.includes("query EtsyListingDefinitions")) {
        return readyDefinitions as T;
      }
      return { products: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } as T;
    },
  };

  const activeResult = await executeEtsyListingPreflight(
    store,
    activeClient,
    {
      listingIds: ["555555555", "666666666"],
      listings: [
        { listingId: "555555555", isActiveInSeo: true, activeSeoJobIds: ["seo-job-1"] },
        { listingId: "666666666", status: "available" },
      ],
    },
    "apply",
  );

  assert.equal(activeResult.listings[0]?.status, "processing");
  assert.deepEqual(activeResult.allowedListingIds, ["666666666"]);

  const brokenShopifyClient = {
    async query<T>(_store: StoreConfig, document: string): Promise<T> {
      if (document.includes("query EtsyListingDefinitions")) {
        return readyDefinitions as T;
      }
      return { products: null } as unknown as T;
    },
  };

  await assert.rejects(
    executeEtsyListingPreflight(
      store,
      brokenShopifyClient,
      { listingIds: ["666666666"] },
      "apply",
    ),
    (error: unknown) => {
      assert.ok(error instanceof GatewayError);
      assert.equal(error.code, "SHOPIFY_NETWORK_ERROR");
      return true;
    },
  );
});
