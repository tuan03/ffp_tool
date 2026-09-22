import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import { calculateSha256, canonicalizeJson } from "../canonical-json";
import {
  AutoSeoValidationError,
  handleAutoSeoRun,
  type AutoSeoProductPayload,
  type AutoSeoRunRequest,
} from "../auto-seo-handler";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("foreign_keys = ON");
  initAutoSeoDbSchema(db);
  return db;
}

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

interface BackupRow {
  id: number;
  backup_id: string;
  workflow_id: string;
  store_id: string;
  shop_domain: string;
  product_id: string;
  product_handle: string;
  product_title: string;
  shopify_updated_at: string | null;
  snapshot_json: string;
  snapshot_sha256: string;
  downstream_status: "NOT_SENT" | "SENT" | "FAILED";
  downstream_http_status: number | null;
  downstream_error: string | null;
  downstream_sent_at: string | null;
  created_at: string;
}

test("1. one product -> one INSERT in SQLite", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-1",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1" })],
  };

  const res = await handleAutoSeoRun(req, {
    db,
    fetchFn: mockFetch.fetchFn,
  });

  assert.equal(res.backedUpCount, 1);
  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as BackupRow[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.workflow_id, "wf-1");
  assert.equal(rows[0]?.product_id, "prod-1");
});

test("2. 3 products -> 3 INSERTs in SQLite", async () => {
  const db = createTestDb();
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
    db,
    fetchFn: mockFetch.fetchFn,
  });

  assert.equal(res.backedUpCount, 3);
  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as BackupRow[];
  assert.equal(rows.length, 3);
});

test("3. same workflow_id across rows", async () => {
  const db = createTestDb();
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
    db,
    fetchFn: mockFetch.fetchFn,
  });

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as BackupRow[];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.workflow_id, "wf-consistent-123");
  }
});

test("4. each product gets own product_id", async () => {
  const db = createTestDb();
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
    db,
    fetchFn: mockFetch.fetchFn,
  });

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups ORDER BY id ASC").all() as BackupRow[];
  assert.equal(rows[0]?.product_id, "gid://shopify/Product/100");
  assert.equal(rows[1]?.product_id, "gid://shopify/Product/200");
});

test("5. snapshot_json contains exact full product object", async () => {
  const db = createTestDb();
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
    { db, fetchFn: mockFetch.fetchFn },
  );

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE product_id = ?").get("prod-exact") as BackupRow;
  assert.ok(row);
  const parsed = JSON.parse(row.snapshot_json);

  assert.equal(parsed.id, "prod-exact");
  assert.equal(parsed.title, "Exact Title");
  assert.equal(parsed.descriptionHtml, "<p>Original HTML description</p>");
  assert.deepEqual(parsed.tags, ["tagA", "tagB"]);
  assert.deepEqual(parsed.seo, { title: "Custom SEO Title", description: "Custom SEO Desc" });
});

test("6. SHA-256 generated from full canonical JSON", async () => {
  const db = createTestDb();
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
    { db, fetchFn: mockFetch.fetchFn },
  );

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE product_id = ?").get("prod-sha") as BackupRow;
  assert.ok(row);
  assert.equal(row.snapshot_json, expectedCanonical);
  assert.equal(row.snapshot_sha256, expectedSha256);
});

test("7. duplicate product IDs in request rejected before DB transaction", async () => {
  const db = createTestDb();
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
      await handleAutoSeoRun(req, { db, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INVALID_INPUT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});

test("8. one INSERT failure -> ROLLBACK of entire transaction", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch();

  // Pre-insert a row with workflow "wf-conflict", store "store-1", product "prod-fail"
  db.prepare(`
    INSERT INTO auto_seo_product_backups (
      backup_id, workflow_id, store_id, shop_domain, product_id, product_handle,
      product_title, snapshot_json, snapshot_sha256, downstream_status
    ) VALUES ('b-existing', 'wf-conflict', 'store-1', 'test.myshopify.com', 'prod-fail', 'fail', 'Fail', '{}', 'hash', 'NOT_SENT')
  `).run();

  const req = {
    workflowId: "wf-conflict",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [
      createMockProduct({ id: "prod-ok" }),
      createMockProduct({ id: "prod-fail" }), // Violates UNIQUE (workflow_id, store_id, product_id)
    ],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { db, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /UNIQUE constraint failed/);
      return true;
    },
  );

  // prod-ok MUST NOT be inserted because the transaction rolled back!
  const okRow = db.prepare("SELECT * FROM auto_seo_product_backups WHERE product_id = ?").get("prod-ok");
  assert.equal(okRow, undefined);

  // Only the pre-existing row remains
  const allRows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(allRows.length, 1);
});

test("9. backup failure -> downstream call count 0", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch();

  // Pre-insert to cause unique constraint violation
  db.prepare(`
    INSERT INTO auto_seo_product_backups (
      backup_id, workflow_id, store_id, shop_domain, product_id, product_handle,
      product_title, snapshot_json, snapshot_sha256, downstream_status
    ) VALUES ('b-existing', 'wf-fail-downstream', 'store-1', 'test.myshopify.com', 'prod-1', 'h', 't', '{}', 'hash', 'NOT_SENT')
  `).run();

  const req = {
    workflowId: "wf-fail-downstream",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1" })],
  };

  await assert.rejects(async () => {
    await handleAutoSeoRun(req, { db, fetchFn: mockFetch.fetchFn });
  });

  assert.equal(mockFetch.calls.length, 0);
});

test("10. downstream API occurs only AFTER COMMIT", async () => {
  const db = createTestDb();
  let rowStatusDuringFetch: string | null = null;
  let rowCountDuringFetch = 0;

  const fetchFn = async (): Promise<Response> => {
    // When downstream is called, the database transaction has already committed!
    const rows = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").all("wf-order") as BackupRow[];
    rowCountDuringFetch = rows.length;
    rowStatusDuringFetch = rows[0]?.downstream_status ?? null;

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
    { db, fetchFn: fetchFn as typeof fetch },
  );

  // During downstream call, row was already committed with 'NOT_SENT'
  assert.equal(rowCountDuringFetch, 1);
  assert.equal(rowStatusDuringFetch, "NOT_SENT");

  // After handleAutoSeoRun finishes, row is updated to 'SENT'
  const finalRow = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-order") as BackupRow;
  assert.equal(finalRow.downstream_status, "SENT");
});

test("11. downstream receives same products as backed up", async () => {
  const db = createTestDb();
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
    { db, fetchFn: fetchFn as typeof fetch },
  );

  const payload = receivedBody as { workflowId: string; products: AutoSeoProductPayload[] };
  assert.equal(payload.workflowId, "wf-same-products");
  assert.equal(payload.products.length, 2);
  assert.equal(payload.products[0]?.id, "p1");
  assert.equal(payload.products[1]?.id, "p2");
});

test("12. downstream 2xx -> SENT and downstream_sent_at is set", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch(200, "OK");

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-sent",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, fetchFn: mockFetch.fetchFn },
  );

  assert.equal(res.downstreamStatus, "SENT");
  assert.equal(res.downstreamHttpStatus, 200);

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-sent") as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "SENT");
  assert.equal(row.downstream_http_status, 200);
  assert.ok(typeof row.downstream_sent_at === "string" && row.downstream_sent_at.length > 0);
});

test("13. downstream failure -> FAILED and rows remain in DB", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch(502, "Bad Gateway");

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-failed-downstream",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, fetchFn: mockFetch.fetchFn },
  );

  assert.equal(res.downstreamStatus, "FAILED");
  assert.equal(res.downstreamHttpStatus, 502);

  // Backup row remains in database
  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-failed-downstream") as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "FAILED");
  assert.equal(row.downstream_http_status, 502);
  assert.ok(row.downstream_error?.includes("502"));
  assert.ok(typeof row.downstream_sent_at === "string" && row.downstream_sent_at.length > 0);
});

test("14. hasMoreImages=true -> block before INSERT", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-images",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreImages: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { db, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});

test("15. hasMoreVariants=true -> block before INSERT", async () => {
  const db = createTestDb();
  const mockFetch = createMockFetch();

  const req = {
    workflowId: "wf-variants",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreVariants: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { db, fetchFn: mockFetch.fetchFn });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockFetch.calls.length, 0);
});
