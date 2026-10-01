import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { Pool } from "pg";

import { migrateAutoSeoReviewsLocal } from "../auto-seo-review-migration";
import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "../auto-seo-postgres-repository";
import { AutoSeoPostgresReviewRepository } from "../auto-seo-review-postgres";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const schema = "auto_seo_b4_test";
const prefix = `b4-test-${randomUUID()}`;
const directory = mkdtempSync(path.join(tmpdir(), "b4-review-"));
const sourcePath = path.join(directory, "source.sqlite3");
const legacyPath = path.join(directory, "legacy.sqlite3");
const beforeCommitPath = path.join(directory, "before-commit.sqlite3");
const afterCommitPath = path.join(directory, "after-commit.sqlite3");
let backups: AutoSeoPostgresRepository;
let reviews: AutoSeoPostgresReviewRepository;

function createSourceAt(filePath: string): DatabaseSync {
  const source = new DatabaseSync(filePath);
  source.exec(`CREATE TABLE seo_review_items (
    item_id TEXT PRIMARY KEY,store_id TEXT NOT NULL,product_id TEXT NOT NULL,
    handle TEXT NOT NULL,title TEXT NOT NULL,review_status TEXT NOT NULL,
    generated_payload TEXT NOT NULL,shopify_updated_at TEXT,notes TEXT,
    created_at TEXT NOT NULL,updated_at TEXT NOT NULL,source_origin TEXT
  )`);
  return source;
}

function createSource(): DatabaseSync { return createSourceAt(sourcePath); }

if (databaseUrl) {
  before(async () => {
    requireLocalAutoSeoDatabase(databaseUrl);
    backups = new AutoSeoPostgresRepository({ databaseUrl, schema });
    await backups.verifyLocalTarget();
    await backups.initializeSchema();
    reviews = new AutoSeoPostgresReviewRepository({ databaseUrl, schema });
    await reviews.initializeSchema();
  });
  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query(`DELETE FROM ${schema}.seo_review_items WHERE item_id LIKE $1`, [`${prefix}%`]);
      await pool.query(`DELETE FROM ${schema}.auto_seo_product_backups WHERE workflow_id LIKE $1`, [`${prefix}%`]);
    } finally { await pool.end(); await backups.close(); await reviews.close(); }
    for (const file of [sourcePath, legacyPath, beforeCommitPath, afterCommitPath]) for (const suffix of ["", "-wal", "-shm"]) {
      try { unlinkSync(`${file}${suffix}`); } catch { /* Optional SQLite sidecar. */ }
    }
    rmdirSync(directory);
  });
}

integrationTest("review migration handles missing source table without changing SQLite", async () => {
  const source = new DatabaseSync(sourcePath);
  source.close();
  const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  const report = await migrateAutoSeoReviewsLocal({ sourcePath, databaseUrl: databaseUrl ?? "", schema });
  assert.deepEqual(report, { sourceTableExisted: false, sourceRows: 0, inserted: 0, existing: 0, conflicts: 0, sourceUnchanged: true });
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), hash);
});

integrationTest("review migration reads legacy table without notes or source columns", async () => {
  const productId = `${prefix}-legacy-product`;
  const backupId = randomUUID();
  await backups.insertBackup({ backupId, workflowId: `${prefix}-legacy-workflow`, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", productId, productHandle: "old", productTitle: "Old", snapshotJson: JSON.stringify({ id: productId, title: "Old" }), snapshotSha256: "a".repeat(64) });
  const source = new DatabaseSync(legacyPath);
  source.exec("CREATE TABLE seo_review_items (item_id TEXT PRIMARY KEY,store_id TEXT,product_id TEXT,handle TEXT,title TEXT,review_status TEXT,generated_payload TEXT,shopify_updated_at TEXT,created_at TEXT,updated_at TEXT)");
  const itemId = `${prefix}-legacy-review`;
  source.prepare("INSERT INTO seo_review_items VALUES (?,?,?,?,?,?,?,?,?,?)").run(itemId, "b4-store", productId, "new", "New", "pending", "{}", null, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z");
  source.close();
  const report = await migrateAutoSeoReviewsLocal({ sourcePath: legacyPath, databaseUrl: databaseUrl ?? "", schema });
  assert.equal(report.inserted, 1);
  assert.equal((await reviews.findHydrated(itemId))?.backupId, backupId);
});

integrationTest("review migration preserves status and exact backup, reruns idempotently, detects conflicts and mixed sources", async () => {
  const productId = `${prefix}-product`;
  const backupId = randomUUID();
  await backups.insertBackup({ backupId, workflowId: `${prefix}-workflow`, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", productId, productHandle: "old-handle", productTitle: "Old title", snapshotJson: JSON.stringify({ id: productId, title: "Old title" }), snapshotSha256: "a".repeat(64) });
  const source = createSource();
  const itemId = `${prefix}-review`;
  source.prepare("INSERT INTO seo_review_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(itemId, "b4-store", productId, "new-handle", "New title", "approved", "{}", null, "note", "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z", "auto_seo");
  source.close();
  const hash = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
  const options = { sourcePath, databaseUrl: databaseUrl ?? "", schema };
  const first = await migrateAutoSeoReviewsLocal(options);
  assert.equal(first.inserted, 1);
  assert.equal(first.sourceRows, 1);
  const review = await reviews.findHydrated(itemId);
  assert.equal(review?.reviewStatus, "approved");
  assert.equal(review?.notes, "note");
  assert.equal(review?.backupId, backupId);
  assert.equal(review?.createdAt, "2025-01-01T00:00:00Z");
  assert.equal((await migrateAutoSeoReviewsLocal(options)).existing, 1);
  assert.equal(createHash("sha256").update(readFileSync(sourcePath)).digest("hex"), hash);
  await reviews.updateStatus(itemId, "rejected");
  await assert.rejects(migrateAutoSeoReviewsLocal(options), /CONFLICT/);
  const editing = new DatabaseSync(sourcePath);
  editing.prepare("UPDATE seo_review_items SET source_origin='pinterest_pod'").run();
  editing.close();
  await assert.rejects(migrateAutoSeoReviewsLocal(options), /MIXED_SOURCE_BLOCKER/);
});

integrationTest("review migration rejects a review with no matching backup", async () => {
  const editing = new DatabaseSync(sourcePath);
  editing.prepare("DELETE FROM seo_review_items").run();
  editing.prepare("INSERT INTO seo_review_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(`${prefix}-missing`, "b4-store", `${prefix}-missing-product`, "old", "Old", "pending", "{}", null, null, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", "auto_seo");
  editing.close();
  await assert.rejects(migrateAutoSeoReviewsLocal({ sourcePath, databaseUrl: databaseUrl ?? "", schema }), /BACKUP_BLOCKER/);
});

integrationTest("review migration refuses to guess between multiple workflow backups", async () => {
  const productId = `${prefix}-missing-product`;
  for (const suffix of ["first", "second"]) {
    await backups.insertBackup({ backupId: randomUUID(), workflowId: `${prefix}-${suffix}-workflow`, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", productId, productHandle: "old", productTitle: "Old", snapshotJson: JSON.stringify({ id: productId, title: "Old" }), snapshotSha256: "a".repeat(64) });
  }
  await assert.rejects(migrateAutoSeoReviewsLocal({ sourcePath, databaseUrl: databaseUrl ?? "", schema }), /2 candidate backups/);
});

integrationTest("review migration rolls back target rows when SQLite changes before commit", async () => {
  const productId = `${prefix}-before-product`;
  await backups.insertBackup({ backupId: randomUUID(), workflowId: `${prefix}-before-workflow`, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", productId, productHandle: "old", productTitle: "Old", snapshotJson: JSON.stringify({ id: productId, title: "Old" }), snapshotSha256: "a".repeat(64) });
  const source = createSourceAt(beforeCommitPath);
  const itemId = `${prefix}-before-review`;
  source.prepare("INSERT INTO seo_review_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(itemId, "b4-store", productId, "new", "New", "pending", "{}", null, null, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", "auto_seo");
  source.close();
  const options = {
    sourcePath: beforeCommitPath, databaseUrl: databaseUrl ?? "", schema,
    beforeCommitForTesting: () => {
      const writer = new DatabaseSync(beforeCommitPath);
      try { writer.prepare("UPDATE seo_review_items SET title='Changed' WHERE item_id=?").run(itemId); }
      finally { writer.close(); }
    },
  };
  await assert.rejects(migrateAutoSeoReviewsLocal(options), /AUTO_SEO_REVIEW_MIGRATION_SOURCE_CHANGED/);
  assert.equal(await reviews.findHydrated(itemId), null);
});

integrationTest("review migration reports committed source change and keeps committed target rows", async () => {
  const productId = `${prefix}-after-product`;
  await backups.insertBackup({ backupId: randomUUID(), workflowId: `${prefix}-after-workflow`, storeId: "b4-store", shopDomain: "b4-store.myshopify.com", productId, productHandle: "old", productTitle: "Old", snapshotJson: JSON.stringify({ id: productId, title: "Old" }), snapshotSha256: "a".repeat(64) });
  const source = createSourceAt(afterCommitPath);
  const itemId = `${prefix}-after-review`;
  source.prepare("INSERT INTO seo_review_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(itemId, "b4-store", productId, "new", "New", "pending", "{}", null, null, "2025-01-01T00:00:00Z", "2025-01-01T00:00:00Z", "auto_seo");
  source.close();
  const options = {
    sourcePath: afterCommitPath, databaseUrl: databaseUrl ?? "", schema,
    afterCommitForTesting: () => {
      const writer = new DatabaseSync(afterCommitPath);
      try { writer.prepare("UPDATE seo_review_items SET title='Changed' WHERE item_id=?").run(itemId); }
      finally { writer.close(); }
    },
  };
  await assert.rejects(migrateAutoSeoReviewsLocal(options), /AUTO_SEO_REVIEW_MIGRATION_COMMITTED_SOURCE_CHANGED/);
  assert.equal((await reviews.findHydrated(itemId))?.title, "New");
});
