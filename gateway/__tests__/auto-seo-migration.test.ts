import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";

import { Pool } from "pg";

import { captureAutoSeoSourceState, migrateAutoSeoBackups } from "../auto-seo-migration";
import { runAutoSeoMigrationLocal } from "../auto-seo-migrate-local";
import { getAutoSeoPostgresSchemaSql } from "../auto-seo-postgres-schema";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;
const schema = `auto_seo_b2_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const directory = mkdtempSync(path.join(tmpdir(), "auto-seo-b2-"));
let pool: Pool;

type IndexKind = "unique" | "plain" | "partial" | "wrong-order" | "wrong-column" | "none";

function fixture(hasSettings: boolean, keys: { backup?: IndexKind; tuple?: IndexKind } = {}): { sourcePath: string; backupId: string; snapshot: string } {
  const sourcePath = path.join(directory, `${randomUUID()}.sqlite3`);
  const db = new DatabaseSync(sourcePath);
  const backupKey = keys.backup ?? "unique";
  const tupleKey = keys.tuple ?? "unique";
  db.exec(`CREATE TABLE auto_seo_product_backups (
    backup_id TEXT ${backupKey === "unique" ? "UNIQUE" : ""} NOT NULL, workflow_id TEXT NOT NULL, store_id TEXT NOT NULL,
    shop_domain TEXT NOT NULL, product_id TEXT NOT NULL, product_handle TEXT NOT NULL,
    product_title TEXT NOT NULL, shopify_updated_at TEXT, snapshot_json TEXT NOT NULL,
    snapshot_sha256 TEXT NOT NULL, downstream_status TEXT NOT NULL,
    downstream_http_status INTEGER, downstream_error TEXT, downstream_sent_at TEXT,
    created_at TEXT NOT NULL${hasSettings ? ", gpt_settings_json TEXT" : ""}
    ${tupleKey === "unique" ? ", UNIQUE(workflow_id, store_id, product_id)" : ""}
  ); CREATE TABLE seo_review_items (id TEXT);`);
  if (backupKey === "plain") db.exec("CREATE INDEX idx_backup_plain ON auto_seo_product_backups(backup_id)");
  if (backupKey === "partial") db.exec("CREATE UNIQUE INDEX idx_backup_partial ON auto_seo_product_backups(backup_id) WHERE downstream_status='FAILED'");
  if (backupKey === "wrong-column") db.exec("CREATE UNIQUE INDEX idx_backup_wrong ON auto_seo_product_backups(backup_id, store_id)");
  if (tupleKey === "plain") db.exec("CREATE INDEX idx_tuple_plain ON auto_seo_product_backups(workflow_id, store_id, product_id)");
  if (tupleKey === "partial") db.exec("CREATE UNIQUE INDEX idx_tuple_partial ON auto_seo_product_backups(workflow_id, store_id, product_id) WHERE downstream_status='FAILED'");
  if (tupleKey === "wrong-order") db.exec("CREATE UNIQUE INDEX idx_tuple_wrong ON auto_seo_product_backups(store_id, workflow_id, product_id)");
  if (tupleKey === "wrong-column") db.exec("CREATE UNIQUE INDEX idx_tuple_extra ON auto_seo_product_backups(workflow_id, store_id, product_id, shop_domain)");
  const backupId = randomUUID();
  const snapshot = '{ "z": 2, "a":1 }';
  db.prepare(`INSERT INTO auto_seo_product_backups
    (backup_id,workflow_id,store_id,shop_domain,product_id,product_handle,product_title,
     shopify_updated_at,snapshot_json,snapshot_sha256,downstream_status,downstream_http_status,
     downstream_error,downstream_sent_at,created_at${hasSettings ? ",gpt_settings_json" : ""})
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?${hasSettings ? ",?" : ""})`).run(
      backupId, `workflow-${backupId}`, "store", "shop.myshopify.com", `product-${backupId}`,
      "handle", "Title", "2020-01-01T00:00:00Z", snapshot, "a".repeat(64),
      "FAILED", 503, "error", "2020-01-02T00:00:00Z", "2019-12-31 23:00:00",
      ...(hasSettings ? ['{"provider":"custom"}'] : []),
    );
  db.prepare("INSERT INTO seo_review_items VALUES (?)").run("must-remain-unmigrated");
  db.close();
  return { sourcePath, backupId, snapshot };
}

if (databaseUrl) {
  before(async () => {
    pool = new Pool({ connectionString: databaseUrl });
    await pool.query(getAutoSeoPostgresSchemaSql(schema));
  });
  after(async () => {
    try { await pool.query(`DROP SCHEMA ${schema} CASCADE`); }
    finally { await pool.end(); rmSync(directory, { recursive: true, force: true }); }
  });
} else {
  after(() => rmSync(directory, { recursive: true, force: true }));
}

integrationTest("old source schema migrates exact fields, leaves source and review untouched, and reruns safely", async () => {
  const { sourcePath, backupId, snapshot } = fixture(false);
  const sourceBefore = captureAutoSeoSourceState(sourcePath);
  const options = { sourcePath, databaseUrl: databaseUrl ?? "", schema };
  const dry = await migrateAutoSeoBackups({ ...options, dryRun: true });
  assert.equal(dry.preflight.sourceCount, 1);
  assert.deepEqual(dry.preflight.requiredUniqueKeys, { backupId: true, workflowStoreProduct: true });
  assert.ok(dry.preflight.missingOptionalColumns.includes("gpt_settings_json"));
  assert.equal(dry.inserted, 0);
  assert.equal(dry.plannedInserts, 1);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups`)).rows[0].count, "0");
  const first = await migrateAutoSeoBackups(options);
  assert.equal(first.inserted, 1);
  assert.equal(first.mismatches, 0);
  const target = (await pool.query(`SELECT * FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [backupId])).rows[0];
  assert.equal(target.snapshot_json, snapshot);
  assert.equal(target.snapshot_sha256, "a".repeat(64));
  assert.equal(target.created_at, "2019-12-31 23:00:00");
  assert.equal(target.gpt_settings_json, null);
  assert.equal(target.downstream_status, "FAILED");
  assert.equal(target.downstream_http_status, 503);
  assert.equal(target.downstream_error, "error");
  assert.equal(target.downstream_sent_at, "2020-01-02T00:00:00Z");
  const second = await migrateAutoSeoBackups(options);
  assert.equal(second.inserted, 0);
  assert.equal(second.alreadyMigrated, 1);
  assert.equal(second.conflicts, 0);
  assert.equal(second.mismatches, 0);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  assert.equal(source.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count, 1);
  assert.equal(source.prepare("PRAGMA table_info(auto_seo_product_backups)").all().some(row => row.name === "gpt_settings_json"), false);
  assert.equal(source.prepare("SELECT COUNT(*) AS count FROM seo_review_items").get()?.count, 1);
  source.close();
  const sourceAfter = captureAutoSeoSourceState(sourcePath);
  assert.equal(sourceAfter.contentHash, sourceBefore.contentHash);
  assert.equal(sourceAfter.fileFingerprint, sourceBefore.fileFingerprint);
  assert.equal(sourceAfter.preflight.sourceCount, sourceBefore.preflight.sourceCount);
  assert.deepEqual(sourceAfter.preflight.columns, sourceBefore.preflight.columns);
  assert.deepEqual(sourceAfter.preflight.indexes, sourceBefore.preflight.indexes);
  assert.equal((await pool.query("SELECT to_regclass($1) AS name", [`${schema}.seo_review_items`])).rows[0].name, null);
});

integrationTest("source preflight rejects absent, plain, and differently composed unique indexes before target write", async () => {
  const targetCountBefore = (await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups`)).rows[0].count;
  for (const keys of [
    { backup: "none" as const },
    { backup: "plain" as const },
    { backup: "partial" as const },
    { backup: "wrong-column" as const },
    { tuple: "none" as const },
    { tuple: "plain" as const },
    { tuple: "partial" as const },
    { tuple: "wrong-order" as const },
    { tuple: "wrong-column" as const },
  ]) {
    const { sourcePath } = fixture(false, keys);
    const missingKey = keys.backup ? "backup_id" : "workflow_id, store_id, product_id";
    await assert.rejects(
      migrateAutoSeoBackups({ sourcePath, databaseUrl: databaseUrl ?? "", schema }),
      error => error instanceof Error && error.message.includes("AUTO_SEO_SOURCE_UNIQUE_CONSTRAINT_MISSING") && error.message.includes(missingKey),
    );
  }
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups`)).rows[0].count, targetCountBefore);
});

integrationTest("source state captures content hash, columns, row count, and ordered unique definitions", () => {
  const { sourcePath } = fixture(false);
  const before = captureAutoSeoSourceState(sourcePath);
  assert.equal(before.preflight.sourceCount, 1);
  assert.deepEqual(before.preflight.indexes.filter(index => index.isUnique).map(index => index.columns), [
    ["workflow_id", "store_id", "product_id"], ["backup_id"],
  ]);
  assert.equal(before.contentHash, createHash("sha256").update(readFileSync(sourcePath)).digest("hex"));
  assert.ok(before.preflight.indexes.filter(index => index.isUnique).every(index => !index.isPartial));
  const after = captureAutoSeoSourceState(sourcePath);
  assert.deepEqual(after, before);
});

integrationTest("CLI succeeds when source remains unchanged", async () => {
  const { sourcePath } = fixture(false);
  const messages: string[] = [];
  await runAutoSeoMigrationLocal({ sourcePath, databaseUrl: databaseUrl ?? "", schema, dryRun: true }, message => messages.push(message));
  assert.ok(messages.some(message => message.includes('"sourceUnchanged": true')));
});

integrationTest("source change before COMMIT rolls back target writes", async () => {
  const { sourcePath, backupId } = fixture(false);
  await assert.rejects(migrateAutoSeoBackups({
    sourcePath, databaseUrl: databaseUrl ?? "", schema,
    beforeCommitForTesting: () => {
      const writer = new DatabaseSync(sourcePath);
      writer.prepare("UPDATE auto_seo_product_backups SET product_title='changed' WHERE backup_id=?").run(backupId);
      writer.close();
    },
  }), /AUTO_SEO_SOURCE_CHANGED_DURING_MIGRATION/);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [backupId])).rows[0].count, "0");
});

integrationTest("CLI fails closed when source changes after COMMIT and retains committed target row", async () => {
  const { sourcePath, backupId } = fixture(false);
  const messages: string[] = [];
  await assert.rejects(runAutoSeoMigrationLocal({
    sourcePath, databaseUrl: databaseUrl ?? "", schema,
    afterCommitForTesting: () => {
      const writer = new DatabaseSync(sourcePath);
      writer.prepare("UPDATE auto_seo_product_backups SET product_title='changed' WHERE backup_id=?").run(backupId);
      writer.close();
    },
  }, message => messages.push(message)), error => error instanceof Error &&
    error.message.includes("AUTO_SEO_MIGRATION_COMMITTED_SOURCE_CHANGED") &&
    error.message.toLowerCase().includes("do not cut over") &&
    error.message.includes("stop or quiesce writers") &&
    !error.message.includes("ROLLBACK"));
  assert.ok(messages.some(message => message.includes('"sourceUnchanged": false')));
  assert.ok(messages.some(message => message.includes('"cutoverSafe": false')));
  assert.ok(messages.every(message => !message.includes('"phase": "migration"')));
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [backupId])).rows[0].count, "1");
});

integrationTest("new source schema preserves GPT settings and detects conflicting target data", async () => {
  const { sourcePath, backupId } = fixture(true);
  const options = { sourcePath, databaseUrl: databaseUrl ?? "", schema };
  const first = await migrateAutoSeoBackups(options);
  assert.equal(first.inserted, 1);
  const target = (await pool.query(`SELECT gpt_settings_json FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [backupId])).rows[0];
  assert.equal(target.gpt_settings_json, '{"provider":"custom"}');
  await pool.query(`UPDATE ${schema}.auto_seo_product_backups SET product_title='other' WHERE backup_id=$1`, [backupId]);
  const dry = await migrateAutoSeoBackups({ ...options, dryRun: true });
  assert.equal(dry.conflicts, 1);
  await assert.rejects(migrateAutoSeoBackups(options), /conflict/i);
});

integrationTest("dry run detects a target workflow key conflict with a different backup ID", async () => {
  const first = fixture(false);
  const second = fixture(false);
  const source = new DatabaseSync(first.sourcePath);
  const other = new DatabaseSync(second.sourcePath, { readOnly: true });
  const row = other.prepare("SELECT * FROM auto_seo_product_backups").get();
  assert.ok(row);
  source.prepare(`INSERT INTO auto_seo_product_backups
    (backup_id,workflow_id,store_id,shop_domain,product_id,product_handle,product_title,
    shopify_updated_at,snapshot_json,snapshot_sha256,downstream_status,downstream_http_status,
    downstream_error,downstream_sent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.backup_id, row.workflow_id, row.store_id, row.shop_domain, row.product_id,
      row.product_handle, row.product_title, row.shopify_updated_at, row.snapshot_json,
      row.snapshot_sha256, row.downstream_status, row.downstream_http_status,
      row.downstream_error, row.downstream_sent_at, row.created_at,
    );
  source.close(); other.close();
  await pool.query(`INSERT INTO ${schema}.auto_seo_product_backups
    (backup_id,workflow_id,store_id,shop_domain,product_id,product_handle,product_title,snapshot_json,snapshot_sha256,downstream_status)
    VALUES ($1,$2,'store','shop.myshopify.com',$3,'handle','conflict','{}',$4,'NOT_SENT')`,
    [randomUUID(), `workflow-${second.backupId}`, `product-${second.backupId}`, "b".repeat(64)]);
  const options = { sourcePath: first.sourcePath, databaseUrl: databaseUrl ?? "", schema };
  const dry = await migrateAutoSeoBackups({ ...options, dryRun: true });
  assert.equal(dry.plannedInserts, 1);
  assert.equal(dry.conflicts, 1);
  await assert.rejects(migrateAutoSeoBackups(options), /conflict/i);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [first.backupId])).rows[0].count, "0");
});

integrationTest("invalid second record rolls back the first inserted record", async () => {
  const first = fixture(false);
  const second = fixture(false);
  const source = new DatabaseSync(first.sourcePath);
  const other = new DatabaseSync(second.sourcePath, { readOnly: true });
  const row = other.prepare("SELECT * FROM auto_seo_product_backups").get();
  assert.ok(row);
  source.prepare(`INSERT INTO auto_seo_product_backups
    (backup_id,workflow_id,store_id,shop_domain,product_id,product_handle,product_title,
    shopify_updated_at,snapshot_json,snapshot_sha256,downstream_status,downstream_http_status,
    downstream_error,downstream_sent_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      row.backup_id, row.workflow_id, row.store_id, row.shop_domain, row.product_id,
      row.product_handle, row.product_title, row.shopify_updated_at, row.snapshot_json,
      row.snapshot_sha256, row.downstream_status, 2147483648,
      row.downstream_error, row.downstream_sent_at, row.created_at,
    );
  source.close(); other.close();
  await assert.rejects(migrateAutoSeoBackups({ sourcePath: first.sourcePath, databaseUrl: databaseUrl ?? "", schema }), /out of range/i);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [first.backupId])).rows[0].count, "0");
});

integrationTest("post-commit verification failure reports committed state and retains the inserted row", async () => {
  const { sourcePath, backupId } = fixture(false);
  let hookCalls = 0;
  await assert.rejects(
    migrateAutoSeoBackups({
      sourcePath,
      databaseUrl: databaseUrl ?? "",
      schema,
      afterCommitForTesting: () => { hookCalls++; throw new Error("simulated post-commit read failure"); },
    }),
    error => error instanceof Error &&
      error.message.includes("AUTO_SEO_MIGRATION_COMMITTED_POST_VERIFY_FAILED") &&
      error.message.includes("COMMIT") &&
      error.message.includes("manual investigation") &&
      !error.message.includes("ROLLBACK"),
  );
  assert.equal(hookCalls, 1);
  assert.equal((await pool.query(`SELECT COUNT(*) FROM ${schema}.auto_seo_product_backups WHERE backup_id=$1`, [backupId])).rows[0].count, "1");
  const second = await migrateAutoSeoBackups({ sourcePath, databaseUrl: databaseUrl ?? "", schema });
  assert.equal(second.inserted, 0);
  assert.equal(second.alreadyMigrated, 1);
});
