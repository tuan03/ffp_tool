import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";

import { Pool } from "pg";

import { AutoSeoPostgresRepository } from "../auto-seo-postgres-repository";
import type { AutoSeoPostgresBackupInput } from "../auto-seo-postgres-repository";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const schema = "auto_seo_b1_test";
const workflowPrefix = `b1-test-${randomUUID()}`;
let repository: AutoSeoPostgresRepository;

function backup(suffix: string, overrides: Partial<AutoSeoPostgresBackupInput> = {}): AutoSeoPostgresBackupInput {
  return {
    backupId: randomUUID(),
    workflowId: `${workflowPrefix}-${suffix}`,
    storeId: "b1-test-store",
    shopDomain: "b1-test.myshopify.com",
    productId: `product-${suffix}`,
    productHandle: `handle-${suffix}`,
    productTitle: `Title ${suffix}`,
    shopifyUpdatedAt: "2026-09-29T01:02:03.000Z",
    snapshotJson: '{"b":2,"a":1}',
    snapshotSha256: "a".repeat(64),
    ...overrides,
  };
}

if (databaseUrl) {
  before(async () => {
    repository = new AutoSeoPostgresRepository({ databaseUrl, schema });
    await repository.verifyLocalTarget();
    await repository.initializeSchema();
  });

  after(async () => {
    const cleanupPool = new Pool({ connectionString: databaseUrl });
    try {
      await cleanupPool.query(`DELETE FROM ${schema}.auto_seo_product_backups WHERE workflow_id LIKE $1`, [`${workflowPrefix}-%`]);
    } finally {
      await cleanupPool.end();
      await repository.close();
    }
  });
}

integrationTest("schema has backup columns, unique keys, status check, and indexes", async () => {
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const columns = await pool.query<{ column_name: string }>(
      "SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='auto_seo_product_backups'",
      [schema],
    );
    for (const name of [
      "id", "backup_id", "workflow_id", "store_id", "shop_domain", "product_id",
      "product_handle", "product_title", "shopify_updated_at", "snapshot_json",
      "snapshot_sha256", "gpt_settings_json", "downstream_status",
      "downstream_http_status", "downstream_error", "downstream_sent_at", "created_at",
    ]) {
      assert.ok(columns.rows.some((column) => column.column_name === name), name);
    }
    assert.equal(columns.rows.length, 17);
    const constraints = await pool.query<{ conname: string; definition: string }>(
      "SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid=$1::regclass",
      [`${schema}.auto_seo_product_backups`],
    );
    assert.ok(constraints.rows.some((row) => row.definition.includes("UNIQUE (backup_id)")));
    assert.ok(constraints.rows.some((row) => row.definition.includes("UNIQUE (workflow_id, store_id, product_id)")));
    assert.ok(constraints.rows.some((row) => row.definition.includes("downstream_status")));
    const indexes = await pool.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE schemaname=$1 AND tablename='auto_seo_product_backups'",
      [schema],
    );
    assert.ok(indexes.rows.some((row) => row.indexname === "idx_auto_seo_store_product"));
    assert.ok(indexes.rows.some((row) => row.indexname === "idx_auto_seo_created_at"));
    const reviewTable = await pool.query<{ exists: string | null }>("SELECT to_regclass($1) AS exists", [`${schema}.seo_review_items`]);
    assert.equal(reviewTable.rows[0]?.exists, null);
  } finally {
    await pool.end();
  }
});

integrationTest("insert and read preserve every backup field and exact snapshot text", async () => {
  const record = backup("read");
  await repository.insertBackup(record, { gptSettingsJson: '{"provider":"custom_gpt"}' });
  const saved = await repository.findByBackupId(record.backupId);
  assert.ok(saved);
  for (const key of ["backupId", "workflowId", "storeId", "shopDomain", "productId", "productHandle", "productTitle", "shopifyUpdatedAt", "snapshotJson", "snapshotSha256"] as const) {
    assert.equal(saved[key], record[key]);
  }
  assert.equal(saved.gptSettingsJson, '{"provider":"custom_gpt"}');
  assert.equal(saved.downstreamStatus, "NOT_SENT");
  assert.equal(saved.downstreamHttpStatus, null);
  assert.equal(saved.downstreamError, null);
  assert.equal(saved.downstreamSentAt, null);
  assert.match(saved.createdAt, /^\d{4}-\d{2}-\d{2}T/);
});

integrationTest("batch commits every backup", async () => {
  const records = [backup("batch-a"), backup("batch-b"), backup("batch-c")];
  await repository.insertBackupBatch(records);
  for (const record of records) assert.ok(await repository.findByBackupId(record.backupId));
});

integrationTest("third insert failure rolls back the entire batch", async () => {
  const first = backup("rollback-a");
  const second = backup("rollback-b");
  const records = [first, second, backup("rollback-c", { backupId: second.backupId })];
  await assert.rejects(repository.insertBackupBatch(records));
  for (const record of records.slice(0, 2)) assert.equal(await repository.findByBackupId(record.backupId), null);
});

integrationTest("onConflict error rejects duplicate workflow/store/product and rolls back batch", async () => {
  const original = backup("duplicate");
  await repository.insertBackup(original);
  const preceding = backup("duplicate-preceding");
  await assert.rejects(repository.insertBackupBatch([preceding, backup("duplicate", { backupId: randomUUID() })], { onConflict: "error" }));
  assert.equal(await repository.findByBackupId(preceding.backupId), null);
  assert.equal((await repository.findByBackupId(original.backupId))?.snapshotJson, original.snapshotJson);
});

integrationTest("onConflict update replaces backup and resets downstream fields and created_at", async () => {
  const original = backup("upsert", { snapshotJson: "first", snapshotSha256: "1".repeat(64) });
  await repository.insertBackup(original, { gptSettingsJson: '{"provider":"custom_gpt"}' });
  await repository.updateDownstreamStatus(original.workflowId, [original.backupId], "FAILED", 503, "test error");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`UPDATE ${schema}.auto_seo_product_backups SET created_at=$1 WHERE backup_id=$2`, ["2000-01-01T00:00:00.000Z", original.backupId]);
  } finally {
    await pool.end();
  }
  const before = await repository.findByBackupId(original.backupId);
  assert.ok(before);
  const replacement = backup("upsert", {
    backupId: randomUUID(),
    shopDomain: "new-b1-test.myshopify.com",
    productHandle: "new-handle",
    productTitle: "New title",
    shopifyUpdatedAt: "2026-09-30T01:02:03.000Z",
    snapshotJson: "second",
    snapshotSha256: "2".repeat(64),
  });
  await repository.insertBackup(replacement, { onConflict: "update" });
  assert.equal(await repository.findByBackupId(original.backupId), null);
  const saved = await repository.findByBackupId(replacement.backupId);
  assert.ok(saved);
  assert.equal(saved.productTitle, "New title");
  assert.equal(saved.shopDomain, "new-b1-test.myshopify.com");
  assert.equal(saved.productHandle, "new-handle");
  assert.equal(saved.shopifyUpdatedAt, "2026-09-30T01:02:03.000Z");
  assert.equal(saved.snapshotJson, "second");
  assert.equal(saved.snapshotSha256, "2".repeat(64));
  assert.equal(saved.gptSettingsJson, '{"provider":"custom_gpt"}');
  assert.equal(saved.downstreamStatus, "NOT_SENT");
  assert.equal(saved.downstreamHttpStatus, null);
  assert.equal(saved.downstreamError, null);
  assert.equal(saved.downstreamSentAt, null);
  assert.notEqual(saved.createdAt, before.createdAt);
  assert.equal(await repository.countByWorkflow(original.workflowId), 1);
});

integrationTest("downstream status persists SENT and FAILED transitions", async () => {
  const sent = backup("sent");
  const failed = backup("failed");
  await repository.insertBackupBatch([sent, failed]);
  await repository.updateDownstreamStatus(sent.workflowId, [sent.backupId], "SENT");
  await repository.updateDownstreamStatus(failed.workflowId, [failed.backupId], "FAILED", null, "failure");
  assert.equal((await repository.findByBackupId(sent.backupId))?.downstreamStatus, "SENT");
  assert.equal((await repository.findByBackupId(failed.backupId))?.downstreamStatus, "FAILED");
  assert.equal((await repository.findByBackupId(failed.backupId))?.downstreamError, "failure");
});

integrationTest("committed backup survives closing and reopening the pool", async () => {
  const record = backup("durable");
  const first = new AutoSeoPostgresRepository({ databaseUrl: databaseUrl ?? "", schema });
  await first.insertBackup(record);
  await first.close();
  const second = new AutoSeoPostgresRepository({ databaseUrl: databaseUrl ?? "", schema });
  try {
    assert.equal((await second.findByBackupId(record.backupId))?.snapshotJson, record.snapshotJson);
  } finally {
    await second.close();
  }
});

integrationTest("pending handoffs order legacy and ISO timestamps chronologically", async () => {
  const older = backup("order-older");
  const newer = backup("order-newer");
  await repository.insertBackup(older, { gptSettingsJson: "{}" });
  await repository.insertBackup(newer, { gptSettingsJson: "{}" });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await pool.query(`UPDATE ${schema}.auto_seo_product_backups SET created_at=$1 WHERE backup_id=$2`, ["2026-09-29 23:59:59", newer.backupId]);
    await pool.query(`UPDATE ${schema}.auto_seo_product_backups SET created_at=$1 WHERE backup_id=$2`, ["2026-09-29T01:00:00.000Z", older.backupId]);
    const pending = await repository.findPendingBackups(100);
    assert.ok(pending.findIndex(row => row.backupId === older.backupId) < pending.findIndex(row => row.backupId === newer.backupId));
  } finally {
    await pool.end();
  }
});
