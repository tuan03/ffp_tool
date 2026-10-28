import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

import { QUEUE_CATALOG_PAYLOAD_SQL, buildQueueCatalogJob } from "../custom-gpt-seo/queue-catalog";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import { PostgresQueueDatabase, getQueueSchemaSql, translateQueueSql } from "../custom-gpt-seo/postgres-database";
import { DatabaseSync } from "node:sqlite";
import { createTestEnqueue } from "./seo-v2-fixtures";

test("catalog SQL and API keep labels and progress without shipping full snapshots or image lists", async () => {
  const database = await PGlite.create();
  const sqlite = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(sqlite);
    const job = queue.enqueue(createTestEnqueue({
      original: { title: "Sample rug", handle: "sample-rug", description: "private snapshot".repeat(1000) },
      input: { niche: "rug", images: [{ id: "front", url: "https://example.test/front.jpg" }, { id: "back", url: "https://example.test/back.jpg" }] },
    }));
    const source = { ...job, checkpoints: { analysis: { private: "large analysis" }, research: { private: "large research" } }, result: { private: "large result" } };
    const projected = (await database.query<{ payload: string }>(
      `WITH snapshots AS MATERIALIZED (SELECT $1::jsonb AS snapshot) SELECT ${QUEUE_CATALOG_PAYLOAD_SQL} AS payload FROM snapshots`,
      [JSON.stringify(source)],
    )).rows[0].payload;
    const parsed: typeof job = JSON.parse(projected);
    const fromSql = buildQueueCatalogJob(parsed);
    const fromMemory = buildQueueCatalogJob(source);
    assert.deepEqual(JSON.parse(JSON.stringify(fromSql)), JSON.parse(JSON.stringify(fromMemory)));
    assert.deepEqual(fromSql.queueDisplay, { sourceTitle: "Sample rug", sourceHandle: "sample-rug", checkpointStages: ["analysis", "research"] });
    assert.equal(fromSql.input.images.length, 1);
    assert.equal(fromSql.original, null);
    assert.equal(fromSql.execution.originalSnapshot, null);
    assert.deepEqual(fromSql.checkpoints, {});
    assert.doesNotMatch(JSON.stringify(fromSql), /private snapshot|large analysis|large research|large result|back.jpg/);
    assert.equal(source.input.images.length, 2);
    assert.ok(source.execution.originalSnapshot);
  } finally { await database.close(); sqlite.close(); }
});

test("PostgreSQL catalog filters worker states before pagination and preserves archive/store boundaries", async context => {
  const database = await PGlite.create();
  const sqlite = new DatabaseSync(":memory:");
  const queue = new PostgresCustomGptQueue({ databaseUrl: "postgresql://test:test@127.0.0.1/unused" });
  context.mock.method(PostgresQueueDatabase.prototype, "prepare", (sql: string) => {
    const query = (parameters: readonly unknown[]) => database.query<Record<string, unknown>>(translateQueueSql(sql, "public"), [...parameters]);
    return {
      all: async (...parameters: readonly unknown[]) => (await query(parameters)).rows,
      get: async (...parameters: readonly unknown[]) => (await query(parameters)).rows[0],
      run: async (...parameters: readonly unknown[]) => ({ changes: (await query(parameters)).affectedRows ?? 0 }),
    };
  });
  try {
    await database.exec(getQueueSchemaSql("public"));
    const seed = new CustomGptQueue(sqlite).enqueue(createTestEnqueue({ original: { title: "Fixture" } }));
    for (let index = 0; index < 56; index++) {
      const storeId = index === 55 ? "other" : "sample";
      const job = { ...seed, id: String(index), storeId, status: index === 54 ? "CANCELLED" : "PENDING", ...(index === 53 ? { queueArchivedAt: 1000 } : {}) };
      await database.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES($1,$2,$1,$3,$4,$5,'codex_mcp')",
        [job.id, storeId, job.status, JSON.stringify(job), index]);
      await database.query("INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at) VALUES($1,$2,$1,$3,1000)",
        [job.id, storeId, index === 52 ? "RETRY_WAIT" : "BLOCKED"]);
    }
    const filters = { statuses: ["WAITING_INPUT", "FAILED"] as const };
    const first = await queue.listFiltered("sample", filters);
    const second = await queue.listFiltered("sample", filters, 50);
    assert.equal(first.length, 50);
    assert.deepEqual(second.map(job => job.id), ["50", "51", "52"]);
    assert.equal(second[2].status, "FAILED");
    assert.equal(first[0].status, "WAITING_INPUT");
    assert.equal(await queue.countFiltered("sample", filters), 53);
    assert.deepEqual(await queue.visibleCounts("sample"), { WAITING_INPUT: 52, FAILED: 1 });
    assert.equal((await queue.listFiltered("other", filters)).length, 1);
    assert.equal((await queue.listFiltered("sample", { ...filters, provider: "custom_gpt" })).length, 0);
    assert.deepEqual((await queue.get("sample", "0")).original, seed.original);
    assert.deepEqual(first[0].original, { title: "Fixture", sourceTitle: null, handle: null });
    await database.query("UPDATE seo_worker_jobs SET state='READY' WHERE job_id='0'");
    assert.equal(await queue.countFiltered("sample", filters), 52);
    assert.equal((await queue.listFiltered("sample", filters))[0].id, "1");
  } finally { await queue.close(); await database.close(); sqlite.close(); }
});
