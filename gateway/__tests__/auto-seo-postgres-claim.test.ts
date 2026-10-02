import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

import { Pool } from "pg";

import { AutoSeoPostgresRepository } from "../auto-seo-postgres-repository";
import type { AutoSeoPostgresBackupInput } from "../auto-seo-postgres-repository";

function backup(index: number, overrides: Partial<AutoSeoPostgresBackupInput> = {}): AutoSeoPostgresBackupInput {
  return {
    backupId: `test-backup-${index}`, workflowId: "test-workflow", storeId: "test-store",
    shopDomain: "test.myshopify.com", productId: `gid://shopify/Product/${index}`,
    productHandle: `test-product-${index}`, productTitle: `Test product ${index}`,
    snapshotJson: JSON.stringify({ id: `gid://shopify/Product/${index}`, title: `Test product ${index}` }),
    snapshotSha256: "snapshot-hash", seoInputSha256: `input-hash-${index}`,
    ...overrides,
  };
}

test("Auto SEO claims send PostgreSQL-safe, unambiguous lock keys for every product", async context => {
  const lockKeys: string[] = [];
  const statements: string[] = [];
  const client = {
    async query(statement: string, parameters: readonly unknown[] = []) {
      statements.push(statement);
      if (statement.includes("pg_advisory_xact_lock")) {
        assert.equal(typeof parameters[0], "string");
        const key = String(parameters[0]);
        assert.equal(key.includes(String.fromCharCode(0)), false, "PostgreSQL text parameters must not contain NUL");
        lockKeys.push(key);
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  context.mock.method(Pool.prototype, "connect", async () => client);
  const repository = new AutoSeoPostgresRepository({ databaseUrl: "postgresql://ffp_tool:test@127.0.0.1:5432/ffp_tool" });
  const records = Array.from({ length: 100 }, (_unused, index) => backup(index));
  try {
    const claimed = await repository.claimEligibleBatch(records);
    assert.equal(claimed.acceptedRecords.length, 100);
    assert.equal(lockKeys.length, 100);
    assert.equal(new Set(lockKeys).size, 100);
    assert.deepEqual(lockKeys.map(key => JSON.parse(key)).sort(), records.map(record => [record.storeId, record.productId]).sort());
    assert.equal(statements.at(-1), "COMMIT");
    const ambiguous = [backup(101, { storeId: "a:b", productId: "c" }), backup(102, { storeId: "a", productId: "b:c" })];
    await repository.claimEligibleBatch(ambiguous);
    assert.notEqual(lockKeys.at(-1), lockKeys.at(-2));
  } finally { await repository.close(); }
});

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;
const integrationTest = databaseUrl ? test : test.skip;

async function withRepositories(run: (first: AutoSeoPostgresRepository, second: AutoSeoPostgresRepository) => Promise<void>): Promise<void> {
  assert.ok(databaseUrl);
  const schema = `auto_seo_claim_test_${randomUUID().replaceAll("-", "")}`;
  const first = new AutoSeoPostgresRepository({ databaseUrl, schema });
  const second = new AutoSeoPostgresRepository({ databaseUrl, schema });
  const cleanup = new Pool({ connectionString: databaseUrl });
  try { await first.initializeSchema(); await run(first, second); }
  finally {
    await first.close(); await second.close();
    try { await cleanup.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); }
    finally { await cleanup.end(); }
  }
}

integrationTest("PostgreSQL accepts a 100-product Auto SEO claim and skips unchanged revisions", async () => {
  await withRepositories(async first => {
    const records = Array.from({ length: 100 }, (_unused, index) => backup(index));
    const settings = JSON.stringify({ provider: "codex_mcp", batchSize: 10 });
    const claimed = await first.claimEligibleBatch(records, { gptSettingsJson: settings });
    assert.equal(claimed.acceptedRecords.length, 100);
    assert.equal(await first.countByWorkflow("test-workflow"), 100);
    assert.equal((await first.findByBackupId(records[0]?.backupId ?? ""))?.gptSettingsJson, settings);
    await first.updateDownstreamStatus("test-workflow", records.map(record => record.backupId), "SENT");
    const duplicate = await first.claimEligibleBatch(records.map(record => ({ ...record, backupId: record.backupId + "-duplicate", workflowId: "next-workflow" })));
    assert.equal(duplicate.acceptedRecords.length, 0);
    assert.equal(duplicate.skippedProducts.length, 100);
    assert.ok(duplicate.skippedProducts.every(product => product.reason === "UNCHANGED"));
  });
});

integrationTest("concurrent reversed Auto SEO batches claim each product only once and retain failed retries", async () => {
  await withRepositories(async (first, second) => {
    const records = [backup(1), backup(2)];
    const competing = [...records].reverse().map(record => ({ ...record, backupId: record.backupId + "-other", workflowId: "other-workflow" }));
    const claims = await Promise.all([first.claimEligibleBatch(records), second.claimEligibleBatch(competing)]);
    assert.equal(claims.reduce((count, claim) => count + claim.acceptedRecords.length, 0), 2);
    assert.equal(claims.reduce((count, claim) => count + claim.skippedProducts.length, 0), 2);
    assert.ok(claims.flatMap(claim => claim.skippedProducts).every(product => product.reason === "ACTIVE_DUPLICATE"));
    const accepted = claims.flatMap(claim => claim.acceptedRecords);
    for (const record of accepted) await first.updateDownstreamStatus(record.workflowId, [record.backupId], "FAILED", null, "Retry fixture");
    const retry = await first.claimEligibleBatch(accepted.map(record => ({ ...record, backupId: record.backupId + "-retry", workflowId: "retry-workflow" })));
    assert.equal(retry.acceptedRecords.length, 2);
  });
});
