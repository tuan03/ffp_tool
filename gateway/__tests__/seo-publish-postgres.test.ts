import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;

test("PostgreSQL publish claim is exclusive and legacy Review APIs cannot override its receipt", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `seo_publish_test_${randomUUID().replaceAll("-", "")}`;
  const first = new PostgresCustomGptQueue({ databaseUrl, schema });
  const second = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await first.initialize(); await second.initialize();
    const job = { id: "job", storeId: "demo", status: "REVIEW_READY", input: { productId: "123" }, original: { updatedAt: "v1" } };
    const review = { reviewDecision: "approved", updatedAt: 1, productTitle: { value: "Title" }, productDescription: { value: "Description" }, seoTitle: { value: "SEO" }, seoDescription: { value: "Meta" } };
    await pool.query(`INSERT INTO "${schema}".gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES ('job','demo','dedup','REVIEW_READY',$1,1)`, [JSON.stringify(job)]);
    await pool.query(`INSERT INTO "${schema}".gpt_review_state VALUES ('job',$1)`, [JSON.stringify(review)]);
    await pool.query(`INSERT INTO "${schema}".seo_worker_stores(store_id,enabled) VALUES ('demo',true)`);
    const request = { storeId: "demo", jobId: "job", reviewUpdatedAt: 1, requestId: "sync", operator: "test" };
    const operations = await Promise.all([first.publisher.enqueue(request), second.publisher.enqueue(request)]);
    assert.equal(operations[0].id, operations[1].id);
    const leases = await Promise.all([first.publisher.claim(), second.publisher.claim()]);
    assert.equal(leases.filter(Boolean).length, 1);
    const lease = leases.find(lease => lease !== null);
    assert.ok(lease);
    await assert.rejects(second.saveReviewState("demo", "job", { ...review, updatedAt: 2 }), /PUBLISH_ACTIVE/);
    await assert.rejects(second.finishSync("demo", "job", lease.id, "NOT_STARTED"), /BACKEND_PUBLISH_MANAGED/);
    await assert.rejects(second.reconcileSync("demo", "job", { token: lease.id, outcome: "NOT_WRITTEN", note: "Test must not override backend receipt" }), /BACKEND_PUBLISH_MANAGED/);
    await first.publisher.authorizeWrite(lease);
    await first.publisher.confirm(lease);
    await assert.rejects(second.publisher.confirm(lease), /STALE_PUBLISH_LEASE/);
    assert.equal((await second.publisher.get("demo", lease.id)).seoVersion, 1);
  } finally {
    await first.close(); await second.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
