import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

import { Pool } from "pg";

import { PostgresCustomGptQueue } from "../custom-gpt-seo/postgres-queue";

import { createTestEnqueue } from "./seo-v2-fixtures";

const databaseUrl = process.env.SEO_QUEUE_TEST_DATABASE_URL;

test("PostgreSQL publish claim is exclusive and legacy Review APIs cannot override its receipt", { skip: !databaseUrl }, async () => {
  assert.ok(databaseUrl);
  const schema = `seo_publish_test_${randomUUID().replaceAll("-", "")}`;
  const first = new PostgresCustomGptQueue({ databaseUrl, schema });
  const second = new PostgresCustomGptQueue({ databaseUrl, schema });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    await first.initialize(); await second.initialize();
    const enqueue = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "v1", original: { updatedAt: "v1" } });
    const job = { ...enqueue, id: "job", storeId: "demo", source: "auto_seo", sourceIdentity: "123", sourceRevision: "v1", status: "REVIEW_READY", original: enqueue.execution.originalSnapshot };
    const review = { reviewDecision: "approved", updatedAt: 1, productTitle: { value: "Title" }, productDescription: { value: "Description" }, seoTitle: { value: "SEO" }, seoDescription: { value: "Meta" } };
    await pool.query(`INSERT INTO "${schema}".gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES ('job','demo','dedup','REVIEW_READY',$1,1)`, [JSON.stringify(job)]);
    await pool.query(`INSERT INTO "${schema}".gpt_review_state VALUES ('job',$1)`, [JSON.stringify(review)]);
    await pool.query(`INSERT INTO "${schema}".seo_worker_stores(store_id,enabled) VALUES ('demo',true)`);
    const request = { storeId: "demo", jobId: "job", reviewUpdatedAt: 1, requestId: "sync", operator: "test" };
    const operations = await Promise.all([first.publisher.enqueue(request), second.publisher.enqueue(request)]);
    assert.equal(operations[0].id, operations[1].id);
    assert.equal((await first.reviewState("demo", "job")).backendPublishRequired, true);
    assert.equal((await first.reviewState("demo", "job")).shopifySyncStatus, "syncing");
    await assert.rejects(second.beginSync("demo", "job"), /BACKEND_PUBLISH_REQUIRED/);
    const crawlerJob = { ...job, id: "crawler-job", source: "amazon", sourceIdentity: "amazon:B0TEST123" };
    await pool.query(`INSERT INTO "${schema}".gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES ('crawler-job','demo','crawler-dedup','REVIEW_READY',$1,2)`, [JSON.stringify(crawlerJob)]);
    await pool.query(`INSERT INTO "${schema}".gpt_review_state VALUES ('crawler-job',$1)`, [JSON.stringify(review)]);
    const crawlerSyncToken = await second.beginSync("demo", "crawler-job");
    assert.equal((await second.syncState("demo", "crawler-job"))?.status, "SYNCING");
    await second.finishSync("demo", "crawler-job", crawlerSyncToken, "SYNCED");
    assert.equal((await second.syncState("demo", "crawler-job"))?.status, "SYNCED");
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
    assert.equal((await second.reviewState("demo", "job")).shopifySyncStatus, "synced");
    await assert.rejects(second.saveReviewState("demo", "job", { ...review, updatedAt: 3 }), /PUBLISH_ACTIVE/);
    await assert.rejects(second.requeue("demo", "job"), /NEW_REVISION_REQUIRED/);
    await assert.rejects(second.cancelReview("demo", "job"), /BACKEND_PUBLISH_MANAGED/);
    await pool.query(`INSERT INTO "${schema}".gpt_jobs(id,store_id,dedup,status,payload,created_at) VALUES ('job2','demo','dedup2','REVIEW_READY',$1,2)`, [JSON.stringify({ ...job, id: "job2" })]);
    await pool.query(`INSERT INTO "${schema}".gpt_review_state VALUES ('job2',$1)`, [JSON.stringify(review)]);
    const interrupted = await first.publisher.enqueue({ ...request, jobId: "job2", requestId: "sync2" });
    const fixture = fileURLToPath(new URL("./fixtures/seo-publish-process.ts", import.meta.url));
    const runProcess = (mode: string) => promisify(execFile)(process.execPath, ["--import", "tsx", fixture, schema, mode], { env: { ...process.env, SEO_QUEUE_TEST_DATABASE_URL: databaseUrl }, timeout: 30_000 });
    await runProcess("leave-write");
    await pool.query(`UPDATE "${schema}".seo_publish_operations SET lease_until=0 WHERE id=$1`, [interrupted.id]);
    await Promise.all([runProcess("recover"), runProcess("recover")]);
    assert.equal((await first.publisher.get("demo", interrupted.id)).state, "SUCCEEDED");
    assert.equal((await first.publisher.get("demo", interrupted.id)).seoVersion, 2);
    assert.equal(Number((await pool.query(`SELECT count(*) FROM "${schema}".seo_publish_versions WHERE operation_id=$1`, [interrupted.id])).rows[0].count), 1);
  } finally {
    await first.close(); await second.close();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  }
});
