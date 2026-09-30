import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { Pool } from "pg";

import { handleAutoSeoRun } from "../auto-seo-handler";
import { AutoSeoPostgresRepository, requireLocalAutoSeoDatabase } from "../auto-seo-postgres-repository";

const databaseUrl = process.env.AUTO_SEO_TEST_DATABASE_URL;
const sqlitePath = ".local-data/auto-seo.sqlite3";
const integrationTest = databaseUrl && existsSync(sqlitePath) ? test : test.skip;

integrationTest("default Auto SEO runtime writes PostgreSQL and leaves the original SQLite backup count unchanged", async () => {
  const localUrl = databaseUrl ?? "";
  requireLocalAutoSeoDatabase(localUrl);
  const repository = new AutoSeoPostgresRepository({ databaseUrl: localUrl });
  await repository.verifyLocalTarget();
  const pool = new Pool({ connectionString: localUrl });
  const sqlite = new DatabaseSync(sqlitePath, { readOnly: true });
  const workflowId = `b3-default-test-${randomUUID()}`;
  const sqliteCount = Number(sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count);
  const postgresCount = Number((await pool.query("SELECT COUNT(*) AS count FROM public.auto_seo_product_backups")).rows[0]?.count);
  const previousRuntimeUrl = process.env.AUTO_SEO_DATABASE_URL;
  process.env.AUTO_SEO_DATABASE_URL = localUrl;
  try {
    let sawCommitted = false;
    const run = await handleAutoSeoRun({ workflowId, storeId: "b3-local-test-store", shopDomain: "b3-local-test.myshopify.com", products: [{ id: "b3-local-product", title: "B3 local product", handle: "b3-local-product" }] }, {
      seoContentRunner: async () => {
        sawCommitted = (await repository.countByWorkflow(workflowId)) === 1;
        return { success: true, processedCount: 1 };
      },
    });
    assert.equal(sawCommitted, true);
    assert.equal(run.downstreamStatus, "SENT");
    assert.equal((await repository.findByBackupId(run.backupIds[0] ?? ""))?.downstreamStatus, "SENT");
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM public.auto_seo_product_backups")).rows[0]?.count), postgresCount + 1);
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count), sqliteCount);
    const reopened = new AutoSeoPostgresRepository({ databaseUrl: localUrl });
    try { assert.ok(await reopened.findByBackupId(run.backupIds[0] ?? "")); }
    finally { await reopened.close(); }
  } finally {
    await pool.query("DELETE FROM public.auto_seo_product_backups WHERE workflow_id=$1", [workflowId]);
    assert.equal(Number((await pool.query("SELECT COUNT(*) AS count FROM public.auto_seo_product_backups")).rows[0]?.count), postgresCount);
    assert.equal(Number(sqlite.prepare("SELECT COUNT(*) AS count FROM auto_seo_product_backups").get()?.count), sqliteCount);
    await pool.end();
    await repository.close();
    sqlite.close();
    if (previousRuntimeUrl === undefined) delete process.env.AUTO_SEO_DATABASE_URL;
    else process.env.AUTO_SEO_DATABASE_URL = previousRuntimeUrl;
  }
});
