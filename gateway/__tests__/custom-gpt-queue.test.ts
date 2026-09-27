import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CustomGptQueue } from "../custom-gpt-seo/queue";

const source = { title: "Cotton rug", description: "A cotton rug", handle: "cotton-rug", niche: "rugs", images: [{ id: "front", url: "https://example.com/rug.jpg" }] };
function setup() {
  let now = 1_000;
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db, () => now);
  return { db, queue, advance: () => { now += 31 * 60_000; } };
}
test("Custom GPT queue deduplicates source revisions and isolates stores", () => {
  const { queue, db } = setup();
  try {
    const first = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "123", input: source, original: { id: "123" } });
    assert.equal(queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "123", input: source, original: { id: "123" } }).id, first.id);
    assert.equal(queue.list("other").length, 0);
    assert.throws(() => queue.get("other", first.id), /not found/i);
    assert.equal(queue.settings("capozen").provider, "gemini");
    assert.throws(() => queue.configure("capozen", { provider: "custom_gpt", batchSize: 11 }), /batch/i);
  } finally { db.close(); }
});
test("Custom GPT claims are idempotent and expired owners cannot checkpoint", () => {
  const { queue, db, advance } = setup();
  try {
    queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim-1");
    assert.equal(queue.claim("capozen", "claim-1").id, batch.id);
    assert.throws(() => queue.claim("capozen", "claim-2"), /active batch/i);
    const job = batch.jobs[0];
    assert.ok(job);
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "save-1", stage: "analysis", payload: { evidence: "cotton" } });
    advance();
    const next = queue.claim("capozen", "claim-3");
    assert.notEqual(next.id, batch.id);
    assert.deepEqual(queue.get("capozen", job.id).checkpoints.analysis, { evidence: "cotton" });
    assert.throws(() => queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "save-2", stage: "analysis", payload: {} }), /lease/i);
  } finally { db.close(); }
});
test("Custom GPT mutation keys reject different payloads and release preserves completed jobs", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    const mutation = { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "save", stage: "analysis" as const, payload: { ok: true } };
    queue.checkpoint("capozen", job.id, mutation);
    queue.checkpoint("capozen", job.id, mutation);
    assert.throws(() => queue.checkpoint("capozen", job.id, { ...mutation, payload: { ok: false } }), /idempotency/i);
    queue.release("capozen", batch.id, batch.leaseToken);
    assert.equal(queue.get("capozen", job.id).status, "PENDING");
    assert.deepEqual(queue.get("capozen", job.id).checkpoints.analysis, { ok: true });
  } finally { db.close(); }
});

test("changing source revision cancels the older pending job", () => {
  const { queue, db } = setup();
  try {
    const first = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: { ...source, title: "Updated rug" }, original: {} });
    assert.equal(queue.get("capozen", first.id).status, "CANCELLED");
  } finally { db.close(); }
});
test("updating analysis invalidates dependent keyword and research checkpoints", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    const lease = { batchId: batch.id, leaseToken: batch.leaseToken };
    queue.checkpoint("capozen", job.id, { ...lease, requestId: "r", stage: "research", payload: { seeds: ["rug"] } });
    queue.checkpoint("capozen", job.id, { ...lease, requestId: "k", stage: "keywords", payload: { keywords: ["rug"] } });
    queue.checkpoint("capozen", job.id, { ...lease, requestId: "a", stage: "analysis", payload: { changed: true } });
    assert.equal(queue.get("capozen", job.id).checkpoints.keywords, undefined);
    assert.equal(queue.get("capozen", job.id).checkpoints.research, undefined);
  } finally { db.close(); }
});
test("1000 jobs drain in bounded batches and survive database reopen", () => {
  const folder = mkdtempSync(join(tmpdir(), "gpt-seo-"));
  const filename = join(folder, "queue.sqlite3");
  let db = new DatabaseSync(filename);
  try {
    let queue = new CustomGptQueue(db);
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 10 });
    for (let index = 0; index < 1000; index++) queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: String(index), input: source, original: {} });
    db.close(); db = new DatabaseSync(filename); queue = new CustomGptQueue(db);
    assert.equal(queue.counts("capozen").PENDING, 1000);
    const completed = new Set<string>();
    for (let index = 0; index < 100; index++) {
      const batch = queue.claim("capozen", `claim-${index}`);
      assert.equal(batch.jobs.length, 10);
      for (const job of batch.jobs) {
        assert.equal(completed.has(job.id), false);
        queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: `submit-${job.id}`, stage: "submission", payload: {} });
        queue.finish("capozen", job.id, { output: "fixture" });
        completed.add(job.id);
      }
      queue.release("capozen", batch.id, batch.leaseToken);
    }
    assert.equal(completed.size, 1000);
    assert.equal(queue.counts("capozen").REVIEW_READY, 1000);
  } finally { db.close(); rmSync(folder, { recursive: true, force: true }); }
});

test("human sync claims fence duplicate browser writes and retain uncertain outcomes", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    queue.finish("capozen", job.id, {});
    queue.saveReviewState("capozen", job.id, { reviewDecision: "approved" });
    const token = queue.beginSync("capozen", job.id);
    assert.throws(() => queue.beginSync("capozen", job.id), /sync/i);
    queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: { ...source, title: "Newer source" }, original: {} });
    assert.equal(queue.get("capozen", job.id).status, "REVIEW_READY", "An in-flight write cannot be superseded");
    queue.finishSync("capozen", job.id, token, "UNKNOWN");
    assert.throws(() => queue.beginSync("capozen", job.id), /sync/i);
    assert.throws(() => queue.finishSync("capozen", job.id, "stale", "SYNCED"), /sync/i);
    assert.throws(() => queue.reconcileSync("capozen", job.id, { token, outcome: "NOT_WRITTEN", note: "" }), /verification/i);
    queue.reconcileSync("capozen", job.id, { token, outcome: "NOT_WRITTEN", note: "Worker stopped and Shopify verified unchanged." });
    assert.equal(queue.syncState("capozen", job.id)?.status, "ROLLED_BACK");
    assert.throws(() => queue.beginSync("capozen", job.id), /newer source/i);
  } finally { db.close(); }
});

test("a worker that has not started writes may release its sync claim and retry", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    queue.finish("capozen", job.id, {});
    queue.saveReviewState("capozen", job.id, { reviewDecision: "approved" });
    const token = queue.beginSync("capozen", job.id);
    queue.finishSync("capozen", job.id, token, "NOT_STARTED");
    const nextToken = queue.beginSync("capozen", job.id);
    assert.notEqual(nextToken, token);
    queue.finishSync("capozen", job.id, nextToken, "SYNCED");
    assert.throws(() => queue.finishSync("capozen", job.id, nextToken, "UNKNOWN"), /token/i);
  } finally { db.close(); }
});

test("late validation failures and issue reports cannot resurrect superseded jobs", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: { ...source, title: "New rug" }, original: {} });
    queue.failValidation("capozen", job.id, "late failure");
    assert.equal(queue.get("capozen", job.id).status, "CANCELLED");
    assert.throws(() => queue.issue("capozen", job.id, batch.id, batch.leaseToken, "missing"), /state/i);
  } finally { db.close(); }
});

test("explicit provider transfer rejects leased work and resets stale reasoning", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    assert.throws(() => queue.transfer("capozen", job.id, "gemini"), /lease|active/i);
    queue.release("capozen", batch.id, batch.leaseToken);
    queue.transfer("capozen", job.id, "gemini");
    assert.equal(queue.get("capozen", job.id).status, "VALIDATING");
    assert.equal(queue.get("capozen", job.id).settings.provider, "gemini");
  } finally { db.close(); }
});

test("only one background finalizer can acquire a submitted job", () => {
  const { queue, db } = setup();
  try {
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    assert.equal(queue.pendingFinalization().length, 1);
    const secondWorker = new CustomGptQueue(db, () => 1000);
    assert.equal(secondWorker.pendingFinalization().length, 0);
  } finally { db.close(); }
});

test("new source revisions invalidate unsynced ready drafts before a stale browser can publish", () => {
  const { queue, db } = setup();
  try {
    const original = { storeId: "capozen", source: "auto_seo" as const, sourceIdentity: "1", input: source, original: {} };
    const job = queue.enqueue(original);
    const batch = queue.claim("capozen", "claim");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    queue.finish("capozen", job.id, {});
    queue.saveReviewState("capozen", job.id, { reviewDecision: "approved" });
    queue.enqueue({ ...original, sourceRevision: "newer" });
    assert.equal(queue.get("capozen", job.id).status, "CANCELLED");
    assert.throws(() => queue.beginSync("capozen", job.id), /ready/i);
  } finally { db.close(); }
});
