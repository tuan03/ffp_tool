import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { DatabaseSync } from "node:sqlite";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { PostgresQueueDatabase, getQueueSchemaSql, translateQueueSql } from "../custom-gpt-seo/postgres-database";
import { SeoWorkerRepository } from "../seo-worker/repository";
import { createTestEnqueue } from "./seo-v2-fixtures";

test("PostgreSQL bulk retry fences active workers, completed reviews, archives and idempotent replay", async context => {
  const db = await PGlite.create();
  const sqlite = new DatabaseSync(":memory:");
  const queue = new PostgresCustomGptQueue({ databaseUrl: "postgresql://test:test@127.0.0.1/unused" });
  type Query = (sql: string, values?: readonly unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
  const read: Query = async (sql, values) => db.query<Record<string, unknown>>(sql, [...(values ?? [])]);
  let currentQuery: Query | null = null;
  async function transaction<T>(operation: () => Promise<T>): Promise<T> {
    if (currentQuery) return operation();
    return db.transaction(async tx => {
      currentQuery = async (sql, values) => tx.query<Record<string, unknown>>(sql, [...(values ?? [])]);
      try { return await operation(); } finally { currentQuery = null; }
    });
  }
  context.mock.method(PostgresQueueDatabase.prototype, "transaction", transaction);
  context.mock.method(PostgresQueueDatabase.prototype, "prepare", (sql: string) => ({
    get: async (...values: unknown[]) => (await (currentQuery ?? read)(translateQueueSql(sql, "public"), values)).rows[0],
    all: async (...values: unknown[]) => (await (currentQuery ?? read)(translateQueueSql(sql, "public"), values)).rows,
    run: async (...values: unknown[]) => { await (currentQuery ?? read)(translateQueueSql(sql, "public"), values); return { changes: 1 }; },
  }));
  Object.defineProperty(queue, "workers", { value: new SeoWorkerRepository({ transaction: operation => transaction(() => operation({ query: (sql, values) => (currentQuery ?? read)(sql, values) })) }) });
  try {
    await db.exec(getQueueSchemaSql("public"));
    const seed = new CustomGptQueue(sqlite).enqueue(createTestEnqueue({ storeId: "sample" }));
    for (const id of ["blocked", "claimed", "review", "archived"]) {
      const status = id === "review" ? "REVIEW_READY" : "PENDING";
      const payload = { ...seed, id, status, ...(id === "archived" ? { queueArchivedAt: 1 } : {}) };
      await db.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES($1,'sample',$1,$2,$3,1)", [id, status, JSON.stringify(payload)]);
      await db.query("INSERT INTO seo_worker_jobs(job_id,store_id,product_key,state,updated_at,lease_version) VALUES($1,'sample',$1,'BLOCKED',1,7)", [id]);
    }
    assert.ok((await queue.retryCandidates("sample")).includes("claimed"));
    await db.exec("UPDATE seo_worker_jobs SET state='PROCESSING',lease_id='active-lease' WHERE job_id='claimed'");
    for (const id of ["claimed", "review", "archived", "missing"]) assert.equal((await queue.retrySafely("sample", id, "run")).status, "skipped");
    assert.equal((await queue.retrySafely("other", "blocked", "run")).status, "skipped");
    assert.equal((await queue.retrySafely("sample", "blocked", "run")).status, "retried");
    assert.deepEqual((await db.query("SELECT state,lease_version FROM seo_worker_jobs WHERE job_id='blocked'")).rows[0], { state: "READY", lease_version: 7 });
    await db.exec("UPDATE seo_worker_jobs SET state='BLOCKED' WHERE job_id='blocked'");
    assert.equal((await queue.retrySafely("sample", "blocked", "run")).status, "retried");
    assert.equal((await db.query<{ state: string }>("SELECT state FROM seo_worker_jobs WHERE job_id='blocked'")).rows[0].state, "BLOCKED");
  } finally { await queue.close(); await db.close(); sqlite.close(); }
});
