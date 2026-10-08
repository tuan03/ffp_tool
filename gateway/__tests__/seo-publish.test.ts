import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { SeoPublishRepository } from "../seo-worker/publish-repository";
import type { PublishFields, PublishOperation } from "../seo-worker/publish-repository";
import { processSeoPublish } from "../seo-worker/publish-worker";
import { SeoWorkerError } from "../seo-worker/protocol";

import { createTestEnqueue } from "./seo-v2-fixtures";

async function fixture(descriptionHtml = "Description", reviewFields: Record<string, unknown> = {}) {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  let now = 1000;
  const repository = new SeoPublishRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, () => now);
  const review = { reviewDecision: "approved", updatedAt: 7, productTitle: { value: "New" }, productDescription: { value: descriptionHtml }, seoTitle: { value: "Title" }, seoDescription: { value: "Meta" }, ...reviewFields };
  const enqueue = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "v1", original: { updatedAt: "v1" } });
  await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ('job','demo','d','REVIEW_READY',$1,1,'codex_mcp')", [JSON.stringify({ input: enqueue.input, execution: enqueue.execution, original: enqueue.execution.originalSnapshot })]);
  await pg.query("INSERT INTO gpt_review_state(job_id,payload) VALUES ('job',$1)", [JSON.stringify(review)]);
  await pg.query("INSERT INTO seo_worker_stores(store_id,enabled) VALUES ('demo',true)");
  const operation = await repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "sync", operator: "operator" });
  return { pg, repository, operation, review, advance: () => { now += 120_001; } };
}

const approvedAeo = {
  aeoQuickSummary: { value: "Red bag & floral artwork" },
  aeoFaq: { value: [{ question: "What <design> is shown?", answer: "A floral motif & portrait." }] },
  aeoJsonLd: { value: JSON.stringify({ "@context": "https://schema.org", "@graph": [{ "@type": "Product", name: "Red bag" }, { "@type": "FAQPage" }] }) },
};

test("publish freezes approved AEO HTML and JSON-LD and retries without another write", async () => {
  const f = await fixture("Description", approvedAeo);
  try {
    const html = f.operation.fields.metafields?.find(field => field.key === "aeo_suite_html");
    assert.equal(html?.type, "multi_line_text_field");
    assert.match(html?.value ?? "", /Red bag &amp; floral artwork/);
    assert.match(html?.value ?? "", /What &lt;design&gt; is shown\?/);
    assert.equal(f.operation.fields.metafields?.find(field => field.key === "aeo_json_ld")?.type, "json");
    assert.equal(f.operation.fields.metafields?.length, 4);
    let writes = 0;
    let live: PublishFields = f.operation.fields;
    const transport = { read: async () => ({ version: writes ? "v2" : "v1", fields: live }),
      write: async (op: PublishOperation) => { writes++; live = op.fields; throw new Error("response lost"); } };
    await processSeoPublish(f.repository, transport);
    f.advance();
    await processSeoPublish(f.repository, transport);
    assert.equal((await f.repository.get("demo", f.operation.id)).state, "SUCCEEDED");
    assert.equal(writes, 1);
  } finally { await f.pg.close(); }
});

test("publish refuses incomplete AEO or JSON-LD without Product and FAQPage before queuing", async () => {
  const f = await fixture();
  try {
    await f.pg.query("DELETE FROM seo_publish_operations WHERE job_id='job'");
    await f.pg.query("DELETE FROM gpt_sync WHERE job_id='job'");
    for (const fields of [
      { aeoQuickSummary: approvedAeo.aeoQuickSummary },
      { ...approvedAeo, aeoJsonLd: { value: '{"@context":"https://schema.org","@graph":[{"@type":"Product"}]}' } },
      { ...approvedAeo, aeoFaq: { value: [] } },
    ]) {
      await f.pg.query("UPDATE gpt_review_state SET payload=$1 WHERE job_id='job'", [JSON.stringify({ ...f.review, ...fields })]);
      await assert.rejects(f.repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "aeo-invalid", operator: "operator" }), /INVALID_AEO_FIELDS/);
    }
    assert.equal((await f.pg.query("SELECT id FROM seo_publish_operations WHERE job_id='job'")).rows.length, 0);
    assert.equal((await f.pg.query("SELECT job_id FROM gpt_sync WHERE job_id='job'")).rows.length, 0);
  } finally { await f.pg.close(); }
});

test("publish blocks missing AEO HTML on read-back instead of claiming sync success", async () => {
  const f = await fixture("Description", approvedAeo);
  try {
    let writes = 0;
    await processSeoPublish(f.repository, {
      read: async () => ({ version: writes ? "v2" : "v1", fields: { ...f.operation.fields,
        metafields: f.operation.fields.metafields?.map(field => writes && field.key === "aeo_suite_html" ? { ...field, value: "" } : field) } }),
      write: async () => { writes++; },
    });
    assert.equal((await f.repository.get("demo", f.operation.id)).errorCode, "RECONCILIATION_REQUIRED");
    assert.equal((await f.pg.query<{ status: string }>("SELECT status FROM gpt_sync WHERE job_id='job'")).rows[0]?.status, "SYNCING");
  } finally { await f.pg.close(); }
});

test("read-back confirms block formatting without a second write but blocks actual content changes", async () => {
  for (const changed of [false, true]) {
    const f = await fixture("<p>Bag</p><ul><li>Red</li></ul>");
    try {
      let writes = 0;
      const transport = {
        read: async () => ({ version: writes ? "v2" : "v1", fields: { ...f.operation.fields,
          descriptionHtml: writes ? `<p>Bag</p>\n<ul>\n<li>${changed ? "Blue" : "Red"}</li>\n</ul>` : f.operation.fields.descriptionHtml } }),
        write: async () => { writes++; throw new Error("response lost"); },
      };
      await processSeoPublish(f.repository, transport);
      f.advance();
      await processSeoPublish(f.repository, transport);
      assert.equal((await f.repository.get("demo", f.operation.id)).state, changed ? "BLOCKED" : "SUCCEEDED");
      assert.equal(writes, 1);
    } finally { await f.pg.close(); }
  }
});

test("publish reports invalid image identity separately from approval and never queues a write", async () => {
  const f = await fixture();
  try {
    await f.pg.query("DELETE FROM seo_publish_operations WHERE job_id='job'");
    await f.pg.query("UPDATE gpt_review_state SET payload=$1 WHERE job_id='job'", [JSON.stringify({
      ...f.review, images: [{ id: "img-0-old", alt: { value: "Approved ALT" } }],
    })]);
    await assert.rejects(f.repository.enqueue({ storeId: "demo", jobId: "job", reviewUpdatedAt: 7, requestId: "retry", operator: "operator" }), /REVIEW_IMAGE_MAPPING_REQUIRED/);
    const rows = await f.pg.query("SELECT id FROM seo_publish_operations WHERE job_id='job'");
    assert.equal(rows.rows.length, 0);
  } finally { await f.pg.close(); }
});

test("definite pre-write rejection clears write intent and retries only after operator request", async () => {
  const f = await fixture();
  try {
    await processSeoPublish(f.repository, {
      read: async () => ({ version: "v1", fields: f.operation.fields }),
      write: async () => { throw new SeoWorkerError("PUBLISH_INPUT_REJECTED"); },
    });
    const rejected = await f.pg.query<{state: string; has_write_intent: boolean; error_code: string}>("SELECT state,has_write_intent,error_code FROM seo_publish_operations WHERE id=$1", [f.operation.id]);
    assert.equal(rejected.rows[0]?.state, "BLOCKED");
    assert.equal(rejected.rows[0]?.has_write_intent, false);
    assert.equal(rejected.rows[0]?.error_code, "PUBLISH_INPUT_REJECTED");
    assert.equal(await f.repository.claim(), null);
    await f.repository.requestReconciliation("demo", "job", "operator");
    let writes = 0;
    await processSeoPublish(f.repository, { read: async () => ({ version: writes ? "v2" : "v1", fields: f.operation.fields }), write: async () => { writes++; } });
    assert.equal(writes, 1);
    assert.equal((await f.repository.get("demo", f.operation.id)).state, "SUCCEEDED");
  } finally { await f.pg.close(); }
});

test("retrying a rejected publish still blocks a changed source before another write", async () => {
  const f = await fixture();
  try {
    await processSeoPublish(f.repository, { read: async () => ({ version: "v1", fields: f.operation.fields }),
      write: async () => { throw new SeoWorkerError("PUBLISH_INPUT_REJECTED"); } });
    await f.repository.requestReconciliation("demo", "job", "operator");
    let writes = 0;
    await processSeoPublish(f.repository, { read: async () => ({ version: "changed", fields: f.operation.fields }), write: async () => { writes++; } });
    assert.equal(writes, 0);
    assert.equal((await f.repository.get("demo", f.operation.id)).errorCode, "STALE_SOURCE");
  } finally { await f.pg.close(); }
});

test("publish preserves remote SEO baseline and recovers the same frozen version after lost response", async () => {
  const f = await fixture();
  let fields: PublishFields = f.operation.fields;
  let remoteVersion = 12;
  let writes = 0;
  const transport = {
    read: async () => ({ version: writes ? "v2" : "v1", fields, seoVersion: remoteVersion }),
    write: async (op: PublishOperation) => {
      writes++;
      fields = op.fields;
      remoteVersion = Number(fields.metafields?.find(field => field.key === "seo_version")?.value);
      throw new Error("response lost");
    },
  };
  try {
    await processSeoPublish(f.repository, transport);
    assert.equal(remoteVersion, 13);
    f.advance();
    await processSeoPublish(f.repository, transport);
    assert.equal((await f.repository.get("demo", f.operation.id)).seoVersion, 13);
    assert.equal(writes, 1);
  } finally { await f.pg.close(); }
});

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
    await f.repository.requestReconciliation("demo", "job", "operator");
    await processSeoPublish(f.repository, { read: async () => ({ version: "confirmed", fields: f.operation.fields }), write: async () => { writes++; } });
    assert.equal((await f.repository.get("demo", f.operation.id)).state, "SUCCEEDED");
    assert.equal(writes, 0);
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
    await assert.rejects(f.repository.requestReconciliation("demo", "job", "operator"), /SOURCE_REASSESSMENT_REQUIRED/);
    await assert.rejects(f.repository.enqueue({ storeId: "demo", jobId: "job", requestId: "sync", reviewUpdatedAt: 8, operator: "operator" }), /IDEMPOTENCY_CONFLICT/);
  } finally { await f.pg.close(); }
});

test("publish survives lost write response without repeating write or incrementing version twice", async () => {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  let now = 1000;
  const repository = new SeoPublishRepository({ transaction: operation => pg.transaction(tx => operation({ query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }) })) }, () => now);
  const original = { updatedAt: "v1", seoVersion: 3 };
  const enqueue = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "v1", original });
  const job = { id: "job", storeId: "demo", input: enqueue.input, execution: enqueue.execution, original, source: "auto_seo", status: "REVIEW_READY" };
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
