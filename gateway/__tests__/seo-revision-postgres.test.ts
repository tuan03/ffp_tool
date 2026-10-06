import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";
import { createSeoRevision } from "../seo-worker/revision-service";

import { createTestEnqueue } from "./seo-v2-fixtures";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;

test("PostgreSQL revision preserves history, reads live source, replays once and fences old review", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `revision_test_${randomUUID().replaceAll("-", "")}`;
  const queue = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await queue.initialize();
    const pending = await queue.enqueue(createTestEnqueue({ storeId: "demo", productId: "123", original: { updatedAt: "v1", title: "Old", description: "Old", handle: "old" }, input: { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }], niche: "blanket" }, settings: { provider: "codex_mcp", batchSize: 1, language: "en-US", version: 1, instructions: "Grounded only" } }));
    const parent = { ...pending, status: "REVIEW_READY" as const };
    await pool.query(`UPDATE "${schema}".gpt_jobs SET status='REVIEW_READY',payload=$2 WHERE id=$1`, [parent.id, JSON.stringify(parent)]);
    await pool.query(`INSERT INTO "${schema}".gpt_review_state VALUES ($1,$2)`, [parent.id, JSON.stringify({ reviewDecision: "pending", updatedAt: 1 })]);
    await pool.query(`INSERT INTO "${schema}".seo_worker_stores VALUES ('demo',true)`);
    await pool.query(`INSERT INTO "${schema}".seo_worker_jobs(job_id,store_id,product_key,state,updated_at) VALUES ($1,'demo','shopify:123','READY_FOR_REVIEW',1)`, [parent.id]);
    const request = { storeId: "demo", jobId: parent.id, requestId: randomUUID(), operator: "test", instructions: "Improve summary" };
    const dispatcher = { dispatch: async () => ({ success: true as const, storeId: "demo", operation: "products.get" as const, data: { product: { id: "gid://shopify/Product/123", title: "Live", descriptionHtml: "Live HTML", handle: "live", updatedAt: "v2", images: [{ id: "gid://shopify/ProductImage/456", url: "https://cdn.shopify.com/live-blanket.png" }], variants: [{ title: "Blanket" }] } } }) };
    const receipts = await Promise.all([createSeoRevision(queue, dispatcher, request), createSeoRevision(queue, dispatcher, request)]);
    assert.equal(receipts[0].jobId, receipts[1].jobId);
    assert.notEqual(receipts[0].jobId, parent.id);
    assert.deepEqual(await queue.get("demo", parent.id), JSON.parse(JSON.stringify(parent)) as typeof parent);
    const next = await queue.get("demo", receipts[0].jobId);
    assert.equal(next.status, "PENDING");
    assert.deepEqual(Object.keys(next.input).sort(), ["images", "niche", "storeProfile"]);
    assert.equal((next.original as { title: string }).title, "Live");
    assert.equal((next.original as { updatedAt: string }).updatedAt, "v2");
    assert.match(next.settings.instructions, /Grounded only/);
    assert.deepEqual(next.checkpoints, {});
    await assert.rejects(createSeoRevision(queue, dispatcher, { ...request, instructions: "different" }), /IDEMPOTENCY_CONFLICT/);
    await assert.rejects(createSeoRevision(queue, dispatcher, { ...request, requestId: randomUUID() }), /REVISION_ALREADY_EXISTS/);
    await assert.rejects(queue.saveReviewState("demo", parent.id, { reviewDecision: "approved" }), /REVIEW_SUPERSEDED/);
    await assert.rejects(queue.publisher.enqueue({ storeId: "demo", jobId: parent.id, reviewUpdatedAt: 1, requestId: "old-publish", operator: "test" }), /REVIEW_SUPERSEDED/);
    await assert.rejects(createSeoRevision(queue, dispatcher, { ...request, storeId: "other" }), /Job not found/);
    // A possibly written operation must retain its product reservation.
    const nextReady = { ...next, status: "REVIEW_READY" as const };
    await pool.query(`UPDATE "${schema}".gpt_jobs SET status='REVIEW_READY',payload=$2 WHERE id=$1`, [next.id, JSON.stringify(nextReady)]);
    await pool.query(`UPDATE "${schema}".seo_worker_jobs SET state='READY_FOR_REVIEW' WHERE job_id=$1`, [next.id]);
    const approved = { reviewDecision: "approved", updatedAt: 7, productTitle: { value: "New" }, productDescription: { value: "Description" }, seoTitle: { value: "Title" }, seoDescription: { value: "Meta" } };
    await queue.saveReviewState("demo", next.id, approved);
    const publish = await queue.publisher.enqueue({ storeId: "demo", jobId: next.id, reviewUpdatedAt: 7, requestId: "publish-next", operator: "test" });
    await pool.query(`UPDATE "${schema}".seo_publish_operations SET state='BLOCKED',has_write_intent=true WHERE id=$1`, [publish.id]);
    const secondRequest = { ...request, jobId: next.id, requestId: randomUUID() };
    await assert.rejects(createSeoRevision(queue, dispatcher, secondRequest), /PUBLISH_UNRESOLVED/);
    assert.equal((await pool.query(`SELECT pipeline_active FROM "${schema}".seo_worker_jobs WHERE job_id=$1`, [next.id])).rows[0].pipeline_active, true);
    // A pre-write block may be superseded, without erasing the blocked receipt.
    await pool.query(`UPDATE "${schema}".seo_publish_operations SET has_write_intent=false WHERE id=$1`, [publish.id]);
    const secondRevision = await createSeoRevision(queue, dispatcher, secondRequest);
    assert.equal((await pool.query(`SELECT superseded_by FROM "${schema}".seo_publish_operations WHERE id=$1`, [publish.id])).rows[0].superseded_by, secondRevision.jobId);
    assert.equal((await queue.publisher.get("demo", publish.id)).state, "BLOCKED");
    assert.deepEqual(await queue.get("demo", parent.id), JSON.parse(JSON.stringify(parent)) as typeof parent);
    assert.deepEqual(await queue.get("demo", next.id), nextReady);
    const history = await queue.workerHistory.list("demo", next.id, 0);
    assert.equal(history.total, 3);
    assert.equal(history.entries.find(entry => entry.jobId === next.id)?.previousJobId, parent.id);
    assert.equal(history.entries.find(entry => entry.jobId === next.id)?.sourceVersion, "v2");
    assert.equal((await queue.workerHistory.list("demo", next.id, 50)).entries.length, 0);
    await assert.rejects(queue.workerHistory.list("other", next.id, 0), /JOB_NOT_FOUND/);
  } finally {
    await queue.close();
    await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    await pool.end();
  }
});
