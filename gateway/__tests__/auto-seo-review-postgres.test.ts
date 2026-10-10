import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type http from "node:http";
import { Readable } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { Pool } from "pg";

import { handleAutoSeoRun } from "../auto-seo-handler";
import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "../auto-seo-postgres-repository";
import { AutoSeoPostgresReviewRepository } from "../auto-seo-review-postgres";
import { handleSeoReviewHttpRequest } from "../seo-review-handler";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const schema = "auto_seo_b4_test";
const prefix = `b4-test-${randomUUID()}`;
const shopifyGid = "gid://shopify/Product/8484620664917";
const shopifyItemId = `capozen:${shopifyGid}`;
let backupRepository: AutoSeoPostgresRepository;
let reviewRepository: AutoSeoPostgresReviewRepository;

function legacyReviewCount(): number | null {
  const source = new DatabaseSync(".local-data/auto-seo.sqlite3", { readOnly: true });
  try {
    const table = source.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='seo_review_items'").get();
    return table ? Number(source.prepare("SELECT COUNT(*) AS count FROM seo_review_items").get()?.count) : null;
  } finally { source.close(); }
}

async function request(method: string, url: string, body?: unknown, repository: Pick<AutoSeoPostgresReviewRepository, "listHydrated" | "findHydrated" | "updateStatus" | "updatePayload"> = reviewRepository): Promise<{ status: number; body: Record<string, unknown> }> {
  const input = body === undefined ? "" : JSON.stringify(body);
  const req = Readable.from(input ? [Buffer.from(input)] : []) as http.IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = { "content-type": "application/json" };
  let status = 200;
  let output = "";
  const res = {
    get statusCode() { return status; },
    set statusCode(value: number) { status = value; },
    setHeader() {},
    end(value: string) { output += value; },
  } as unknown as http.ServerResponse;
  await handleSeoReviewHttpRequest(req, res, { autoSeoReviewRepository: repository });
  return { status, body: JSON.parse(output) as Record<string, unknown> };
}

function backup(suffix: string) {
  const product = { id: `product-${suffix}`, title: `Original ${suffix}`, handle: `original-${suffix}`, descriptionHtml: "<p>Original</p>", seo: { title: "Old SEO", description: "Old description" } };
  return {
    backupId: randomUUID(), workflowId: `${prefix}-${suffix}`, storeId: "b4-store",
    shopDomain: "b4-store.myshopify.com", productId: product.id,
    productHandle: product.handle, productTitle: product.title,
    snapshotJson: JSON.stringify(product), snapshotSha256: "a".repeat(64),
  };
}

if (databaseUrl) {
  before(async () => {
    requireLocalAutoSeoDatabase(databaseUrl);
    backupRepository = new AutoSeoPostgresRepository({ databaseUrl, schema });
    await backupRepository.verifyLocalTarget();
    await backupRepository.initializeSchema();
    reviewRepository = new AutoSeoPostgresReviewRepository({ databaseUrl, schema });
    await reviewRepository.initializeSchema();
  });
  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`DELETE FROM ${schema}.seo_review_items WHERE item_id LIKE $1 OR product_id LIKE $1 OR item_id=$2`, [`${prefix}-%`, shopifyItemId]);
      await pool.query(`DELETE FROM ${schema}.auto_seo_product_backups WHERE workflow_id LIKE $1`, [`${prefix}-%`]);
    } finally { await pool.end(); await reviewRepository.close(); await backupRepository.close(); }
  });
}

integrationTest("review resolves the exact backup and survives repository restart", async () => {
  const first = backup("same-product-first");
  const secondOriginal = backup("same-product-second");
  const second = { ...secondOriginal, productId: first.productId, snapshotJson: secondOriginal.snapshotJson.replace(secondOriginal.productId, first.productId) };
  await backupRepository.insertBackupBatch([first, second]);
  const itemId = `${prefix}-review`;
  await reviewRepository.saveReview({ itemId, storeId: first.storeId, productId: first.productId, backupId: first.backupId, handle: "new-handle", title: "New title", reviewStatus: "pending", generatedPayload: JSON.stringify({ productTitle: "New title", productDescription: "New description", productSeoTitle: "New SEO", productSeoDescription: "New SEO description", productHandle: "new-handle" }), shopifyUpdatedAt: null });
  const reopened = new AutoSeoPostgresReviewRepository({ databaseUrl: databaseUrl ?? "", schema });
  try {
    const item = await reopened.findHydrated(itemId);
    assert.equal(item?.backupId, first.backupId);
    assert.equal(item?.originalBackup.productTitle, "Original same-product-first");
    assert.equal(item?.originalBackup.productDescription, "<p>Original</p>");
    assert.equal(item?.originalBackup.seoTitle, "Old SEO");
  } finally { await reopened.close(); }
});

integrationTest("review upsert keeps the store/product key and resets status while replacing backup reference", async () => {
  const first = backup("update-first");
  const secondOriginal = backup("update-second");
  const second = { ...secondOriginal, productId: first.productId, snapshotJson: secondOriginal.snapshotJson.replace(secondOriginal.productId, first.productId) };
  await backupRepository.insertBackupBatch([first, second]);
  const itemId = `${prefix}-update`;
  const record = { itemId, storeId: first.storeId, productId: first.productId, backupId: first.backupId, handle: "first", title: "First", reviewStatus: "pending" as const, generatedPayload: "{}", shopifyUpdatedAt: null };
  await reviewRepository.saveReview(record);
  await reviewRepository.updateStatus(itemId, "approved", "approved note");
  assert.equal(await reviewRepository.archive(itemId, first.storeId), true);
  await reviewRepository.saveReview(record);
  assert.ok((await reviewRepository.findHydrated(itemId))?.reviewArchivedAt);
  await reviewRepository.saveReview({ ...record, backupId: second.backupId, title: "Second" });
  const saved = await reviewRepository.findHydrated(itemId);
  assert.equal(saved?.backupId, second.backupId);
  assert.equal(saved?.reviewStatus, "pending");
  assert.equal(saved?.notes, null);
  assert.equal(saved?.title, "Second");
  assert.equal(saved?.reviewArchivedAt, undefined);
});

integrationTest("missing or corrupt exact backup fails hydration without selecting another", async () => {
  const record = backup("corrupt");
  await backupRepository.insertBackup(record);
  const itemId = `${prefix}-corrupt`;
  await reviewRepository.saveReview({ itemId, storeId: record.storeId, productId: record.productId, backupId: record.backupId, handle: "new", title: "New", reviewStatus: "pending", generatedPayload: "{}", shopifyUpdatedAt: null });
  const pool = new Pool({ connectionString: databaseUrl });
  try { await pool.query(`UPDATE ${schema}.auto_seo_product_backups SET snapshot_json='{' WHERE backup_id=$1`, [record.backupId]); }
  finally { await pool.end(); }
  await assert.rejects(reviewRepository.findHydrated(itemId), /integrity/i);
  const repair = new Pool({ connectionString: databaseUrl });
  try { await repair.query(`UPDATE ${schema}.auto_seo_product_backups SET snapshot_json=$1 WHERE backup_id=$2`, [record.snapshotJson, record.backupId]); }
  finally { await repair.end(); }
});

integrationTest("Auto SEO runtime saves review after one downstream call with its exact backup", async () => {
  const sqliteBefore = legacyReviewCount();
  const workflowId = `${prefix}-runtime`;
  const productId = `${prefix}-runtime-product`;
  let calls = 0;
  const run = await handleAutoSeoRun({ workflowId, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", products: [{ id: productId, title: "Original runtime", handle: "original-runtime", descriptionHtml: "<p>Before</p>" }] }, {
    backupRepository,
    reviewRepository,
    seoContentRunner: async () => {
      calls++;
      return { success: true, processedCount: 1, seoOutputs: [{ productId, productTitle: "Generated runtime", productDescription: "After", productSeoTitle: "Generated SEO", productSeoDescription: "Generated description", productHandle: "generated-runtime" }] };
    },
  });
  assert.equal(calls, 1);
  assert.equal(run.downstreamStatus, "SENT");
  const review = await reviewRepository.findHydrated(`b4-store:${productId}`);
  assert.equal(review?.backupId, run.backupIds[0]);
  assert.equal(review?.originalBackup.productTitle, "Original runtime");
  assert.equal(legacyReviewCount(), sqliteBefore);
});

integrationTest("review write failure keeps the PostgreSQL backup and reports failed durability", async () => {
  const workflowId = `${prefix}-review-failure`;
  const productId = `${prefix}-review-failure-product`;
  const run = await handleAutoSeoRun({ workflowId, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", products: [{ id: productId, title: "Original", handle: "original" }] }, {
    backupRepository,
    reviewRepository: { saveReview: async () => { throw new Error("AUTO_SEO_REVIEW_WRITE_FAILED"); } },
    seoContentRunner: async () => ({ success: true, processedCount: 1, seoOutputs: [{ productId, productTitle: "Generated", productDescription: "Generated body", productSeoTitle: "New SEO", productSeoDescription: "New description", productHandle: "new-handle" }] }),
  });
  assert.equal(run.downstreamStatus, "FAILED");
  assert.match(run.downstreamError ?? "", /AUTO_SEO_REVIEW_WRITE_FAILED/);
  assert.ok(await backupRepository.findByBackupId(run.backupIds[0] ?? ""));
  assert.equal(await reviewRepository.findHydrated(`b4-store:${productId}`), null);
});

integrationTest("Auto SEO review API lists, reads and updates PostgreSQL without SQLite access", async () => {
  const record = backup("api");
  await backupRepository.insertBackup(record);
  const itemId = `${prefix}-api`;
  await reviewRepository.saveReview({ itemId, storeId: record.storeId, productId: record.productId, backupId: record.backupId, handle: "new", title: "New", reviewStatus: "pending", generatedPayload: "{}", shopifyUpdatedAt: null });
  const list = await request("GET", "/api/seo-review/items?source=auto_seo&storeId=b4-store");
  assert.equal(list.status, 200);
  assert.ok((list.body.items as Array<{ itemId: string }>).some(item => item.itemId === itemId));
  const read = await request("GET", `/api/seo-review/items/${encodeURIComponent(itemId)}?source=auto_seo`);
  assert.equal(read.status, 200);
  assert.equal((read.body.item as { backupId: string }).backupId, record.backupId);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`UPDATE ${schema}.seo_review_items SET backup_id=NULL WHERE item_id=$1`, [itemId]);
    const broken = await request("GET", `/api/seo-review/items/${encodeURIComponent(itemId)}?source=auto_seo`);
    assert.equal(broken.status, 500);
    assert.equal((broken.body.error as { code: string }).code, "AUTO_SEO_REVIEW_INTEGRITY");
    await pool.query(`UPDATE ${schema}.seo_review_items SET backup_id=$1 WHERE item_id=$2`, [record.backupId, itemId]);
  } finally { await pool.end(); }
  const status = await request("POST", `/api/seo-review/items/${encodeURIComponent(itemId)}/status?source=auto_seo`, { status: "approved" });
  assert.equal(status.status, 200);
  assert.equal((await reviewRepository.findHydrated(itemId))?.reviewStatus, "approved");
  const edit = await request("POST", `/api/seo-review/items/${encodeURIComponent(itemId)}/update?source=auto_seo`, { payload: { productTitle: "Edited", productHandle: "edited-handle" } });
  assert.equal(edit.status, 200);
  const edited = await reviewRepository.findHydrated(itemId);
  assert.equal(edited?.title, "Edited");
  assert.match(edited?.generatedPayload ?? "", /edited-handle/);
  const deleted = await request("DELETE", `/api/seo-review/items/${encodeURIComponent(itemId)}?source=auto_seo`);
  assert.equal(deleted.status, 200);
  assert.equal(await reviewRepository.findHydrated(itemId), null);
  assert.equal((await request("DELETE", `/api/seo-review/items/${encodeURIComponent(itemId)}?source=auto_seo`)).status, 404);
  assert.equal((await request("GET", "/api/seo-review/items/missing?source=auto_seo")).status, 404);
  assert.equal((await request("GET", "/api/seo-review/items/%ZZ?source=auto_seo")).status, 400);
  const unavailable = { listHydrated: async () => { throw new Error("connection secret"); }, findHydrated: reviewRepository.findHydrated.bind(reviewRepository), updateStatus: reviewRepository.updateStatus.bind(reviewRepository), updatePayload: reviewRepository.updatePayload.bind(reviewRepository) };
  const failed = await request("GET", "/api/seo-review/items?source=auto_seo", undefined, unavailable);
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed.body).includes("connection secret"), false);
});

integrationTest("Auto SEO upsert does not overwrite a review row owned by another source", async () => {
  const record = backup("foreign-source");
  await backupRepository.insertBackup(record);
  const itemId = `${prefix}-foreign-source`;
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`INSERT INTO ${schema}.seo_review_items (item_id,store_id,product_id,handle,title,review_status,generated_payload,source_origin) VALUES ($1,$2,$3,'other','Other','pending','{}',NULL)`, [itemId, record.storeId, record.productId]);
    await assert.rejects(reviewRepository.saveReview({ itemId, storeId: record.storeId, productId: record.productId, backupId: record.backupId, handle: "new", title: "Auto SEO", reviewStatus: "pending", generatedPayload: "{}", shopifyUpdatedAt: null }), /integrity/i);
    const existing = await pool.query<{ title: string }>(`SELECT title FROM ${schema}.seo_review_items WHERE item_id=$1`, [itemId]);
    assert.equal(existing.rows[0]?.title, "Other");
  } finally { await pool.end(); }
});

integrationTest("Auto SEO review API accepts an encoded Shopify GID for read, status and edit", async () => {
  const original = backup("shopify-gid");
  const record = {
    ...original,
    storeId: "capozen",
    productId: shopifyGid,
    snapshotJson: JSON.stringify({ id: shopifyGid, title: "Original Shopify product" }),
  };
  await backupRepository.insertBackup(record);
  await reviewRepository.saveReview({ itemId: shopifyItemId, storeId: "capozen", productId: shopifyGid, backupId: record.backupId, handle: "original-product", title: "Generated product", reviewStatus: "pending", generatedPayload: "{}", shopifyUpdatedAt: null });
  const url = `/api/seo-review/items/${encodeURIComponent(shopifyItemId)}`;
  const listed = await request("GET", "/api/seo-review/items?source=auto_seo&storeId=capozen");
  assert.equal(listed.status, 200);
  assert.ok((listed.body.items as Array<{ itemId: string }>).some(item => item.itemId === shopifyItemId));
  const read = await request("GET", `${url}?source=auto_seo`);
  assert.equal(read.status, 200);
  assert.equal((read.body.item as { backupId: string }).backupId, record.backupId);
  assert.equal((await request("POST", `${url}/status?source=auto_seo`, { status: "approved" })).status, 200);
  assert.equal((await reviewRepository.findHydrated(shopifyItemId))?.reviewStatus, "approved");
  assert.equal((await request("POST", `${url}/status?source=auto_seo`, { status: "rejected" })).status, 200);
  assert.equal((await reviewRepository.findHydrated(shopifyItemId))?.reviewStatus, "rejected");
  assert.equal((await request("POST", `${url}/update?source=auto_seo`, { payload: { productTitle: "Edited Shopify product" } })).status, 200);
  assert.equal((await reviewRepository.findHydrated(shopifyItemId))?.title, "Edited Shopify product");
});

integrationTest("Auto SEO review API rejects malformed, empty, oversized and ambiguous path IDs", async () => {
  assert.equal((await request("GET", "/api/seo-review/items/%ZZ?source=auto_seo")).status, 400);
  assert.equal((await request("GET", "/api/seo-review/items/?source=auto_seo")).status, 400);
  assert.equal((await request("GET", `/api/seo-review/items/${"x".repeat(513)}?source=auto_seo`)).status, 400);
  assert.equal((await request("GET", "/api/seo-review/items/store%3A..%2Fsecret?source=auto_seo")).status, 400);
  assert.equal((await request("GET", "/api/seo-review/items/capozen:gid:/shopify/Product/8484620664917?source=auto_seo")).status, 400);
});
