import assert from "node:assert/strict";
import test from "node:test";
import type { Pool, PoolConnection } from "mysql2/promise";

import { calculateSha256, canonicalizeJson } from "../canonical-json";
import {
  AutoSeoValidationError,
  handleAutoSeoRun,
  type AutoSeoProductPayload,
  type AutoSeoRunRequest,
} from "../auto-seo-handler";

function createMockProduct(overrides?: Partial<AutoSeoProductPayload>): AutoSeoProductPayload {
  return {
    id: "gid://shopify/Product/1",
    title: "Test Product 1",
    handle: "test-product-1",
    description: "Description text",
    descriptionHtml: "<p>Description text</p>",
    status: "ACTIVE",
    vendor: "CHILLGEN",
    productType: "Apparel",
    tags: ["shirt", "cotton"],
    onlineStoreUrl: "https://example.myshopify.com/products/test-product-1",
    featuredImage: { id: "img-1", url: "https://example.com/1.jpg" },
    images: [{ id: "img-1", url: "https://example.com/1.jpg" }],
    variants: [{ id: "var-1", title: "Default", price: "19.99" }],
    seo: { title: "SEO Title", description: "SEO Desc" },
    hasMoreVariants: false,
    hasMoreImages: false,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-02T00:00:00Z",
    ...overrides,
  };
}

interface ExecutedQuery {
  sql: string;
  values: unknown[];
  order: number;
}

function createMockDbHarness(options?: {
  failOnInsertIndex?: number;
}) {
  let sequence = 0;
  const queries: ExecutedQuery[] = [];
  const events: string[] = [];

  let inTransaction = false;
  let committed = false;
  let rolledBack = false;
  let released = false;
  let insertCount = 0;

  const mockConn: Partial<PoolConnection> = {
    async beginTransaction() {
      inTransaction = true;
      events.push("beginTransaction");
    },
    async commit() {
      committed = true;
      inTransaction = false;
      events.push("commit");
    },
    async rollback() {
      rolledBack = true;
      inTransaction = false;
      events.push("rollback");
    },
    release() {
      released = true;
      events.push("release");
    },
    execute: (async (sql: unknown, values?: unknown) => {
      const currentOrder = ++sequence;
      const normalizedSql = typeof sql === "string" ? sql.trim() : "";
      if (normalizedSql.toUpperCase().startsWith("INSERT")) {
        insertCount++;
        if (options?.failOnInsertIndex === insertCount) {
          throw new Error(`Simulated database insert failure on row ${insertCount}`);
        }
      }
      queries.push({
        sql: normalizedSql,
        values: Array.isArray(values) ? values : [],
        order: currentOrder,
      });
      return [[] as unknown, [] as unknown];
    }) as unknown as PoolConnection["execute"],
  };

  const poolQueries: ExecutedQuery[] = [];
  const mockPool: Partial<Pool> = {
    async getConnection() {
      return mockConn as PoolConnection;
    },
    execute: (async (sql: unknown, values?: unknown) => {
      const currentOrder = ++sequence;
      poolQueries.push({
        sql: typeof sql === "string" ? sql.trim() : "",
        values: Array.isArray(values) ? values : [],
        order: currentOrder,
      });
      return [[] as unknown, [] as unknown];
    }) as unknown as Pool["execute"],
  };

  return {
    mockPool: mockPool as Pool,
    mockConn: mockConn as PoolConnection,
    queries,
    poolQueries,
    events,
    getInTransaction: () => inTransaction,
    getCommitted: () => committed,
    getRolledBack: () => rolledBack,
    getReleased: () => released,
    getInsertCount: () => insertCount,
    getSequence: () => sequence,
  };
}

function createMockFetch(status = 200, statusText = "OK") {
  const calls: Array<{ url: string; options?: RequestInit; callOrder: number }> = [];
  let callOrder = 0;

  const fetchFn = async (url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    callOrder++;
    calls.push({ url: String(url), options, callOrder });
    return {
      ok: status >= 200 && status <= 299,
      status,
      statusText,
      json: async () => ({}),
      text: async () => (status >= 200 && status <= 299 ? "ok" : "error response"),
    } as unknown as Response;
  };

  return { fetchFn: fetchFn as typeof fetch, calls, getCallOrder: () => callOrder };
}

test("1. one product -> one INSERT", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-1",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1" })],
  };

  const res = await handleAutoSeoRun(req, {
    pool: db.mockPool,
    fetchFn: mockFetch.fetchFn,
  });

  assert.equal(res.backedUpCount, 1);
  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  assert.equal(insertQueries.length, 1);
  assert.equal(db.getCommitted(), true);
  assert.equal(db.getRolledBack(), false);
});

test("2. 3 products -> 3 INSERTs", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-3",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "prod-1" }),
      createMockProduct({ id: "prod-2" }),
      createMockProduct({ id: "prod-3" }),
    ],
  };

  const res = await handleAutoSeoRun(req, {
    pool: db.mockPool,
    fetchFn: mockFetch.fetchFn,
  });

  assert.equal(res.backedUpCount, 3);
  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  assert.equal(insertQueries.length, 3);
});

test("3. same workflow_id across rows", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-consistent-123",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "prod-1" }),
      createMockProduct({ id: "prod-2" }),
    ],
  };

  await handleAutoSeoRun(req, {
    pool: db.mockPool,
    fetchFn: mockFetch.fetchFn,
  });

  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  for (const query of insertQueries) {
    // column 2 in VALUES: workflow_id
    assert.equal(query.values[1], "wf-consistent-123");
  }
});

test("4. each product gets own product_id", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-4",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "gid://shopify/Product/100" }),
      createMockProduct({ id: "gid://shopify/Product/200" }),
    ],
  };

  await handleAutoSeoRun(req, {
    pool: db.mockPool,
    fetchFn: mockFetch.fetchFn,
  });

  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  assert.equal(insertQueries[0]?.values[4], "gid://shopify/Product/100");
  assert.equal(insertQueries[1]?.values[4], "gid://shopify/Product/200");
});

test("5. snapshot_json contains exact full product object", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const product = createMockProduct({
    id: "prod-exact",
    title: "Exact Title",
    handle: "exact-handle",
    descriptionHtml: "<p>Original HTML description</p>",
    tags: ["tagA", "tagB"],
    seo: { title: "Custom SEO Title", description: "Custom SEO Desc" },
  });

  await handleAutoSeoRun(
    {
      workflowId: "wf-exact",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [product],
    },
    { pool: db.mockPool, fetchFn: mockFetch.fetchFn },
  );

  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  const storedJson = insertQueries[0]?.values[8] as string;
  const parsed = JSON.parse(storedJson);

  assert.equal(parsed.id, "prod-exact");
  assert.equal(parsed.title, "Exact Title");
  assert.equal(parsed.descriptionHtml, "<p>Original HTML description</p>");
  assert.deepEqual(parsed.tags, ["tagA", "tagB"]);
  assert.deepEqual(parsed.seo, { title: "Custom SEO Title", description: "Custom SEO Desc" });
});

test("6. SHA-256 generated from full canonical JSON", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const product = createMockProduct({ id: "prod-sha" });
  const expectedCanonical = canonicalizeJson(product);
  const expectedSha256 = calculateSha256(expectedCanonical);

  await handleAutoSeoRun(
    {
      workflowId: "wf-sha",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [product],
    },
    { pool: db.mockPool, fetchFn: mockFetch.fetchFn },
  );

  const insertQueries = db.queries.filter((q) => q.sql.toUpperCase().startsWith("INSERT"));
  const storedJson = insertQueries[0]?.values[8] as string;
  const storedSha = insertQueries[0]?.values[9] as string;

  assert.equal(storedJson, expectedCanonical);
  assert.equal(storedSha, expectedSha256);
});

test("7. duplicate product IDs rejected before DB transaction", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-dupe",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "duplicate-id" }),
      createMockProduct({ id: "duplicate-id" }),
    ],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { pool: db.mockPool, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INVALID_INPUT");
      return true;
    },
  );

  assert.equal(db.events.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});

test("8. one INSERT failure -> ROLLBACK", async () => {
  const db = createMockDbHarness({ failOnInsertIndex: 2 });
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-rollback",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "prod-ok" }),
      createMockProduct({ id: "prod-fail" }),
    ],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { pool: db.mockPool, fetchFn: mockFetch.fetchFn });
    },
    /Simulated database insert failure on row 2/,
  );

  assert.equal(db.getRolledBack(), true);
  assert.equal(db.getCommitted(), false);
  assert.equal(db.getReleased(), true);
});

test("9. backup failure -> downstream call count 0", async () => {
  const db = createMockDbHarness({ failOnInsertIndex: 1 });
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-fail-downstream",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1" })],
  };

  await assert.rejects(async () => {
    await handleAutoSeoRun(req, { pool: db.mockPool, fetchFn: mockFetch.fetchFn });
  });

  assert.equal(mockFetch.calls.length, 0);
});

test("10. downstream API occurs only AFTER COMMIT", async () => {
  const db = createMockDbHarness();
  const timeline: string[] = [];

  const originalCommit = db.mockConn.commit.bind(db.mockConn);
  db.mockConn.commit = async () => {
    timeline.push("COMMIT");
    await originalCommit();
  };

  const fetchFn = async (): Promise<Response> => {
    timeline.push("DOWNSTREAM_FETCH");
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "ok",
    } as unknown as Response;
  };

  await handleAutoSeoRun(
    {
      workflowId: "wf-order",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { pool: db.mockPool, fetchFn: fetchFn as typeof fetch },
  );

  assert.deepEqual(timeline, ["COMMIT", "DOWNSTREAM_FETCH"]);
});

test("11. downstream receives same products as backed up", async () => {
  const db = createMockDbHarness();
  let receivedBody: unknown = null;

  const fetchFn = async (_url: RequestInfo | URL, options?: RequestInit): Promise<Response> => {
    receivedBody = JSON.parse(options?.body as string);
    return {
      ok: true,
      status: 200,
      json: async () => ({}),
      text: async () => "ok",
    } as unknown as Response;
  };

  const product1 = createMockProduct({ id: "p1", title: "Product One" });
  const product2 = createMockProduct({ id: "p2", title: "Product Two" });

  await handleAutoSeoRun(
    {
      workflowId: "wf-same-products",
      storeId: "store-xyz",
      shopDomain: "shop.myshopify.com",
      products: [product1, product2],
    },
    { pool: db.mockPool, fetchFn: fetchFn as typeof fetch },
  );

  const payload = receivedBody as { workflowId: string; products: AutoSeoProductPayload[] };
  assert.equal(payload.workflowId, "wf-same-products");
  assert.equal(payload.products.length, 2);
  assert.equal(payload.products[0]?.id, "p1");
  assert.equal(payload.products[1]?.id, "p2");
});

test("12. downstream 2xx -> SENT", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch(200, "OK");

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-sent",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { pool: db.mockPool, fetchFn: mockFetch.fetchFn },
  );

  assert.equal(res.downstreamStatus, "SENT");
  assert.equal(res.downstreamHttpStatus, 200);

  const updateQuery = db.poolQueries.find((q) => q.sql.includes("UPDATE auto_seo_product_backups"));
  assert.ok(updateQuery);
  assert.equal(updateQuery.values[0], "SENT");
  assert.equal(updateQuery.values[1], 200);
});

test("13. downstream failure -> FAILED and rows remain", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch(502, "Bad Gateway");

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-failed-downstream",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { pool: db.mockPool, fetchFn: mockFetch.fetchFn },
  );

  assert.equal(res.downstreamStatus, "FAILED");
  assert.equal(res.downstreamHttpStatus, 502);

  // DB transaction was NOT rolled back because downstream failed after COMMIT
  assert.equal(db.getCommitted(), true);
  assert.equal(db.getRolledBack(), false);

  const updateQuery = db.poolQueries.find((q) => q.sql.includes("UPDATE auto_seo_product_backups"));
  assert.ok(updateQuery);
  assert.equal(updateQuery.values[0], "FAILED");
  assert.equal(updateQuery.values[1], 502);
});

test("14. hasMoreImages=true -> block before INSERT", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-images",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreImages: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { pool: db.mockPool, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  assert.equal(db.events.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});

test("15. hasMoreVariants=true -> block before INSERT", async () => {
  const db = createMockDbHarness();
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-variants",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreVariants: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { pool: db.mockPool, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  assert.equal(db.events.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});
