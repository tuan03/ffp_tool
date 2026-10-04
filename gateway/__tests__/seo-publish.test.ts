import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoPublishRepository } from "../seo-worker/publish-repository";
import { processSeoPublish } from "../seo-worker/publish-worker";

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  let now = 1000;
  const repository = new SeoPublishRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, () => now);
  const review = { reviewDecision: "approved", updatedAt: 7, productTitle: { value: "New" }, productDescription: { value: "Description" }, seoTitle: { value: "Title" }, seoDescription: { value: "Meta" } };
  await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('job','demo','d','REVIEW_READY',$1,1,'codex_mcp')", [JSON.stringify({ input: { productId: "123" }, original: { updatedAt: "v1" } })]);
  await pg.query("INSERT INTO gpt_review_state(job_id,payload) VALUES ('job',$1)", [JSON.stringify(review)]);
  await pg.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ('demo',true)");
  const operation = await repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "sync", operator: "operator" });
  return { pg, repository, operation, review, advance: () => { now += 120_001; } };
}

test("publish blocks a changed source and a changed review even if its timestamp is reused", async () => {
  for (const scenario of ["source", "review"] as const) {
    const f = await fixture();
    try {
      if (scenario === "review") await f.pg.query("UPDATE gpt_review_state SET payload=$1 WHERE job_id='job'", [JSON.stringify({ ...f.review, productTitle: { value: "Unapproved change" } })]);
      let writes = 0;
      await processSeoPublish(f.repository, { read: async () => ({ version: scenario === "source" ? "changed" : "v1", fields: f.operation.fields }), write: async () => { writes++; } });
      const result = await f.repository.get("demo", f.operation.id);
      assert.equal(result.state, "BLOCKED");
      assert.equal(result.errorCode, scenario === "source" ? "STALE_SOURCE" : "REVIEW_CHANGED");
      assert.equal(writes, 0);
    } finally { await f.pg.close(); }
  }
});

test("expired writer is fenced and replacement only reconciles without another write", async () => {
  const f = await fixture();
  try {
    const lease = await f.repository.claim();
    assert.ok(lease);
    await f.repository.authorizeWrite(lease);
    f.advance();
    let writes = 0;
    await processSeoPublish(f.repository, { read: async () => ({ version: "v2", fields: f.operation.fields }), write: async () => { writes++; } });
    assert.equal((await f.repository.get("demo", f.operation.id)).state, "SUCCEEDED");
    await assert.rejects(f.repository.confirm(lease), /STALE_PUBLISH_LEASE/);
    assert.equal(writes, 0);
  } finally { await f.pg.close(); }
});

test("uncertain mismatching write blocks without resetting sync or creating another draft", async () => {
  const f = await fixture();
  try {
    const lease = await f.repository.claim();
    assert.ok(lease);
    await f.repository.authorizeWrite(lease);
    await f.repository.defer(lease, true);
    f.advance();
    let writes = 0;
    await processSeoPublish(f.repository, { read: async () => ({ version: "external-edit", fields: { ...f.operation.fields, title: "External" } }), write: async () => { writes++; } });
    assert.equal((await f.repository.get("demo", f.operation.id)).errorCode, "RECONCILIATION_REQUIRED");
    assert.equal(writes, 0);
    assert.equal((await f.pg.query<{ status: string }>("SELECT status FROM gpt_sync")).rows[0].status, "SYNCING");
    assert.equal((await f.pg.query<{ status: string }>("SELECT status FROM gpt_jobs")).rows[0].status, "REVIEW_READY");
    assert.equal((await f.pg.query("SELECT * FROM seo_publish_versions")).rows.length, 0);
  } finally { await f.pg.close(); }
});

test("unavailable source has bounded retries and never writes", async () => {
  const f = await fixture();
  try {
    let reads = 0;
    let writes = 0;
    for (let attempt = 0; attempt < 7; attempt++) {
      await processSeoPublish(f.repository, { read: async () => { reads++; throw new Error("offline"); }, write: async () => { writes++; } });
      f.advance();
    }
    assert.equal(reads, 5);
    assert.equal(writes, 0);
    assert.equal((await f.repository.get("demo", f.operation.id)).state, "BLOCKED");
    await assert.rejects(f.repository.enqueue({ storeId: "demo", jobId: "job", requestId: "sync", reviewUpdatedAt: 8, operator: "operator" }), /IDEMPOTENCY_CONFLICT/);
  } finally { await f.pg.close(); }
});

test("publish survives lost write response without repeating write or incrementing version twice", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  let now = 1000;
  const repository = new SeoPublishRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, () => now);
  const original = { updatedAt: "v1", seoVersion: 3 };
  const job = { id: "job", storeId: "demo", input: { productId: "123" }, original, source: "auto_seo", status: "REVIEW_READY" };
  const review = { reviewDecision: "approved", updatedAt: 7, productTitle: { value: "New title" }, productDescription: { value: "New description" }, seoTitle: { value: "SEO title" }, seoDescription: { value: "Meta" } };
  try {
    await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('job','demo','d','REVIEW_READY',$1,1,'codex_mcp')", [JSON.stringify(job)]);
    await pg.query("INSERT INTO gpt_review_state(job_id,payload) VALUES ('job',$1)", [JSON.stringify(review)]);
    await pg.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ('demo',true)");
    const operation = await repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "sync-1", operator: "admin" });
    assert.equal((await repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "sync-1", operator: "admin" })).id, operation.id);
    let writes = 0;
    let live = { version: "v1", fields: { title: "Old title", descriptionHtml: "Old description", seo: { title: "Old SEO", description: "Old meta" } } };
    const transport = { read: async () => live, write: async () => { writes++; live = { version: "v2", fields: operation.fields }; throw new Error("response lost"); } };
    await processSeoPublish(repository, transport);
    assert.equal(writes, 1);
    assert.equal((await repository.get("demo", operation.id)).state, "UNCERTAIN");
    now += 60_001;
    await processSeoPublish(repository, transport);
    const done = await repository.get("demo", operation.id);
    assert.equal(done.state, "SUCCEEDED"); assert.equal(done.seoVersion, 4);
    await processSeoPublish(repository, transport);
    assert.equal(writes, 1);
    assert.equal(Number((await pg.query<{ count: string }>("SELECT count(*) FROM seo_publish_versions")).rows[0].count), 1);
    await assert.rejects(repository.get("other", operation.id), /PUBLISH_NOT_FOUND/);
    assert.equal((await pg.query<{ status: string }>("SELECT status FROM gpt_sync WHERE job_id='job'")).rows[0].status, "SYNCED");
  } finally { await pg.close(); }
});
