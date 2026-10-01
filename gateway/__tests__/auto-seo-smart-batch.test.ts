import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import test from "node:test";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import {
  handleAutoSeoEligibilityHttpRequest,
  handleAutoSeoRun,
} from "../auto-seo-handler";
import {
  AutoSeoEligibilityValidationError,
  getAutoSeoEligibility,
  validateAutoSeoEligibilityRequest,
} from "../auto-seo-eligibility";
import {
  calculateAutoSeoInputHash,
  normalizeAutoSeoHashInput,
} from "../auto-seo-input-hash";
import type { AutoSeoProductPayload } from "../seo-content";
import { CustomGptQueue } from "../custom-gpt-seo/queue";

function createProduct(
  overrides: Partial<AutoSeoProductPayload> = {},
): AutoSeoProductPayload {
  return {
    id: "gid://shopify/Product/100",
    storeId: "capozen",
    title: "  Personalized Family Rug  ",
    handle: " personalized-family-rug ",
    description: "Family rug",
    descriptionHtml: "<p>Family rug</p>",
    status: "ACTIVE",
    vendor: "FFP",
    productType: "Rug",
    tags: ["family", "gift"],
    onlineStoreUrl: "https://example.com/products/personalized-family-rug",
    featuredImage: {
      id: "featured",
      url: "https://cdn.example.com/featured.jpg",
      altText: "Family rug",
      width: 1200,
      height: 1200,
    },
    images: [
      {
        id: "image-2",
        url: "https://cdn.example.com/back.jpg",
        altText: "Back",
        position: 2,
      },
      {
        id: "image-1",
        url: "https://cdn.example.com/front.jpg",
        altText: "Front",
        position: 1,
      },
    ],
    variants: [
      {
        id: "variant-2",
        title: "Large",
        price: "59.00",
        inventoryQuantity: 4,
      },
      {
        id: "variant-1",
        title: "Small",
        price: "39.00",
        inventoryQuantity: 8,
      },
    ],
    seo: {
      title: "Family Rug",
      description: "A personalized family rug.",
    },
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-09-30T00:00:00Z",
    hasMoreImages: false,
    hasMoreVariants: false,
    ...overrides,
  };
}

test("SEO input hash is stable for equivalent tag, image, and variant ordering", () => {
  const original = createProduct();
  const reordered = createProduct({
    tags: [" gift ", "family", "family"],
    images: [...(original.images ?? [])].reverse(),
    variants: [...(original.variants ?? [])].reverse(),
  });

  assert.equal(calculateAutoSeoInputHash(original), calculateAutoSeoInputHash(reordered));
  assert.deepEqual(normalizeAutoSeoHashInput(original), normalizeAutoSeoHashInput(reordered));
});

test("SEO input hash changes when grounded SEO source content changes", () => {
  const original = createProduct();
  const changedProducts: readonly AutoSeoProductPayload[] = [
    createProduct({ title: "Updated family rug" }),
    createProduct({ descriptionHtml: "<p>Updated description</p>" }),
    createProduct({ seo: { title: "Updated SEO", description: "A personalized family rug." } }),
    createProduct({ vendor: "Updated vendor" }),
    createProduct({ images: [{ id: "image-1", url: "https://cdn.example.com/new.jpg" }] }),
    createProduct({ variants: [{ id: "variant-1", title: "Small", price: "49.00" }] }),
  ];

  for (const changed of changedProducts) {
    assert.notEqual(calculateAutoSeoInputHash(original), calculateAutoSeoInputHash(changed));
  }
});

test("SEO input hash ignores volatile timestamps, store metadata, pagination flags, and inventory", () => {
  const original = createProduct();
  const changedVolatileFields = createProduct({
    storeId: "another-store",
    createdAt: "2026-02-02T00:00:00Z",
    updatedAt: "2026-10-01T00:00:00Z",
    hasMoreImages: true,
    hasMoreVariants: true,
    variants: [
      { id: "variant-2", title: "Large", price: "59.00", inventoryQuantity: 999 },
      { id: "variant-1", title: "Small", price: "39.00", inventoryQuantity: 0 },
    ],
  });

  assert.equal(
    calculateAutoSeoInputHash(original),
    calculateAutoSeoInputHash(changedVolatileFields),
  );
});

test("auto SEO schema creates the SEO input hash column and lookup index idempotently", () => {
  const db = new DatabaseSync(":memory:");

  initAutoSeoDbSchema(db);
  initAutoSeoDbSchema(db);

  const columns = db.prepare("PRAGMA table_info(auto_seo_product_backups)").all();
  const indexes = db.prepare("PRAGMA index_list(auto_seo_product_backups)").all();
  assert.ok(columns.some((column) => column.name === "seo_input_sha256"));
  assert.ok(indexes.some((index) => index.name === "idx_auto_seo_store_product_input"));
  db.close();
});

test("auto SEO schema migrates a legacy backup table without an SEO input hash", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE auto_seo_product_backups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      backup_id TEXT NOT NULL UNIQUE,
      workflow_id TEXT NOT NULL,
      store_id TEXT NOT NULL,
      shop_domain TEXT NOT NULL,
      product_id TEXT NOT NULL,
      product_handle TEXT NOT NULL,
      product_title TEXT NOT NULL,
      shopify_updated_at TEXT,
      snapshot_json TEXT NOT NULL,
      snapshot_sha256 TEXT NOT NULL,
      downstream_status TEXT NOT NULL,
      downstream_http_status INTEGER,
      downstream_error TEXT,
      downstream_sent_at TEXT,
      created_at TEXT NOT NULL
    );
  `);

  initAutoSeoDbSchema(db);

  const columns = db.prepare("PRAGMA table_info(auto_seo_product_backups)").all();
  assert.ok(columns.some((column) => column.name === "seo_input_sha256"));
  db.close();
});

function insertBackup(
  db: DatabaseSync,
  values: {
    readonly backupId: string;
    readonly storeId?: string;
    readonly productId: string;
    readonly updatedAt?: string | null;
    readonly inputHash?: string | null;
    readonly status: "NOT_SENT" | "SENT" | "FAILED";
    readonly createdAt?: string;
  },
): void {
  db.prepare(`
    INSERT INTO auto_seo_product_backups (
      backup_id, workflow_id, store_id, shop_domain, product_id,
      product_handle, product_title, shopify_updated_at, snapshot_json,
      snapshot_sha256, seo_input_sha256, downstream_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'snapshot', ?, ?, ?)
  `).run(
    values.backupId,
    `workflow-${values.backupId}`,
    values.storeId ?? "capozen",
    "capozen.myshopify.com",
    values.productId,
    `handle-${values.productId}`,
    `Product ${values.productId}`,
    values.updatedAt ?? null,
    values.inputHash ?? null,
    values.status,
    values.createdAt ?? "2026-09-30T00:00:00.000Z",
  );
}

test("eligibility validation accepts 5000 summaries and rejects invalid, duplicate, or excessive input", () => {
  const products = Array.from({ length: 5_000 }, (_, index) => ({
    productId: `product-${index}`,
    updatedAt: "2026-10-01T00:00:00Z",
  }));

  assert.equal(validateAutoSeoEligibilityRequest({ storeId: "capozen", products }).products.length, 5_000);
  for (const invalid of [
    { storeId: "", products: [{ productId: "one" }] },
    { storeId: "capozen", products: [] },
    { storeId: "capozen", products: [{ productId: "one" }, { productId: "one" }] },
    { storeId: "capozen", products: [...products, { productId: "overflow" }] },
  ]) {
    assert.throws(
      () => validateAutoSeoEligibilityRequest(invalid),
      (error: unknown) => error instanceof AutoSeoEligibilityValidationError,
    );
  }
});

test("eligibility classifies never processed, retry, changed, current, and legacy products", () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const queue = new CustomGptQueue(db);
  insertBackup(db, {
    backupId: "failed",
    productId: "retry",
    status: "FAILED",
    updatedAt: "2026-09-20T00:00:00Z",
    inputHash: "retry-hash",
  });
  insertBackup(db, {
    backupId: "changed",
    productId: "changed",
    status: "SENT",
    updatedAt: "2026-09-20T00:00:00Z",
    inputHash: "changed-hash",
  });
  insertBackup(db, {
    backupId: "current",
    productId: "current",
    status: "SENT",
    updatedAt: "2026-09-30T00:00:00Z",
    inputHash: "current-hash",
  });
  insertBackup(db, {
    backupId: "legacy",
    productId: "legacy",
    status: "SENT",
    updatedAt: "2026-09-30T00:00:00Z",
    inputHash: null,
  });

  const response = getAutoSeoEligibility(db, {
    storeId: "capozen",
    products: [
      { productId: "new", updatedAt: "2026-10-01T00:00:00Z" },
      { productId: "retry", updatedAt: "2026-10-01T00:00:00Z" },
      { productId: "changed", updatedAt: "2026-10-01T00:00:00Z" },
      { productId: "current", updatedAt: "2026-09-30T00:00:00Z" },
      { productId: "legacy", updatedAt: "2026-09-30T00:00:00Z" },
    ],
  }, queue);

  assert.deepEqual(
    response.items.map((item) => [item.productId, item.state, item.reason]),
    [
      ["new", "never_processed", "NO_HISTORY"],
      ["retry", "retry", "LAST_DISPATCH_FAILED"],
      ["changed", "changed", "SHOPIFY_UPDATED"],
      ["current", "current", "UP_TO_DATE"],
      ["legacy", "changed", "HASH_VERIFICATION_REQUIRED"],
    ],
  );
  assert.deepEqual(response.counts, {
    never_processed: 1,
    changed: 2,
    current: 1,
    active: 0,
    retry: 1,
  });
  db.close();
});

test("eligibility treats unknown timestamps conservatively and isolates stores", () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const queue = new CustomGptQueue(db);
  insertBackup(db, {
    backupId: "other-store",
    storeId: "other",
    productId: "same-product",
    status: "SENT",
    updatedAt: "2026-09-30T00:00:00Z",
    inputHash: "other-hash",
  });
  insertBackup(db, {
    backupId: "known",
    productId: "known",
    status: "SENT",
    updatedAt: "2026-09-30T00:00:00Z",
    inputHash: "known-hash",
  });

  const response = getAutoSeoEligibility(db, {
    storeId: "capozen",
    products: [
      { productId: "same-product", updatedAt: "2026-10-01T00:00:00Z" },
      { productId: "known" },
      { productId: "known-invalid", updatedAt: "not-a-date" },
    ],
  }, queue);

  assert.equal(response.items[0]?.state, "never_processed");
  assert.equal(response.items[1]?.reason, "SOURCE_TIMESTAMP_UNKNOWN");
  assert.equal(response.items[2]?.state, "never_processed");
  db.close();
});

test("eligibility marks matching queue and pending review revisions active", () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const queue = new CustomGptQueue(db);
  insertBackup(db, {
    backupId: "queue-base",
    productId: "queue-product",
    status: "SENT",
    updatedAt: "2026-10-01T00:00:00Z",
    inputHash: "queue-hash",
  });
  queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "queue-product",
    input: {
      productId: "queue-product",
      title: "Queued product",
      description: "Description",
      handle: "queued-product",
      niche: "Rug",
      images: [],
    },
    original: { updatedAt: "2026-10-01T00:00:00Z" },
  });
  insertBackup(db, {
    backupId: "review-base",
    productId: "review-product",
    status: "SENT",
    updatedAt: "2026-10-01T00:00:00Z",
    inputHash: "review-hash",
  });
  db.prepare(`
    INSERT INTO seo_review_items (
      item_id, store_id, product_id, handle, title, review_status,
      generated_payload, shopify_updated_at
    ) VALUES ('review-item', 'capozen', 'review-product', 'review-product',
      'Review product', 'pending', '{}', '2026-10-01T00:00:00Z')
  `).run();

  const response = getAutoSeoEligibility(db, {
    storeId: "capozen",
    products: [
      { productId: "queue-product", updatedAt: "2026-10-01T00:00:00Z" },
      { productId: "review-product", updatedAt: "2026-10-01T00:00:00Z" },
    ],
  }, queue);

  assert.deepEqual(response.items.map((item) => item.state), ["active", "active"]);
  db.close();
});

interface HttpTestResponse {
  statusCode: number;
  readonly headers: Record<string, string>;
  body: string;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
}

function createHttpResponse(): HttpTestResponse {
  return {
    statusCode: 200,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = "") {
      this.body = body;
    },
  };
}

test("eligibility HTTP handler returns success and safe validation, auth, and method errors", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const queue = new CustomGptQueue(db);

  const successRequest = Readable.from([
    JSON.stringify({
      storeId: "capozen",
      products: [{ productId: "new", updatedAt: "2026-10-01T00:00:00Z" }],
    }),
  ]);
  Object.assign(successRequest, {
    method: "POST",
    headers: { authorization: "Bearer secret" },
  });
  const successResponse = createHttpResponse();
  await handleAutoSeoEligibilityHttpRequest(
    successRequest as never,
    successResponse as never,
    { db, queue, authToken: "secret" },
  );
  assert.equal(successResponse.statusCode, 200);
  assert.equal(JSON.parse(successResponse.body).data.items[0].state, "never_processed");

  for (const scenario of [
    { method: "GET", headers: {}, body: "", expectedStatus: 405 },
    { method: "POST", headers: {}, body: "{}", expectedStatus: 401 },
    {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: "{}",
      expectedStatus: 400,
    },
  ]) {
    const request = Readable.from([scenario.body]);
    Object.assign(request, { method: scenario.method, headers: scenario.headers });
    const response = createHttpResponse();
    await handleAutoSeoEligibilityHttpRequest(
      request as never,
      response as never,
      { db, queue, authToken: "secret" },
    );
    assert.equal(response.statusCode, scenario.expectedStatus);
    assert.equal(JSON.parse(response.body).success, false);
  }
  db.close();
});

test("authoritative run accepts new and changed products and skips unchanged products", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const runnerCalls: readonly AutoSeoProductPayload[][] = [];
  const mutableRunnerCalls = runnerCalls as AutoSeoProductPayload[][];
  const runner = async (input: { readonly products: readonly AutoSeoProductPayload[] }) => {
    mutableRunnerCalls.push([...input.products]);
    return { success: true, processedCount: input.products.length };
  };
  const original = createProduct({ id: "same", updatedAt: "2026-09-30T00:00:00Z" });
  const first = await handleAutoSeoRun({
    workflowId: "first",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [original],
  }, { db, seoContentRunner: runner });
  assert.deepEqual(first.acceptedProductIds, ["same"]);
  assert.equal(first.acceptedCount, 1);
  assert.equal(first.skippedCount, 0);

  const unchanged = await handleAutoSeoRun({
    workflowId: "unchanged",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [createProduct({ id: "same", updatedAt: "2026-10-01T00:00:00Z" })],
  }, { db, seoContentRunner: runner });
  assert.equal(unchanged.acceptedCount, 0);
  assert.deepEqual(unchanged.skippedProducts, [{ productId: "same", reason: "UNCHANGED" }]);

  const changed = await handleAutoSeoRun({
    workflowId: "changed",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [createProduct({ id: "same", title: "Changed title" })],
  }, { db, seoContentRunner: runner });
  assert.deepEqual(changed.acceptedProductIds, ["same"]);
  assert.equal(mutableRunnerCalls.length, 2, "all-skipped run must not call the runner");
  db.close();
});

test("authoritative run retries failed hashes and reports mixed accepted and skipped products", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  const unchanged = createProduct({ id: "unchanged" });
  insertBackup(db, {
    backupId: "sent",
    productId: "unchanged",
    status: "SENT",
    updatedAt: unchanged.updatedAt,
    inputHash: calculateAutoSeoInputHash(unchanged),
  });
  const retry = createProduct({ id: "retry-product" });
  insertBackup(db, {
    backupId: "failed-retry",
    productId: "retry-product",
    status: "FAILED",
    updatedAt: retry.updatedAt,
    inputHash: calculateAutoSeoInputHash(retry),
  });
  const received: AutoSeoProductPayload[] = [];

  const result = await handleAutoSeoRun({
    workflowId: "mixed",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [unchanged, retry],
  }, {
    db,
    seoContentRunner: async (input) => {
      received.push(...input.products);
      return { success: true, processedCount: input.products.length };
    },
  });

  assert.deepEqual(result.acceptedProductIds, ["retry-product"]);
  assert.deepEqual(result.skippedProducts, [{ productId: "unchanged", reason: "UNCHANGED" }]);
  assert.deepEqual(received.map((product) => product.id), ["retry-product"]);
  db.close();
});

test("concurrent identical submissions dispatch once and report an active duplicate", async () => {
  const db = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(db);
  let releaseFirstRun: (() => void) | undefined;
  const firstRunBlocked = new Promise<void>((resolve) => { releaseFirstRun = resolve; });
  let runnerCalls = 0;
  const runner = async (input: { readonly products: readonly AutoSeoProductPayload[] }) => {
    runnerCalls++;
    await firstRunBlocked;
    return { success: true, processedCount: input.products.length };
  };
  const product = createProduct({ id: "concurrent" });
  const firstPromise = handleAutoSeoRun({
    workflowId: "concurrent-one",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [product],
  }, { db, seoContentRunner: runner });
  await new Promise<void>((resolve) => setImmediate(resolve));
  const second = await handleAutoSeoRun({
    workflowId: "concurrent-two",
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    products: [product],
  }, { db, seoContentRunner: runner });
  releaseFirstRun?.();
  const first = await firstPromise;

  assert.equal(first.acceptedCount, 1);
  assert.deepEqual(second.skippedProducts, [{ productId: "concurrent", reason: "ACTIVE_DUPLICATE" }]);
  assert.equal(runnerCalls, 1);
  db.close();
});
