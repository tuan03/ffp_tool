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

const filterableDefinitions = {
  asin: { type: { name: "single_line_text_field" }, capabilities: { adminFilterable: { enabled: true, status: "FILTERABLE" } } },
  parentAsin: { type: { name: "single_line_text_field" }, capabilities: { adminFilterable: { enabled: true, status: "FILTERABLE" } } },
};

test("preflight allows an unsynced sibling when another product from the parent family exists", async () => {
  const searched: string[] = [];
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      const search = String(variables?.query);
      searched.push(search);
      if (search.includes("amazon_parent_asin")) {
        return { products: { nodes: [{
          id: "gid://shopify/Product/123", title: "Existing family", metafield: { value: "B0CHILD001" },
          parentMetafield: { value: "B0PARENT01" },
        }] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD002"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD002"], memberAsins: ["B0CHILD001", "B0CHILD002"],
      isResolved: true, databaseStatus: null, jobId: null, recoveredStaleRegistry: true,
      hasSyncedFamilyMembers: true,
    }],
  }, "apply");

  assert.deepEqual(result.matches.map((match) => match.asin), ["B0CHILD001"]);
  assert.equal(result.families[0]?.status, "available");
  assert.equal(result.families[0]?.hasExistingFamilyProducts, true);
  assert.deepEqual(result.allowedAsins, ["B0CHILD002"]);
  assert.deepEqual(searched, [
    'metafields.custom.amazon_asin:"B0CHILD002"',
    'metafields.custom.amazon_parent_asin:"B0PARENT01"',
  ]);
});

test("preflight reuses an exact requested ASIN as an incremental family discovery seed", async () => {
  const searched: string[] = [];
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      const search = String(variables?.query);
      searched.push(search);
      if (search === 'metafields.custom.amazon_asin:"B0CHILD002"') {
        return { products: { nodes: [{
          id: "gid://shopify/Product/456", title: "Exact child", metafield: { value: "B0CHILD002" },
          parentMetafield: { value: "B0PARENT01" },
        }] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD002"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD002"], memberAsins: ["B0CHILD001", "B0CHILD002"],
      isResolved: true, databaseStatus: "synced", jobId: "job-1",
    }],
  }, "apply");

  assert.equal(result.families[0]?.status, "available");
  assert.equal(result.families[0]?.hasExistingFamilyProducts, true);
  assert.deepEqual(result.allowedAsins, ["B0CHILD002"]);
  assert.deepEqual(searched, [
    'metafields.custom.amazon_asin:"B0CHILD002"',
    'metafields.custom.amazon_parent_asin:"B0PARENT01"',
  ]);
});

test("preflight uses an unresolved exact ASIN as a family discovery seed", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      const search = String(variables?.query);
      if (search === 'metafields.custom.amazon_asin:"B0PARENT01"') {
        return { products: { nodes: [{
          id: "gid://shopify/Product/789", title: "Existing seed", metafield: { value: "B0PARENT01" },
          parentMetafield: null,
        }] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0PARENT01"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0PARENT01"], memberAsins: ["B0PARENT01"],
      isResolved: false, databaseStatus: null, jobId: null,
    }],
  }, "apply");

  assert.equal(result.matches[0]?.asin, "B0PARENT01");
  assert.equal(result.families[0]?.status, "available");
  assert.equal(result.families[0]?.hasExistingFamilyProducts, true);
  assert.deepEqual(result.allowedAsins, ["B0PARENT01"]);
});

test("preflight recovers an unresolved family parent from the exact Shopify product", async () => {
  const searched: string[] = [];
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      const search = String(variables?.query);
      searched.push(search);
      if (search === 'metafields.custom.amazon_asin:"B0CHILD001"') {
        return { products: { nodes: [{
          id: "gid://shopify/Product/123", title: "Existing seed", metafield: { value: "B0CHILD001" },
          parentMetafield: { value: "B0PARENT01" },
        }] } } as T;
      }
      if (search === 'metafields.custom.amazon_parent_asin:"B0PARENT01"') {
        return { products: { nodes: [
          {
            id: "gid://shopify/Product/123", title: "Existing seed", metafield: { value: "B0CHILD001" },
            parentMetafield: { value: "B0PARENT01" },
          },
          {
            id: "gid://shopify/Product/456", title: "Existing sibling", metafield: { value: "B0CHILD002" },
            parentMetafield: { value: "B0PARENT01" },
          },
        ] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"],
    families: [{
      parentAsin: "B0CHILD001", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"],
      isResolved: false, databaseStatus: null, jobId: null,
    }],
  }, "apply");

  assert.equal(result.families[0]?.parentAsin, "B0PARENT01");
  assert.equal(result.families[0]?.status, "available");
  assert.deepEqual(result.matches.map((match) => match.asin), ["B0CHILD001", "B0CHILD002"]);
  assert.deepEqual(result.allowedAsins, ["B0CHILD001"]);
  assert.deepEqual(searched, [
    'metafields.custom.amazon_asin:"B0CHILD001"',
    'metafields.custom.amazon_parent_asin:"B0PARENT01"',
  ]);
});

test("preflight keeps available families while blocking a crawled family pending sync", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001", "B0NEW00001"],
    families: [
      { parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"], isResolved: true, databaseStatus: "crawled", jobId: "job-1" },
      { parentAsin: "B0NEW00001", inputAsins: ["B0NEW00001"], memberAsins: ["B0NEW00001"], isResolved: false, databaseStatus: null, jobId: null },
    ],
  }, "apply");

  assert.equal(result.families[0]?.status, "crawled_pending_sync");
  assert.equal(result.families[1]?.status, "available");
  assert.deepEqual(result.allowedAsins, ["B0NEW00001"]);
});

test("preflight identifies a family cleared from SEO Queue without automatically recrawling it", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: [] } } as T;
    },
  };
  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"],
      isResolved: true, databaseStatus: "queue_cleared", jobId: "job-hidden",
    }],
  }, "apply");

  assert.equal(result.families[0]?.status, "queue_cleared");
  assert.deepEqual(result.allowedAsins, []);
});

test("preflight does not treat a historical DB mapping as a live Shopify product", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: [] } } as T;
    },
  };
  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"],
    families: [{ parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"],
      isResolved: true, databaseStatus: "synced", hasSyncedFamilyMembers: true }],
  }, "apply");
  assert.equal(result.families[0]?.status, "reconciliation_required");
  assert.equal(result.families[0]?.hasExistingFamilyProducts, false);
  assert.deepEqual(result.allowedAsins, []);
});

test("preflight allows a deliberately released family to be crawled again", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: [] } } as T;
    },
  };
  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"],
      isResolved: true, databaseStatus: "released", jobId: "job-hidden",
    }],
  }, "apply");

  assert.equal(result.families[0]?.status, "available");
  assert.deepEqual(result.allowedAsins, ["B0CHILD001"]);
});

test("a deleted requested synced ASIN needs reconciliation even when Shopify has live siblings", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: String(variables?.query).includes("amazon_parent_asin") ? [{
        id: "gid://shopify/Product/456", title: "Live sibling", metafield: { value: "B0CHILD002" },
        parentMetafield: { value: "B0PARENT01" },
      }] : [] } } as T;
    },
  };
  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"], families: [{ parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"],
      memberAsins: ["B0CHILD001", "B0CHILD002"], isResolved: true, databaseStatus: "synced",
      hasSyncedFamilyMembers: true, inputSyncedAsins: ["B0CHILD001"] }],
  }, "apply");
  assert.equal(result.families[0]?.status, "reconciliation_required");
  assert.deepEqual(result.allowedAsins, []);
  assert.equal(result.matches[0]?.asin, "B0CHILD002");
});

test("preflight does not start incremental discovery while the family is pending sync", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string, variables?: Record<string, unknown>): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      const search = String(variables?.query);
      if (search.includes("amazon_asin")) {
        return { products: { nodes: [{
          id: "gid://shopify/Product/456", title: "Existing child", metafield: { value: "B0CHILD001" },
          parentMetafield: { value: "B0PARENT01" },
        }] } } as T;
      }
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001"], memberAsins: ["B0CHILD001"],
      isResolved: true, databaseStatus: "crawled", jobId: "job-pending",
    }],
  }, "apply");

  assert.equal(result.families[0]?.status, "crawled_pending_sync");
  assert.deepEqual(result.allowedAsins, []);
});

test("preflight schedules only one input when known siblings share an available family", async () => {
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      return { products: { nodes: [] } } as T;
    },
  };

  const result = await executeAmazonAsinPreflight(store, client, {
    asins: ["B0CHILD001", "B0CHILD002"],
    families: [{
      parentAsin: "B0PARENT01", inputAsins: ["B0CHILD001", "B0CHILD002"],
      memberAsins: ["B0CHILD001", "B0CHILD002"], isResolved: true, databaseStatus: null, jobId: null,
    }],
  }, "apply");

  assert.deepEqual(result.allowedAsins, ["B0CHILD001"]);
});

test("preflight enables both ASIN definitions and blocks while Shopify indexes either definition", async () => {
  let definitionReads = 0;
  const mutations: string[] = [];
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) {
        definitionReads++;
        return (definitionReads === 1 ? { asin: null, parentAsin: null } : {
          asin: { type: { name: "single_line_text_field" }, capabilities: { adminFilterable: { enabled: true, status: "FILTERABLE" } } },
          parentAsin: { type: { name: "single_line_text_field" }, capabilities: { adminFilterable: { enabled: true, status: "IN_PROGRESS" } } },
        }) as T;
      }
      if (query.includes("metafieldDefinitionCreate")) {
        mutations.push(query);
        return { metafieldDefinitionCreate: { userErrors: [] } } as T;
      }
      throw new Error("Product lookup must not run while indexing.");
    },
  };

  assert.deepEqual(await executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "apply"), {
    ready: false, matches: [], families: [], allowedAsins: [],
  });
  assert.equal(mutations.length, 2);
});

test("preflight fails closed after two Shopify lookup failures", async () => {
  let attempts = 0;
  const client = {
    async query<T>(_store: StoreConfig, query: string): Promise<T> {
      if (query.includes("query AmazonAsinDefinitions")) return filterableDefinitions as T;
      attempts++;
      throw new Error("Shopify unavailable");
    },
  };

  await assert.rejects(executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "apply"), /Shopify unavailable/);
  assert.equal(attempts, 2);
});

test("preflight rejects invalid ASINs and never mutates Shopify in preview", async () => {
  const client = { async query<T>(): Promise<T> { throw new Error("Shopify must not be called"); } };
  await assert.rejects(executeAmazonAsinPreflight(store, client, { asins: ["not-an-asin"] }, "apply"));
  await assert.rejects(executeAmazonAsinPreflight(store, client, { asins: ["B012345678"] }, "preview"));
});
