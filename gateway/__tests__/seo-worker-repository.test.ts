import assert from "node:assert/strict";
import { test } from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { getQueueSchemaSql } from "../custom-gpt-seo/postgres-database";
import { getSeoWorkerSchemaSql } from "../seo-worker/schema";
import { SeoWorkerRepository } from "../seo-worker/repository";
import type { WorkerDatabase } from "../seo-worker/database";
import { WORKER_DEFAULTS } from "../seo-worker/protocol";

async function fixture() {
  const pg = await PGlite.create();
  await pg.exec(getQueueSchemaSql("public"));
  await pg.exec(getSeoWorkerSchemaSql("public"));
  let now = 1_000_000;
  const db: WorkerDatabase = { transaction: operation => pg.transaction(tx => operation({
    query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
  })) };
  const repository = new SeoWorkerRepository(db, () => now, () => 0);
  async function enqueue(id: string, storeId = "store-a", status = "PENDING", productId = id) {
    const payload = { id, storeId, status, source: "auto_seo", sourceIdentity: productId,
      input: { title: "Test blanket", productId }, original: {}, checkpoints: {}, settings: { provider: "codex_mcp" }, createdAt: now };
    await pg.query("INSERT INTO gpt_jobs(id,store_id,dedup,status,payload,created_at,provider) VALUES ($1,$2,$1,$3,$4,$5,'codex_mcp')", [id, storeId, status, JSON.stringify(payload), now]);
  }
  async function worker(workerId: string, target = 2, storeId = "store-a") {
    const issued = await repository.issueToken({ storeId, workerId, createdBy: "operator" });
    const { sessionId } = await repository.register(issued.token, "register");
    const run = await repository.startRun(issued.token, sessionId, target, "start");
    return { ...issued, sessionId, run };
  }
  async function deliver(id: string) {
    await pg.query("UPDATE gpt_jobs SET status='REVIEW_READY' WHERE id=$1", [id]);
    await pg.query("INSERT INTO gpt_deliveries(job_id,payload,delivered) VALUES ($1,'{}',1)", [id]);
  }
  return { pg, repository, enqueue, worker, deliver, advance: (ms: number) => { now += ms; } };
}

test("multi-store credentials switch only while idle, fence old sessions and revoke all grants", async () => {
  const f = await fixture();
  const repo = f.repository;
  try {
    const issued = await repo.issueToken({ storeId: "store-a", storeIds: ["store-a", "store-b"], workerId: "multi", createdBy: "operator" });
    assert.deepEqual((await repo.identify(issued.token)).storeIds, ["store-a", "store-b"]);
    assert.equal((await repo.listAccess("store-b", 0)).total, 1);
    await assert.rejects(repo.selectStore(issued.token, "store-c", "store-a", "denied"), /STORE_NOT_AUTHORIZED/);
    const old = await repo.register(issued.token, "register-a");
    const selected = await repo.selectStore(issued.token, "store-b", "store-a", "switch");
    assert.equal(selected.storeId, "store-b");
    assert.deepEqual(await repo.selectStore(issued.token, "store-b", "store-a", "switch"), selected);
    await assert.rejects(repo.selectStore(issued.token, "store-a", "store-a", "stale"), /STORE_SELECTION_CHANGED/);
    await assert.rejects(repo.startRun(issued.token, old.sessionId, 1, "old-run"), /STALE_SESSION/);
    await assert.rejects(repo.register(issued.token, "register-a"), /IDEMPOTENCY_CONFLICT/);
    const { sessionId } = await repo.register(issued.token, "register-b");
    const run = await repo.startRun(issued.token, sessionId, 1, "run-b");
    await assert.rejects(repo.selectStore(issued.token, "store-a", "store-b", "busy"), /WORKER_BUSY_FINISH_RUN_FIRST/);
    await f.enqueue("b-job", "store-b", "PENDING", "222");
    await repo.enableStore("store-b");
    const claim = await repo.claim(issued.token, sessionId, run.id, "claim-b");
    assert.equal(claim.lease?.jobId, "b-job");
    await assert.rejects(repo.selectStore(issued.token, "store-a", "store-b", "leased"), /WORKER_BUSY_FINISH_RUN_FIRST/);
    await repo.finishRun(issued.token, sessionId, run.id, "pause-b");
    await repo.selectStore(issued.token, "store-a", "store-b", "back-a");
    await assert.rejects(repo.runStatus(issued.token, run.id), /RUN_NOT_FOUND/);
    await repo.selectStore(issued.token, "store-b", "store-a", "back-b");
    const resumedSession = await repo.register(issued.token, "resume-b-session");
    assert.equal((await repo.resumeRun(issued.token, resumedSession.sessionId, run.id, "resume-b")).id, run.id);
    await repo.revoke("store-b", issued.tokenId);
    await assert.rejects(repo.identify(issued.token), /TOKEN_REVOKED/);
    await assert.rejects(repo.selectStore(issued.token, "store-a", "store-b", "revoked"), /TOKEN_REVOKED/);
    const legacy = await repo.issueToken({ storeId: "store-a", workerId: "legacy", createdBy: "operator" });
    await f.pg.query("UPDATE seo_worker_tokens SET store_ids='[]' WHERE id=$1", [legacy.tokenId]);
    assert.deepEqual((await repo.identify(legacy.token)).storeIds, ["store-a"]);
    await assert.rejects(repo.selectStore(legacy.token, "store-b", "store-a", "legacy-denied"), /STORE_NOT_AUTHORIZED/);
    f.advance(WORKER_DEFAULTS.tokenMs);
    await assert.rejects(repo.selectStore(legacy.token, "store-a", "store-a", "expired"), /TOKEN_EXPIRED/);
  } finally { await f.pg.close(); }
});

test("worker core uses the existing PostgreSQL queue and preserves lease, token and run invariants", async t => {
  const f = await fixture();
  const { repository: repo, pg } = f;
  try {
    await t.test("additive migration can run twice and rejects invalid schema names", async () => {
      await pg.exec(getSeoWorkerSchemaSql("public"));
      assert.throws(() => getSeoWorkerSchemaSql('bad"schema'), /Invalid/);
    });
    await t.test("cutover refuses duplicate products without cancelling either job", async () => {
      await f.enqueue("duplicate-a", "duplicates", "PENDING", "123");
      await f.enqueue("duplicate-b", "duplicates", "PENDING", "gid://shopify/Product/123");
      await assert.rejects(repo.enableStore("duplicates"), /DUPLICATE_ACTIVE_PRODUCT/);
      assert.deepEqual((await repo.cutoverReport("duplicates")).duplicateProducts, [{ productKey: "shopify:123", jobIds: ["duplicate-a", "duplicate-b"] }]);
      const jobs = await pg.query<{ status: string }>("SELECT status FROM gpt_jobs WHERE store_id='duplicates'");
      assert.deepEqual(jobs.rows.map(row => row.status), ["PENDING", "PENDING"]);
      assert.equal((await pg.query("SELECT * FROM seo_worker_jobs WHERE store_id='duplicates'")).rows.length, 0);
    });
    await t.test("cutover refuses active legacy work", async () => {
      await f.enqueue("901", "legacy", "IN_PROGRESS");
      await assert.rejects(repo.enableStore("legacy"), /LEGACY_JOB_NOT_DRAINED/);
    });
    await f.enqueue("101"); await f.enqueue("102"); await f.enqueue("103");
    await repo.enableStore("store-a");
    const a = await f.worker("a", 1);
    const b = await f.worker("b", 2);
    await t.test("only token hashes are persisted and token lifetime is 24 hours", async () => {
      const rows = (await pg.query<{ token_hash: string; created_at: number; expires_at: number }>("SELECT * FROM seo_worker_tokens WHERE id=$1", [a.tokenId])).rows;
      assert.equal(JSON.stringify(rows).includes(a.token), false);
      assert.equal(Number(rows[0].expires_at) - Number(rows[0].created_at), WORKER_DEFAULTS.tokenMs);
      assert.equal((await repo.identify(a.token)).storeId, "store-a");
      await assert.rejects(repo.identify("wrong"), /INVALID_TOKEN/);
    });
    const first = await repo.claim(a.token, a.sessionId, a.run.id, "claim");
    const second = await repo.claim(b.token, b.sessionId, b.run.id, "claim");
    assert.ok(first.lease); assert.ok(second.lease);
    const leaseA = first.lease; const leaseB = second.lease;
    await t.test("workers claim different jobs and each session holds at most one lease", async () => {
      assert.notEqual(leaseA.jobId, leaseB.jobId);
      assert.deepEqual(await repo.claim(a.token, a.sessionId, a.run.id, "claim"), first);
      await assert.rejects(repo.claim(a.token, a.sessionId, a.run.id, "second"), /LEASE_ALREADY_ACTIVE/);
      await assert.rejects(repo.heartbeat(b.token, leaseA), /STALE_SESSION/);
    });
    await t.test("run target and request IDs cannot be changed through retries", async () => {
      assert.deepEqual(await repo.startRun(a.token, a.sessionId, 1, "start"), a.run);
      await assert.rejects(repo.startRun(a.token, a.sessionId, 50, "start"), /IDEMPOTENCY_CONFLICT/);
    });
    await t.test("success requires actual review delivery and counts exactly once", async () => {
      await repo.reconcileReviews();
      assert.equal((await repo.runStatus(a.token, a.run.id)).successful, 0);
      await f.deliver(leaseA.jobId);
      await repo.reconcileReviews(); await repo.reconcileReviews();
      const completed = await repo.runStatus(a.token, a.run.id);
      assert.equal(completed.successful, 1);
      assert.equal(completed.state, "COMPLETED");
      assert.equal((await repo.claim(a.token, a.sessionId, a.run.id, "after-success")).stopReason, "TARGET_REACHED");
    });
    await t.test("expired lease recovers with backoff and cannot write after reclaim", async () => {
      f.advance(WORKER_DEFAULTS.leaseMs + 1);
      await repo.recover();
      await assert.rejects(repo.heartbeat(b.token, leaseB), /STALE_LEASE/);
      f.advance(30_000); await repo.recover();
      const next = await repo.claim(b.token, b.sessionId, b.run.id, "retry");
      assert.ok(next.lease);
      assert.equal(next.lease.jobId, leaseB.jobId);
      assert.equal(next.lease.leaseVersion, leaseB.leaseVersion + 1);
      await assert.rejects(repo.withLease(b.token, leaseB, async () => true), /STALE_LEASE/);
      assert.equal((await repo.runStatus(b.token, b.run.id)).successful, 0);
      await repo.release(b.token, next.lease, { code: "NETWORK_ERROR", retryable: true, requestId: "release" });
      assert.deepEqual(await repo.release(b.token, next.lease, { code: "NETWORK_ERROR", retryable: true, requestId: "release" }), { released: true });
    });
    await t.test("replacing a worker session fences the old session and resumes the same run", async () => {
      const replacement = await repo.register(b.token, "replacement");
      await assert.rejects(repo.claim(b.token, b.sessionId, b.run.id, "old-session"), /STALE_SESSION/);
      const resumed = await repo.resumeRun(b.token, replacement.sessionId, b.run.id);
      assert.equal(resumed.target, 2); assert.equal(resumed.successful, 0);
      const claim = await repo.claim(b.token, replacement.sessionId, b.run.id, "new-session");
      assert.ok(claim.lease);
      await repo.revoke("store-a", b.tokenId);
      await assert.rejects(repo.heartbeat(b.token, claim.lease), /TOKEN_REVOKED/);
      assert.equal((await pg.query("SELECT * FROM seo_worker_jobs WHERE token_id=$1 AND lease_id IS NOT NULL", [b.tokenId])).rows.length, 0);
    });
    await t.test("tokens cannot inspect another store's run", async () => {
      const other = await f.worker("a", 1, "store-b");
      await assert.rejects(repo.runStatus(other.token, a.run.id), /RUN_NOT_FOUND/);
      await assert.rejects(repo.revoke("store-b", a.tokenId), /TOKEN_NOT_FOUND/);
    });
  } finally { await pg.close(); }
});

test("reconciliation repairs a persisted Review draft once without claiming another job", async () => {
  const f = await fixture();
  try {
    await f.enqueue("701");
    await f.repository.enableStore("store-a");
    const worker = await f.worker("repair", 1);
    const claimed = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "claim");
    assert.ok(claimed.lease);
    const result = { output: { title: "Persisted draft" } };
    await f.pg.query(`UPDATE gpt_jobs SET status='REVIEW_READY',
      payload=(payload::jsonb || jsonb_build_object('result',$2::jsonb))::text WHERE id=$1`, [claimed.lease.jobId, JSON.stringify(result)]);
    await f.pg.query("INSERT INTO gpt_deliveries VALUES ($1,$2,0)", [claimed.lease.jobId, JSON.stringify({ output: { title: "Different draft" } })]);
    await f.repository.reconcileReviews();
    assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).successful, 0);
    await f.repository.finishRun(worker.token, worker.sessionId, worker.run.id, "pause");
    await f.pg.query("UPDATE gpt_deliveries SET payload=$2 WHERE job_id=$1", [claimed.lease.jobId, JSON.stringify(result)]);
    await f.repository.reconcileReviews();
    await f.repository.recover();
    const run = await f.repository.runStatus(worker.token, worker.run.id);
    assert.equal(run.successful, 1);
    assert.equal(run.state, "COMPLETED");
    assert.equal(run.stopReason, "TARGET_REACHED");
    assert.equal((await f.pg.query("SELECT * FROM seo_worker_successes")).rows.length, 1);
    assert.equal((await f.pg.query<{ delivered: number }>("SELECT delivered FROM gpt_deliveries")).rows[0].delivered, 1);
  } finally { await f.pg.close(); }
});

test("review delivery delay never requeues accepted work or exceeds the run target", async () => {
  const f = await fixture();
  try {
    await f.enqueue("601"); await f.enqueue("602"); await f.repository.enableStore("store-a");
    const worker = await f.worker("delivery", 1);
    const claimed = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "claim");
    assert.ok(claimed.lease);
    await f.pg.query("UPDATE gpt_jobs SET status='REVIEW_READY' WHERE id=$1", [claimed.lease.jobId]);
    await f.pg.query("INSERT INTO gpt_deliveries(job_id,payload,delivered) VALUES ($1,'{}',0)", [claimed.lease.jobId]);
    f.advance(WORKER_DEFAULTS.leaseMs + 1);
    await f.repository.recover();
    assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).successful, 0);
    await assert.rejects(f.repository.claim(worker.token, worker.sessionId, worker.run.id, "before-delivery"), /LEASE_ALREADY_ACTIVE/);
    const replacement = await f.repository.register(worker.token, "reconnect");
    await f.repository.resumeRun(worker.token, replacement.sessionId, worker.run.id);
    await assert.rejects(f.repository.claim(worker.token, replacement.sessionId, worker.run.id, "still-delivering"), /LEASE_ALREADY_ACTIVE/);
    await f.pg.query("UPDATE gpt_deliveries SET delivered=1 WHERE job_id=$1", [claimed.lease.jobId]);
    const next = await f.repository.claim(worker.token, replacement.sessionId, worker.run.id, "after-delivery");
    assert.equal(next.lease, null);
    assert.equal(next.stopReason, "TARGET_REACHED");
    assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).successful, 1);
    assert.equal((await f.pg.query<{ status: string }>("SELECT status FROM gpt_jobs WHERE id='602'")).rows[0].status, "PENDING");
  } finally { await f.pg.close(); }
});

test("target 25 stops at 25 and resume 21 of 50 completes exactly 29 more", async () => {
  const f = await fixture();
  try {
    for (const target of [25, 50]) {
      const storeId = `target-${target}`;
      for (let index = 0; index <= target; index++) await f.enqueue(`${target}-${index}`, storeId, "PENDING", String(target * 1000 + index));
      await f.repository.enableStore(storeId);
      const worker = await f.worker(`worker-${target}`, target, storeId);
      let sessionId = worker.sessionId;
      for (let completed = 0; completed < target; completed++) {
        if (target === 50 && completed === 21) {
          assert.equal((await f.repository.finishRun(worker.token, sessionId, worker.run.id, "pause-at-21")).successful, 21);
          sessionId = (await f.repository.register(worker.token, "replacement-session")).sessionId;
          const resumed = await f.repository.resumeRun(worker.token, sessionId, worker.run.id);
          assert.equal(resumed.target - resumed.successful, 29);
        }
        const claim = await f.repository.claim(worker.token, sessionId, worker.run.id, `next-${completed}`);
        assert.ok(claim.lease);
        await f.deliver(claim.lease.jobId);
      }
      assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).successful, target);
      assert.equal((await f.repository.claim(worker.token, sessionId, worker.run.id, "must-stop")).stopReason, "TARGET_REACHED");
      assert.equal((await f.pg.query<{ count: number }>("SELECT count(*)::int AS count FROM gpt_jobs WHERE store_id=$1 AND status='PENDING'", [storeId])).rows[0].count, 1);
    }
  } finally { await f.pg.close(); }
});

test("retry exhaustion is terminal and a partial run resumes only the remaining successes", async () => {
  const f = await fixture();
  try {
    await f.enqueue("701"); await f.enqueue("702"); await f.enqueue("703"); await f.repository.enableStore("store-a");
    const worker = await f.worker("retries", 2);
    for (let attempt = 1; attempt <= 5; attempt++) {
      const claim = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, `claim-${attempt}`);
      assert.ok(claim.lease);
      assert.equal(claim.lease.jobId, "701");
      await f.repository.release(worker.token, claim.lease, { code: "NETWORK_ERROR", retryable: true, requestId: `release-${attempt}` });
      f.advance(600_000); await f.repository.recover();
    }
    assert.equal((await f.pg.query<{ state: string }>("SELECT state FROM seo_worker_jobs WHERE job_id='701'")).rows[0].state, "FAILED_FINAL");
    assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).successful, 0);
    const next = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "success-1");
    assert.ok(next.lease); await f.deliver(next.lease.jobId);
    const paused = await f.repository.finishRun(worker.token, worker.sessionId, worker.run.id, "pause");
    assert.equal(paused.successful, 1); assert.equal(paused.state, "PARTIAL");
    await f.repository.resumeRun(worker.token, worker.sessionId, worker.run.id);
    const last = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "success-2");
    assert.ok(last.lease); assert.notEqual(last.lease.jobId, next.lease.jobId);
    await f.deliver(last.lease.jobId);
    assert.equal((await f.repository.runStatus(worker.token, worker.run.id)).state, "COMPLETED");
  } finally { await f.pg.close(); }
});

test("heartbeat cannot keep a silent worker alive forever and expiry blocks new claims", async () => {
  const f = await fixture();
  try {
    await f.enqueue("501"); await f.repository.enableStore("store-a");
    const worker = await f.worker("idle", 1);
    const claimed = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "claim");
    assert.ok(claimed.lease);
    for (let minute = 1; minute < 30; minute++) {
      f.advance(60_000); await f.repository.heartbeat(worker.token, claimed.lease);
    }
    f.advance(60_000);
    await assert.rejects(f.repository.heartbeat(worker.token, claimed.lease), /STALE_LEASE/);
    await f.repository.recover();
    f.advance(WORKER_DEFAULTS.tokenMs - 30 * 60_000 - 9 * 60_000);
    await assert.rejects(f.repository.claim(worker.token, worker.sessionId, worker.run.id, "late"), /TOKEN_EXPIRING_SOON/);
    f.advance(9 * 60_000);
    await assert.rejects(f.repository.identify(worker.token), /TOKEN_EXPIRED/);
  } finally { await f.pg.close(); }
});

test("operator lists are store scoped, paginated and never disclose credential hashes", async () => {
  const f = await fixture();
  try {
    const machine = await f.worker("machine-a");
    const other = await f.worker("machine-b", 2, "store-b");
    const page = await f.repository.listAccess("store-a", 0);
    assert.equal(page.total, 1);
    assert.equal(page.tokens[0]?.workerId, "machine-a");
    assert.equal(JSON.stringify(page).includes("token_hash"), false);
    assert.equal(JSON.stringify(page).includes(other.token), false);
    assert.equal((await f.repository.listAccess("store-a", 50)).tokens.length, 0);
    assert.equal((await f.repository.listRuns("store-a", 0)).runs.length, 1);
    await assert.rejects(f.repository.listAccess("store-a", -1), /INVALID_OFFSET/);
    await assert.rejects(f.repository.revoke("store-a", other.tokenId), /TOKEN_NOT_FOUND/);
    await assert.rejects(f.repository.deleteRevokedToken("store-a", machine.tokenId), /REVOKED_TOKEN_NOT_FOUND/);
    await f.repository.revoke("store-a", machine.tokenId);
    assert.equal((await f.repository.listAccess("store-a", 0)).total, 1);
    await f.repository.deleteRevokedToken("store-a", machine.tokenId);
    assert.equal((await f.repository.listAccess("store-a", 0)).total, 0);
    assert.equal((await f.repository.listRuns("store-a", 0)).runs.length, 1);
    await assert.rejects(f.repository.deleteRevokedToken("store-a", machine.tokenId), /REVOKED_TOKEN_NOT_FOUND/);
  } finally { await f.pg.close(); }
});

test("worker checkpoints are fenced, ordered and submission receipts survive delivery", async () => {
  const f = await fixture();
  try {
    await f.enqueue("801"); await f.repository.enableStore("store-a");
    const worker = await f.worker("checkpoint", 1);
    const { lease } = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "claim");
    assert.ok(lease);
    await assert.rejects(f.repository.saveCheckpoint(worker.token, lease, { requestId: "early", stage: "submission", payload: {}, expectedCheckpoints: {} }), /CHECKPOINT_REQUIRED/);
    for (const stage of ["analysis", "research", "keywords"] as const) {
      const job = await f.repository.readJob(worker.token, lease);
      await f.repository.saveCheckpoint(worker.token, lease, { requestId: stage, stage, payload: { stage }, expectedCheckpoints: job.checkpoints });
    }
    const job = await f.repository.readJob(worker.token, lease);
    const submission = { requestId: "submit", stage: "submission" as const, payload: { draft: "test" }, expectedCheckpoints: job.checkpoints };
    const receipt = await f.repository.saveCheckpoint(worker.token, lease, submission);
    assert.equal(receipt.status, "VALIDATING");
    await f.deliver(lease.jobId); await f.repository.reconcileReviews();
    assert.deepEqual(await f.repository.saveCheckpoint(worker.token, lease, submission), receipt);
    f.advance(1);
    assert.equal((await f.repository.metrics.report("store-a", 24)).duplicateSubmissionsPrevented, 1);
    await assert.rejects(f.repository.saveCheckpoint(worker.token, lease, { ...submission, payload: {} }), /IDEMPOTENCY_CONFLICT/);
    await f.repository.revoke("store-a", worker.tokenId);
    await assert.rejects(f.repository.saveCheckpoint(worker.token, lease, submission), /TOKEN_REVOKED/);
  } finally { await f.pg.close(); }
});

test("analysis requires actual image fetch receipts bound to the current lease", async () => {
  const f = await fixture();
  try {
    await f.enqueue("901");
    await f.pg.query("UPDATE gpt_jobs SET payload=jsonb_set(payload::jsonb,'{input,images}',$1::jsonb)::text WHERE id='901'", [JSON.stringify([{ id: "photo", url: "https://example.com/test.jpg" }])]);
    await f.repository.enableStore("store-a");
    const worker = await f.worker("images", 1);
    const { lease } = await f.repository.claim(worker.token, worker.sessionId, worker.run.id, "claim"); assert.ok(lease);
    const checkpoint = { requestId: "analysis", stage: "analysis" as const, payload: {}, expectedCheckpoints: {} };
    await assert.rejects(f.repository.saveCheckpoint(worker.token, lease, checkpoint), /IMAGE_VIEW_REQUIRED/);
    await f.repository.recordImage(worker.token, lease, "photo", "a".repeat(64));
    assert.equal((await f.repository.saveCheckpoint(worker.token, lease, checkpoint)).status, "IN_PROGRESS");
    await f.repository.revoke("store-a", worker.tokenId);
    await assert.rejects(f.repository.recordImage(worker.token, lease, "photo", "a".repeat(64)), /TOKEN_REVOKED/);
  } finally { await f.pg.close(); }
});
