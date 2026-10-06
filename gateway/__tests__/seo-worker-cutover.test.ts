import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoCutoverRepository } from "../seo-worker/cutover";

import { createTestEnqueue } from "./seo-v2-fixtures";

test("cutover requires draining, detects changed backup source and reports duplicate identities", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  let imports = 0;
  const cutover = new SeoCutoverRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, async () => ({ imported: ++imports }));
  try {
    const before = await cutover.inspect("demo");
    await assert.rejects(cutover.apply("demo", before.fingerprint, "operator"), /CUTOVER_NOT_DRAINING/);
    await cutover.drain("demo", "operator");
    const snapshot = await cutover.inspect("demo");
    const enqueue = createTestEnqueue({ storeId: "demo", productId: "123" });
    const job = (id: string) => ({ id, storeId: "demo", source: "auto_seo", sourceIdentity: "123", input: enqueue.input, execution: enqueue.execution,
      original: enqueue.execution.originalSnapshot, inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "en-US", instructions: "test" },
      status: "PENDING", checkpoints: {}, createdAt: 1, updatedAt: 1 });
    await pg.query("INSERT INTO gpt_jobs VALUES ('one','demo','d','PENDING',NULL,$1,1,'codex_mcp',DEFAULT)", [JSON.stringify(job("one"))]);
    await assert.rejects(cutover.apply("demo", snapshot.fingerprint, "operator"), /BACKUP_STALE/);
    await pg.query("INSERT INTO gpt_jobs VALUES ('two','demo','d2','PENDING',NULL,$1,2,'codex_mcp',DEFAULT)", [JSON.stringify(job("two"))]);
    const report = await cutover.inspect("demo");
    assert.deepEqual(report.duplicates, [{ productKey: "shopify:123", jobIds: ["one", "two"] }]);
    assert.equal(imports, 0);
    await assert.rejects(cutover.apply("demo", report.fingerprint, "operator"), /CUTOVER_BLOCKED/);
  } finally { await pg.close(); }
});

test("cutover preserves failed V1 history and reports an explicit profile migration error", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  const cutover = new SeoCutoverRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, async () => ({ imported: 0 }));
  const failed = { id: "failed", storeId: "unknown-store", source: "auto_seo", sourceIdentity: "123", status: "FAILED",
    input: { niche: "Bedding", images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }] }, original: {}, checkpoints: {},
    settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "en-US", instructions: "legacy" }, createdAt: 1, updatedAt: 1 };
  try {
    await pg.query("INSERT INTO gpt_jobs VALUES ('failed','unknown-store','d','FAILED',NULL,$1,1,'codex_mcp',DEFAULT)", [JSON.stringify(failed)]);
    const report = await cutover.inspect("unknown-store");
    assert.deepEqual(report.blocked, [{ jobId: "failed", code: "JOB_MIGRATION_PROFILE_REQUIRED" }]);
    assert.deepEqual(JSON.parse(String((await pg.query<{ payload: string }>("SELECT payload FROM gpt_jobs WHERE id='failed'")).rows[0].payload)), failed);
  } finally { await pg.close(); }
});
