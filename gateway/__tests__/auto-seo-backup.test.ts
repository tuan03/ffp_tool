import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import { calculateSha256, canonicalizeJson } from "../canonical-json";
import {
  AutoSeoStatusUpdateError,
  AutoSeoValidationError,
  handleAutoSeoRun,
  type AutoSeoProductPayload,
  type AutoSeoRunRequest,
  type SeoContentInput,
  type SeoContentRunner,
} from "../auto-seo-handler";
import { runSeoContent } from "../seo-content";

function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
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

function createMockSeoContentRunner(options?: {
  shouldThrow?: boolean;
  errorMessage?: string;
  success?: boolean;
  resultMessage?: string;
}) {
  const calls: SeoContentInput[] = [];
  let callOrder = 0;

  const runner: SeoContentRunner = async (input: SeoContentInput) => {
    callOrder++;
    calls.push(input);
    if (options?.shouldThrow) {
      throw new Error(options.errorMessage ?? "Downstream SEO runner failed");
    }
    return {
      success: options?.success ?? true,
      processedCount: input.products.length,
      message:
        options?.resultMessage ??
        (options?.success === false ? "SEO content generation failed" : "ok"),
    };
  };

  return { runner, calls, getCallOrder: () => callOrder };
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
  const mockRunner = createMockSeoContentRunner();

  const req: AutoSeoRunRequest = {
    workflowId: "wf-1",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1" })],
  };

  const res = await handleAutoSeoRun(req, {
    db,
    seoContentRunner: mockRunner.runner,
  });

  assert.equal(res.backedUpCount, 1);
  assert.equal(mockRunner.calls.length, 1);
  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as unknown as BackupRow[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.workflow_id, "wf-1");
  assert.equal(rows[0]?.product_id, "prod-1");
});

test("2. 3 products -> 3 INSERTs in SQLite", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
    seoContentRunner: mockRunner.runner,
  });

  assert.equal(res.backedUpCount, 3);
  assert.equal(mockRunner.calls.length, 1);
  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as unknown as BackupRow[];
  assert.equal(rows.length, 3);
});

test("3. same workflow_id across rows", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
    seoContentRunner: mockRunner.runner,
  });

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all() as unknown as BackupRow[];
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.workflow_id, "wf-consistent-123");
  }
});

test("4. each product gets own product_id", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
    seoContentRunner: mockRunner.runner,
  });

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups ORDER BY id ASC").all() as unknown as BackupRow[];
  assert.equal(rows[0]?.product_id, "gid://shopify/Product/100");
  assert.equal(rows[1]?.product_id, "gid://shopify/Product/200");
});

test("5. snapshot_json contains exact full product object", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
    { db, seoContentRunner: mockRunner.runner },
  );

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE product_id = ?").get("prod-exact") as unknown as BackupRow;
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
  const mockRunner = createMockSeoContentRunner();

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
    { db, seoContentRunner: mockRunner.runner },
  );

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE product_id = ?").get("prod-sha") as unknown as BackupRow;
  assert.ok(row);
  assert.equal(row.snapshot_json, expectedCanonical);
  assert.equal(row.snapshot_sha256, expectedSha256);
});

test("7. duplicate product IDs in request rejected before DB transaction", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
      await handleAutoSeoRun(req, { db, seoContentRunner: mockRunner.runner });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INVALID_INPUT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockRunner.calls.length, 0);
});

test("8. one INSERT failure -> ROLLBACK of entire transaction", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
      await handleAutoSeoRun(req, { db, seoContentRunner: mockRunner.runner });
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
  assert.equal(mockRunner.calls.length, 0);
});

test("9. DB failure => runner call count 0", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

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
    await handleAutoSeoRun(req, { db, seoContentRunner: mockRunner.runner });
  });

  assert.equal(mockRunner.calls.length, 0);
});

test("10. runner executes only after SQLite commit", async () => {
  const db = createTestDb();
  let rowStatusDuringRunnerCall: string | null = null;
  let rowCountDuringRunnerCall = 0;

  const runner: SeoContentRunner = async (input: SeoContentInput) => {
    // When runner is called, the database transaction has already committed!
    const rows = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").all("wf-order") as unknown as BackupRow[];
    rowCountDuringRunnerCall = rows.length;
    rowStatusDuringRunnerCall = rows[0]?.downstream_status ?? null;
    return { success: true, processedCount: input.products.length };
  };

  await handleAutoSeoRun(
    {
      workflowId: "wf-order",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, seoContentRunner: runner },
  );

  // During runner execution, row was already committed with 'NOT_SENT'
  assert.equal(rowCountDuringRunnerCall, 1);
  assert.equal(rowStatusDuringRunnerCall, "NOT_SENT");

  // After handleAutoSeoRun finishes, row is updated to 'SENT' and downstream_http_status is null
  const finalRow = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-order") as unknown as BackupRow;
  assert.equal(finalRow.downstream_status, "SENT");
  assert.equal(finalRow.downstream_http_status, null);
  assert.ok(typeof finalRow.downstream_sent_at === "string" && finalRow.downstream_sent_at.length > 0);
});

test("11. SEO runner receives exact full products", async () => {
  const db = createTestDb();
  let receivedInput: SeoContentInput | null = null;

  const runner: SeoContentRunner = async (input: SeoContentInput) => {
    receivedInput = input;
    return { success: true, processedCount: input.products.length };
  };

  const product1 = createMockProduct({ id: "p1", title: "Product One" });
  const product2 = createMockProduct({ id: "p2", title: "Product Two" });
  const requestProducts = [product1, product2];

  await handleAutoSeoRun(
    {
      workflowId: "wf-same-products",
      storeId: "store-xyz",
      shopDomain: "shop.myshopify.com",
      products: requestProducts,
    },
    { db, seoContentRunner: runner },
  );

  assert.ok(receivedInput);
  const input = receivedInput as SeoContentInput;
  assert.equal(input.workflowId, "wf-same-products");
  assert.equal(input.storeId, "store-xyz");
  assert.equal(input.shopDomain, "shop.myshopify.com");
  assert.equal(input.products.length, 2);
  // Exactly the same products, no mapping, no copying
  assert.strictEqual(input.products, requestProducts);
  assert.strictEqual(input.products[0], product1);
  assert.strictEqual(input.products[1], product2);
});

test("12. success:true => SENT", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner({ success: true });

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-sent",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, seoContentRunner: mockRunner.runner },
  );

  assert.equal(res.downstreamStatus, "SENT");
  assert.equal(res.downstreamHttpStatus, null);

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-sent") as unknown as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "SENT");
  assert.equal(row.downstream_http_status, null);
  assert.ok(typeof row.downstream_sent_at === "string" && row.downstream_sent_at.length > 0);
});

test("13. success:false => FAILED and backup rows remain", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner({
    success: false,
    resultMessage: "Model quota exceeded",
  });

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-returned-false",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, seoContentRunner: mockRunner.runner },
  );

  assert.equal(res.downstreamStatus, "FAILED");
  assert.equal(res.downstreamHttpStatus, null);
  assert.equal(res.downstreamError, "Model quota exceeded");

  // Backup row remains in database
  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-returned-false") as unknown as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "FAILED");
  assert.equal(row.downstream_http_status, null);
  assert.equal(row.downstream_error, "Model quota exceeded");
  assert.ok(typeof row.downstream_sent_at === "string" && row.downstream_sent_at.length > 0);
});

test("14. runner throw => FAILED and backup rows remain", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner({
    shouldThrow: true,
    errorMessage: "SEO generation crashed with unhandled exception",
  });

  const res = await handleAutoSeoRun(
    {
      workflowId: "wf-failed-downstream",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, seoContentRunner: mockRunner.runner },
  );

  assert.equal(res.downstreamStatus, "FAILED");
  assert.equal(res.downstreamHttpStatus, null);
  assert.equal(res.downstreamError, "SEO generation crashed with unhandled exception");

  // Backup row remains in database
  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-failed-downstream") as unknown as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "FAILED");
  assert.equal(row.downstream_http_status, null);
  assert.equal(row.downstream_error, "SEO generation crashed with unhandled exception");
  assert.ok(typeof row.downstream_sent_at === "string" && row.downstream_sent_at.length > 0);
});

test("15. hasMoreImages=true -> block before INSERT", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

  const req = {
    workflowId: "wf-images",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreImages: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { db, seoContentRunner: mockRunner.runner });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockRunner.calls.length, 0);
});

test("16. hasMoreVariants=true -> block before INSERT", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

  const req = {
    workflowId: "wf-variants",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "prod-1", hasMoreVariants: true })],
  };

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(req, { db, seoContentRunner: mockRunner.runner });
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoValidationError);
      assert.equal(err.code, "AUTO_SEO_INCOMPLETE_SNAPSHOT");
      return true;
    },
  );

  const rows = db.prepare("SELECT * FROM auto_seo_product_backups").all();
  assert.equal(rows.length, 0);
  assert.equal(mockRunner.calls.length, 0);
});

test("17. no fetch/HTTP SEO Content call exists", async () => {
  const db = createTestDb();
  let fetchCalled = false;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    throw new Error("fetch should never be called for SEO Content");
  }) as typeof fetch;

  try {
    const mockRunner = createMockSeoContentRunner();
    await handleAutoSeoRun(
      {
        workflowId: "wf-no-fetch",
        storeId: "store-1",
        shopDomain: "test.myshopify.com",
        products: [createMockProduct({ id: "prod-1" })],
      },
      { db, seoContentRunner: mockRunner.runner },
    );

    assert.equal(fetchCalled, false);
    assert.equal(mockRunner.calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("18. default runSeoContent placeholder returns success", async () => {
  const res = await runSeoContent({
    workflowId: "wf-default",
    storeId: "store-1",
    shopDomain: "test.myshopify.com",
    products: [createMockProduct({ id: "p1" })],
  });
  assert.equal(res.success, true);
  assert.equal(res.processedCount, 1);
  assert.ok(res.message);
});

test("19. status update failure does not rerun SEO Content & throws error", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

  // Create an SQLite trigger that fails the UPDATE
  db.exec(`
    CREATE TRIGGER fail_status_update BEFORE UPDATE ON auto_seo_product_backups
    BEGIN
      SELECT RAISE(ABORT, 'Simulated update downstream failure');
    END;
  `);

  await assert.rejects(
    async () => {
      await handleAutoSeoRun(
        {
          workflowId: "wf-update-fail",
          storeId: "store-1",
          shopDomain: "test.myshopify.com",
          products: [createMockProduct({ id: "prod-1" })],
        },
        { db, seoContentRunner: mockRunner.runner },
      );
    },
    (err: unknown) => {
      assert.ok(err instanceof AutoSeoStatusUpdateError);
      assert.equal(err.code, "AUTO_SEO_STATUS_UPDATE_FAILED");
      assert.match(err.message, /Simulated update downstream failure/);
      return true;
    },
  );

  // Runner was called once and NEVER rerun
  assert.equal(mockRunner.calls.length, 1);

  // Committed backup row remains in SQLite database with original 'NOT_SENT' status
  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-update-fail") as unknown as BackupRow;
  assert.ok(row);
  assert.equal(row.downstream_status, "NOT_SENT");
});

test("20. created_at is ISO UTC format YYYY-MM-DDTHH:MM:SS.sssZ", async () => {
  const db = createTestDb();
  const mockRunner = createMockSeoContentRunner();

  await handleAutoSeoRun(
    {
      workflowId: "wf-created-at",
      storeId: "store-1",
      shopDomain: "test.myshopify.com",
      products: [createMockProduct({ id: "prod-1" })],
    },
    { db, seoContentRunner: mockRunner.runner },
  );

  const row = db.prepare("SELECT * FROM auto_seo_product_backups WHERE workflow_id = ?").get("wf-created-at") as unknown as BackupRow;
  assert.ok(row);
  assert.ok(typeof row.created_at === "string");
  // Check exact ISO UTC format with milliseconds: YYYY-MM-DDTHH:MM:SS.sssZ
  assert.match(row.created_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  // Verify it is a valid date
  const parsedTime = Date.parse(row.created_at);
  assert.equal(Number.isNaN(parsedTime), false);
});
