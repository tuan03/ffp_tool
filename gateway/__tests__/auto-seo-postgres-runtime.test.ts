import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { Pool } from "pg";

import { initAutoSeoDbSchema } from "../auto-seo-db";
import { handleAutoSeoRun } from "../auto-seo-handler";
import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "../auto-seo-postgres-repository";
import { recoverAutoSeoHandoffs } from "../custom-gpt-seo/auto-seo-outbox";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import type { AutoSeoPostgresBackupInput } from "../auto-seo-postgres-repository";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const schema = "auto_seo_b3_test";
const prefix = `b3-test-${randomUUID()}`;
let repository: AutoSeoPostgresRepository;

function request(suffix: string, productIds: readonly string[] = ["product-1"]) {
  return {
    workflowId: `${prefix}-${suffix}`, storeId: "b3-test-store", shopDomain: "b3-test.myshopify.com",
    products: productIds.map(id => ({ id, handle: id, title: `Title ${id}` })),
  };
}

function pendingRecord(suffix: string, settings: string | null = JSON.stringify({ provider: "custom_gpt", batchSize: 5, language: "en-US" })): { record: AutoSeoPostgresBackupInput; settings: string | null } {
  const product = { id: `gid://shopify/Product/${suffix}`, handle: `handle-${suffix}`, title: `Title ${suffix}` };
  return { record: {
    backupId: randomUUID(), workflowId: `${prefix}-recovery-${suffix}`, storeId: "b3-test-store", shopDomain: "b3-test.myshopify.com",
    productId: product.id, productHandle: product.handle, productTitle: product.title,
    snapshotJson: JSON.stringify(product), snapshotSha256: "a".repeat(64),
  }, settings };
}

if (databaseUrl) {
  before(async () => {
    requireLocalAutoSeoDatabase(databaseUrl);
    repository = new AutoSeoPostgresRepository({ databaseUrl, schema });
    await repository.verifyLocalTarget();
    await repository.initializeSchema();
  });
  after(async () => {
    const pool = new Pool({ connectionString: databaseUrl });
    try { await pool.query(`DELETE FROM ${schema}.auto_seo_product_backups WHERE workflow_id LIKE $1`, [`${prefix}-%`]); }
    finally { await pool.end(); await repository.close(); }
  });
}

integrationTest("runtime commits PostgreSQL backup before downstream and leaves SQLite backup count unchanged", async () => {
  const sqlite = new DatabaseSync(":memory:");
  try {
    initAutoSeoDbSchema(sqlite);
    const beforeCount = sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count;
    let sawCommitted = false;
    const input = request("success");
    const run = await handleAutoSeoRun(input, { backupRepository: repository, seoContentRunner: async () => {
      sawCommitted = (await repository.countByWorkflow(input.workflowId)) === 1;
      return { success: true, processedCount: 1 };
    } });
    assert.equal(sawCommitted, true);
    assert.equal(run.downstreamStatus, "SENT");
    assert.equal((await repository.findByBackupId(run.backupIds[0] ?? ""))?.downstreamStatus, "SENT");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count, beforeCount);
    const reopened = new AutoSeoPostgresRepository({ databaseUrl: databaseUrl ?? "", schema });
    try { assert.ok(await reopened.findByBackupId(run.backupIds[0] ?? "")); }
    finally { await reopened.close(); }
  } finally { sqlite.close(); }
});

integrationTest("runtime backup transaction failure does not call downstream", async () => {
  const input = request("rollback", ["first", "second"]);
  await repository.insertBackup({ ...pendingRecord("seed").record, workflowId: input.workflowId, productId: "second" });
  let calls = 0;
  await assert.rejects(handleAutoSeoRun(input, { backupRepository: repository, seoContentRunner: async () => { calls++; return { success: true, processedCount: 2 }; } }));
  assert.equal(calls, 0);
  assert.equal(await repository.countByWorkflow(input.workflowId), 1);
});

integrationTest("runtime downstream failure retains PostgreSQL backup and marks FAILED", async () => {
  const run = await handleAutoSeoRun(request("downstream-fail"), { backupRepository: repository, seoContentRunner: async () => { throw new Error("downstream failed"); } });
  assert.equal(run.downstreamStatus, "FAILED");
  assert.equal((await repository.findByBackupId(run.backupIds[0] ?? ""))?.downstreamError, "downstream failed");
});

integrationTest("runtime onConflict update replaces backup and resets status", async () => {
  const input = request("update");
  const runner = async () => ({ success: true, processedCount: 1 });
  const first = await handleAutoSeoRun(input, { backupRepository: repository, seoContentRunner: runner });
  const second = await handleAutoSeoRun({ ...input, onConflict: "update", products: [{ id: "product-1", handle: "changed", title: "Changed" }] }, { backupRepository: repository, seoContentRunner: async () => {
    const pending = await repository.findByBackupId(first.backupIds[0] ?? "");
    assert.equal(pending, null);
    return { success: true, processedCount: 1 };
  } });
  assert.notEqual(first.backupIds[0], second.backupIds[0]);
  assert.equal((await repository.findByBackupId(second.backupIds[0] ?? ""))?.productTitle, "Changed");
});

integrationTest("PostgreSQL recovery selects pending GPT rows and acknowledges after queue enqueue", async () => {
  const pending = pendingRecord("pending");
  const withoutGpt = pendingRecord("no-gpt", null);
  const alreadySent = pendingRecord("sent");
  await repository.insertBackup(pending.record, { gptSettingsJson: pending.settings ?? undefined });
  await repository.insertBackup(withoutGpt.record);
  await repository.insertBackup(alreadySent.record, { gptSettingsJson: alreadySent.settings ?? undefined });
  await repository.updateDownstreamStatus(alreadySent.record.workflowId, [alreadySent.record.backupId], "SENT");
  const queueDb = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(queueDb);
    const reopened = new AutoSeoPostgresRepository({ databaseUrl: databaseUrl ?? "", schema });
    try { await recoverAutoSeoHandoffs(reopened, queue); }
    finally { await reopened.close(); }
    assert.equal(queue.list("b3-test-store").length, 1);
    assert.equal((await repository.findByBackupId(pending.record.backupId))?.downstreamStatus, "SENT");
    assert.equal((await repository.findByBackupId(withoutGpt.record.backupId))?.downstreamStatus, "NOT_SENT");
    assert.equal((await repository.findByBackupId(alreadySent.record.backupId))?.downstreamStatus, "SENT");
  } finally { queueDb.close(); }
});

integrationTest("PostgreSQL recovery marks an invalid pending handoff FAILED", async () => {
  const pending = pendingRecord("invalid");
  await repository.insertBackup({ ...pending.record, snapshotJson: "{" }, { gptSettingsJson: pending.settings ?? undefined });
  const queueDb = new DatabaseSync(":memory:");
  try {
    await recoverAutoSeoHandoffs(repository, new CustomGptQueue(queueDb));
    const saved = await repository.findByBackupId(pending.record.backupId);
    assert.equal(saved?.downstreamStatus, "FAILED");
    assert.equal(saved?.downstreamError, "Custom GPT handoff recovery failed; retry the backed-up workflow");
  } finally { queueDb.close(); }
});

test("unavailable PostgreSQL does not run downstream or write a SQLite backup", async () => {
  const sqlite = new DatabaseSync(":memory:");
  initAutoSeoDbSchema(sqlite);
  const unreachable = new AutoSeoPostgresRepository({ databaseUrl: "postgresql://ffp_tool:unused@127.0.0.1:1/ffp_tool" });
  let calls = 0;
  try {
    await assert.rejects(handleAutoSeoRun(request("unavailable"), { backupRepository: unreachable, seoContentRunner: async () => { calls++; return { success: true, processedCount: 1 }; } }));
    assert.equal(calls, 0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count, 0);
  } finally { await unreachable.close(); sqlite.close(); }
});
