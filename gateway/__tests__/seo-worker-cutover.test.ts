import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoCutoverRepository } from "../seo-worker/cutover";

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
    const job = { source: "auto_seo", sourceIdentity: "123", input: { productId: "123" }, settings: { provider: "codex_mcp" }, status: "PENDING" };
    await pg.query("INSERT INTO gpt_jobs VALUES ('one','demo','d','PENDING',NULL,$1,1,'codex_mcp',DEFAULT)", [JSON.stringify(job)]);
    await assert.rejects(cutover.apply("demo", snapshot.fingerprint, "operator"), /BACKUP_STALE/);
    await pg.query("INSERT INTO gpt_jobs VALUES ('two','demo','d2','PENDING',NULL,$1,2,'codex_mcp',DEFAULT)", [JSON.stringify(job)]);
    const report = await cutover.inspect("demo");
    assert.deepEqual(report.duplicates, [{ productKey: "shopify:123", jobIds: ["one", "two"] }]);
    assert.equal(imports, 0);
    await assert.rejects(cutover.apply("demo", report.fingerprint, "operator"), /CUTOVER_BLOCKED/);
  } finally { await pg.close(); }
});
