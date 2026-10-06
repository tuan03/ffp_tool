import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import { migrateSeoQueue } from "../custom-gpt-seo/postgres-migration";
import { translateQueueSql } from "../custom-gpt-seo/postgres-database";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { initAutoSeoDbSchema, INSERT_AUTO_SEO_BACKUP_SQL } from "../auto-seo-db";
import { upsertSeoReviewItem } from "../seo-review-db";
import { migrateAutoSeoBackups } from "../auto-seo-migration";
import { migrateAutoSeoReviewsLocal } from "../auto-seo-review-migration";
import { bootstrapAutoSeoSchema } from "../auto-seo-startup";
import { requireAutoSeoMigrationDatabase } from "../auto-seo-postgres-repository";

import { createTestEnqueue } from "./seo-v2-fixtures";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

test("queue SQL binds values and rejects unsafe schema identifiers", () => {
  assert.equal(translateQueueSql("SELECT payload FROM gpt_jobs WHERE rowid>? AND COALESCE(json_extract(payload,'$.nextAttemptAt'),0)<=?", "test_schema"), "SELECT payload FROM \"test_schema\".gpt_jobs WHERE queue_order>$1 AND COALESCE((payload::jsonb->>'nextAttemptAt')::bigint,0)<=$2");
  assert.throws(() => translateQueueSql("SELECT * FROM gpt_jobs", 'public"; DROP SCHEMA public'), /Invalid/);
});

test("production migration opt-in still rejects unrelated databases and users", () => {
  assert.throws(() => requireAutoSeoMigrationDatabase("postgresql://ffp_tool:test@database:5432/another_db", true), /ffp_tool database/);
  assert.throws(() => requireAutoSeoMigrationDatabase("postgresql://another_user:test@database:5432/ffp_tool", true), /ffp_tool database/);
  assert.throws(() => requireAutoSeoMigrationDatabase("postgresql://ffp_tool:test@database:5432/ffp_tool"), /local PostgreSQL/);
  requireAutoSeoMigrationDatabase("postgresql://ffp_tool:test@database:5432/ffp_tool", true);
});

integrationTest("PostgreSQL queue fences concurrent claims, preserves checkpoints and requires human sync approval", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_queue_test_${randomUUID().replaceAll("-", "")}`;
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema }, () => 1000);
  const other = new PostgresCustomGptQueue({ databaseUrl, schema }, () => 1000);
  try {
    await queue.initialize();
    await other.initialize();
    await queue.configure("test-store", { provider: "codex_mcp", batchSize: 1 });
    const input = createTestEnqueue({ storeId: "test-store", productId: "123", original: { updatedAt: "2026-01-01T00:00:00Z" }, input: { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }], niche: "blanket" } });
    const [first, duplicate] = await Promise.all([queue.enqueue(input), other.enqueue(input)]);
    assert.equal(first.id, duplicate.id);
    assert.equal((await queue.counts("test-store")).PENDING, 1);
    const [claim, competing] = await Promise.all([queue.claim("test-store", "first-claim", "codex_mcp", "worker-a"), other.claim("test-store", "second-claim", "codex_mcp", "worker-b")]);
    assert.equal(claim.jobs.length + competing.jobs.length, 1);
    const batch = claim.jobs.length ? claim : competing;
    for (const stage of ["analysis", "research", "keywords", "submission"] as const) {
      await queue.checkpoint("test-store", first.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: `checkpoint-${stage}`, stage, payload: { stage, aeo_quick_summary: "Test facts", aeo_faq: [{ question: "What is it?", answer: "A test blanket." }] } });
    }
    const finalizers = await Promise.all([queue.pendingFinalization(), other.pendingFinalization()]);
    assert.equal(finalizers.flat().length, 1);
    const finalizer = finalizers.flat()[0];
    assert.ok(finalizer);
    await queue.finish("test-store", first.id, { output: { aeo_quick_summary: "Test facts" } }, finalizer.finalizerToken);
    const verification = new Pool({ connectionString: databaseUrl });
    try {
      const receipt = await verification.query(`SELECT delivered FROM "${schema}".gpt_deliveries WHERE job_id=$1`, [first.id]);
      assert.equal(receipt.rows[0].delivered, 1);
    } finally { await verification.end(); }
    await assert.rejects(queue.beginSync("test-store", first.id), /human approval/);
    await queue.saveReviewState("test-store", first.id, { reviewDecision: "approved", updatedAt: 1000 });
    const syncs = await Promise.allSettled([queue.beginSync("test-store", first.id), other.beginSync("test-store", first.id)]);
    assert.equal(syncs.filter(sync => sync.status === "fulfilled").length, 1);
    assert.equal((await queue.get("test-store", first.id)).status, "REVIEW_READY");
    await assert.rejects(queue.saveReviewState("test-store", first.id, { updatedAt: 999 }), /conflict/);
    await assert.rejects(queue.get("other-store", first.id), /not found/);
  } finally {
    await other.close();
    await queue.close();
    const cleanup = new Pool({ connectionString: databaseUrl });
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await cleanup.end(); }
  }
});

integrationTest("worker finalization commits a Review receipt and completes its run exactly once", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_queue_test_${randomUUID().replaceAll("-", "")}`;
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await queue.initialize();
    await queue.configure("test-store", { provider: "codex_mcp", batchSize: 1 });
    const job = await queue.enqueue(createTestEnqueue({ storeId: "test-store", productId: "123",
      input: { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }], niche: "blanket" } }));
    await queue.workers.enableStore("test-store");
    const { token } = await queue.workers.issueToken({ storeId: "test-store", workerId: "test", createdBy: "test" });
    const { sessionId } = await queue.workers.register(token, "register");
    const run = await queue.workers.startRun(token, sessionId, 1, "start");
    const { lease } = await queue.workers.claim(token, sessionId, run.id, "claim");
    assert.ok(lease);
    await pool.query(`UPDATE "${schema}".gpt_jobs SET status='VALIDATING',
      payload=(payload::jsonb || '{"status":"VALIDATING"}'::jsonb)::text WHERE id=$1`, [job.id]);
    const [finalizer] = await queue.pendingFinalization();
    const result = { output: { productTitle: "Test blanket draft" } };
    await queue.finish("test-store", job.id, result, finalizer.finalizerToken);
    await queue.finish("test-store", job.id, result, finalizer.finalizerToken);
    await queue.workers.reconcileReviews();
    await queue.workers.recover();
    assert.equal((await queue.list("test-store", "REVIEW_READY", 0)).length, 1);
    assert.equal((await queue.workers.runStatus(token, run.id)).successful, 1);
    assert.equal((await queue.workers.runStatus(token, run.id)).state, "COMPLETED");
    assert.equal((await queue.workers.claim(token, sessionId, run.id, "after-success")).stopReason, "TARGET_REACHED");
  } finally {
    await queue.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});

integrationTest("offline import preserves all queue tables, AEO, leases and sync fencing across restart", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_queue_test_${randomUUID().replaceAll("-", "")}`;
  const directory = mkdtempSync(join(tmpdir(), "ffp-queue-import-"));
  const sourcePath = join(directory, "queue.sqlite3");
  const source = new DatabaseSync(sourcePath);
  const legacy = new CustomGptQueue(source, () => 1000);
  const input = createTestEnqueue({ storeId: "test-store", productId: "123", original: { updatedAt: "2026-01-01" }, input: { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }], niche: "blanket" } });
  legacy.configure(input.execution.storeId, { provider: "codex_mcp", batchSize: 1 });
  const job = legacy.enqueue(input);
  const lease = legacy.claim(input.execution.storeId, "claim-1", "codex_mcp", "test-worker");
  const aeo = { summary: "Grounded blanket facts", faq: [{ question: "What is included?", answer: "One blanket." }], schema: { "@graph": [{ "@type": "Product" }] } };
  legacy.checkpoint(input.execution.storeId, job.id, { batchId: lease.id, leaseToken: lease.leaseToken, requestId: "submission-1", stage: "submission", payload: aeo });
  legacy.finish(input.execution.storeId, job.id, { output: aeo });
  legacy.saveReviewState(input.execution.storeId, job.id, { reviewDecision: "approved", updatedAt: 1000 });
  const token = legacy.beginSync(input.execution.storeId, job.id);
  legacy.finishSync(input.execution.storeId, job.id, token, "UNKNOWN");
  legacy.rememberMutation(job.id, "remember-1", { id: 1 }, { preserved: true });
  const pending = legacy.enqueue(createTestEnqueue({ storeId: "test-store", productId: "456", input: input.input }));
  const leased = legacy.claim(input.execution.storeId, "claim-2", "codex_mcp", "second-worker");
  source.close();
  const originalBytes = readFileSync(sourcePath);
  let queue = new PostgresCustomGptQueue({ databaseUrl, schema }, () => 1000);
  try {
    const guard = new PostgresCustomGptQueue({ databaseUrl, schema, legacySourcePath: sourcePath });
    try { await assert.rejects(guard.initialize(), /SEO_QUEUE_MIGRATION_REQUIRED/); }
    finally { await guard.close(); }
    const report = await migrateSeoQueue({ databaseUrl, schema, sourcePath });
    for (const count of Object.values(report.counts)) assert.ok(count > 0);
    assert.equal(report.counts.gpt_jobs, 2);
    assert.equal((await migrateSeoQueue({ databaseUrl, schema, sourcePath })).alreadyImported, true);
    assert.deepEqual(readFileSync(sourcePath), originalBytes);
    assert.deepEqual((await queue.get(input.execution.storeId, job.id)).result, { output: aeo });
    assert.deepEqual((await queue.get(input.execution.storeId, job.id)).checkpoints.submission, aeo);
    assert.deepEqual(await queue.replayMutation(job.id, "remember-1", { id: 1 }), { payload: { preserved: true } });
    assert.deepEqual(await queue.syncState(input.execution.storeId, job.id), { token, status: "UNKNOWN" });
    await assert.rejects(queue.beginSync(input.execution.storeId, job.id), /already started/);
    assert.equal((await queue.activeBatch(input.execution.storeId, "second-worker"))?.leaseToken, leased.leaseToken);
    await queue.close();
    queue = new PostgresCustomGptQueue({ databaseUrl, schema, legacySourcePath: sourcePath }, () => 1000);
    assert.equal((await queue.get(input.execution.storeId, pending.id)).status, "IN_PROGRESS");
    await queue.assertLease(input.execution.storeId, leased.id, leased.leaseToken, pending.id);
    await queue.release(input.execution.storeId, leased.id, leased.leaseToken);
    await queue.configure(input.execution.storeId, { provider: "custom_gpt", batchSize: 1 });
    const newer = await queue.enqueue(createTestEnqueue({ storeId: "test-store", productId: "789", input: input.input }));
    const customClaim = await queue.claim(input.execution.storeId, "custom-claim", "custom_gpt", "custom-worker");
    assert.equal(customClaim.jobs[0]?.id, newer.id);
    assert.equal((await queue.findLatestSourceJobs(input.execution.storeId, "auto_seo", ["123", "456", "789"])).size, 3);
  } finally {
    await queue.close();
    const cleanup = new Pool({ connectionString: databaseUrl });
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await cleanup.end(); rmSync(directory, { recursive: true }); }
  }
});

integrationTest("migration rolls back every table if a legacy writer changes the source", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_queue_test_${randomUUID().replaceAll("-", "")}`;
  const directory = mkdtempSync(join(tmpdir(), "ffp-queue-rollback-"));
  const sourcePath = join(directory, "queue.sqlite3");
  const source = new DatabaseSync(sourcePath);
  new CustomGptQueue(source).configure("test-store", { provider: "codex_mcp", batchSize: 1 });
  source.close();
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await assert.rejects(migrateSeoQueue({ databaseUrl, schema, sourcePath, beforeCommitForTesting: () => {
      const writer = new DatabaseSync(sourcePath);
      try { writer.prepare("UPDATE gpt_settings SET payload=?").run('{"changed":true}'); }
      finally { writer.close(); }
    } }), /SEO_QUEUE_MIGRATION_SOURCE_CHANGED/);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM "${schema}".gpt_settings`)).rows[0]?.count), 0);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM "${schema}".seo_queue_migrations`)).rows[0]?.count), 0);
  } finally {
    try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await pool.end(); rmSync(directory, { recursive: true }); }
  }
});

integrationTest("legacy reviews retain exact payloads and resolve only a uniquely historical identical backup", async () => {
  assert.ok(databaseUrl);
  const schema = `seo_queue_test_${randomUUID().replaceAll("-", "")}`;
  const directory = mkdtempSync(join(tmpdir(), "ffp-review-import-"));
  const sourcePath = join(directory, "auto-seo.sqlite3");
  const source = new DatabaseSync(sourcePath);
  initAutoSeoDbSchema(source);
  const snapshot = JSON.stringify({ id: "123", title: "Original blanket", descriptionHtml: "<p>Original facts</p>" });
  for (const suffix of ["old", "future"]) {
    source.prepare(INSERT_AUTO_SEO_BACKUP_SQL).run(`backup-${suffix}`, `workflow-${suffix}`, "test-store", "test.myshopify.com", "123", "blanket", "Original blanket", null, snapshot, "snapshot-hash", "input-hash");
    source.prepare("UPDATE auto_seo_product_backups SET created_at=?,downstream_status='SENT' WHERE backup_id=?").run(suffix === "old" ? "2025-01-01T00:00:00Z" : "2025-01-03T00:00:00Z", `backup-${suffix}`);
  }
  const payload = JSON.stringify({ aeo_quick_summary: "Blanket facts", aeo_faq: [], aeo_json_ld: { "@type": "Product" } });
  upsertSeoReviewItem(source, { itemId: "test-review", storeId: "test-store", productId: "123", handle: "blanket", title: "Review blanket", reviewStatus: "pending", generatedPayload: payload, createdAt: "2025-01-02T00:00:00Z", updatedAt: "2025-01-02T00:00:00Z" });
  source.close();
  const bytes = readFileSync(sourcePath);
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await bootstrapAutoSeoSchema({ databaseUrl, schema });
    const options = { databaseUrl, schema, sourcePath, allowProductionTarget: true };
    assert.equal((await migrateAutoSeoBackups(options)).inserted, 2);
    await assert.rejects(migrateAutoSeoReviewsLocal(options), /2 candidate backups/);
    assert.equal((await migrateAutoSeoReviewsLocal({ ...options, allowEquivalentHistoricalBackup: true })).inserted, 1);
    const review = (await pool.query(`SELECT backup_id,generated_payload FROM "${schema}".seo_review_items`)).rows[0];
    assert.equal(review?.backup_id, "backup-old");
    assert.equal(review?.generated_payload, payload);
    assert.deepEqual(readFileSync(sourcePath), bytes);
    assert.equal((await migrateAutoSeoBackups(options)).alreadyMigrated, 2);
    assert.equal((await migrateAutoSeoReviewsLocal({ ...options, allowEquivalentHistoricalBackup: true })).existing, 1);
  } finally {
    try { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await pool.end(); rmSync(directory, { recursive: true }); }
  }
});
