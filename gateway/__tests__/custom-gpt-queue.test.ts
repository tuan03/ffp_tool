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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim-1", "custom_gpt", "custom_gpt");
    assert.equal(batch.provider, "custom_gpt");
    assert.equal(queue.claim("capozen", "claim-1", "custom_gpt", "custom_gpt").id, batch.id);
    assert.throws(() => queue.claim("capozen", "claim-2", "custom_gpt", "custom_gpt"), /active batch/i);
    const job = batch.jobs[0];
    assert.ok(job);
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "save-1", stage: "analysis", payload: { evidence: "cotton" } });
    advance();
    const next = queue.claim("capozen", "claim-3", "custom_gpt", "custom_gpt");
    assert.notEqual(next.id, batch.id);
    assert.deepEqual(queue.get("capozen", job.id).checkpoints.analysis, { evidence: "cotton" });
    assert.throws(() => queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "save-2", stage: "analysis", payload: {} }), /lease/i);
  } finally { db.close(); }
});

test("provider-scoped claims never mix Custom GPT and Codex MCP jobs", () => {
  const { queue, db } = setup();
  try {
    const customSettings = queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const customJob = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "CUSTOM", input: source, original: {}, settings: customSettings });
    const codexSettings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 5 });
    const codexJob = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "CODEX", input: source, original: {}, settings: codexSettings });

    const codexBatch = queue.claim("capozen", "codex-claim", "codex_mcp", "codex_mcp:default");
    assert.equal(codexBatch.provider, "codex_mcp");
    assert.deepEqual(codexBatch.jobs.map(job => job.id), [codexJob.id]);
    const customBatch = queue.claim("capozen", "custom-claim", "custom_gpt", "custom_gpt");
    assert.deepEqual(customBatch.jobs.map(job => job.id), [customJob.id]);
    assert.equal(queue.activeBatch("capozen", "codex_mcp:default")?.id, codexBatch.id);
  } finally { db.close(); }
});

test("two Codex owners claim disjoint batches for the same store", () => {
  const { queue, db } = setup();
  try {
    const settings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 2 });
    const jobs = ["one", "two", "three", "four"].map(sourceIdentity => queue.enqueue({
      storeId: "capozen",
      source: "auto_seo",
      sourceIdentity,
      input: { ...source, title: sourceIdentity },
      original: {},
      settings,
    }));

    const officeBatch = queue.claim("capozen", "office-claim", "codex_mcp", "codex_mcp:office-pc");
    const laptopBatch = queue.claim("capozen", "laptop-claim", "codex_mcp", "codex_mcp:laptop");
    const officeJobs = new Set(officeBatch.jobs.map(job => job.id));
    const laptopJobs = new Set(laptopBatch.jobs.map(job => job.id));

    assert.equal(officeBatch.ownerId, "codex_mcp:office-pc");
    assert.equal(laptopBatch.ownerId, "codex_mcp:laptop");
    assert.equal(officeBatch.jobs.length, 2);
    assert.equal(laptopBatch.jobs.length, 2);
    assert.equal([...officeJobs].some(jobId => laptopJobs.has(jobId)), false);
    assert.deepEqual(new Set([...officeJobs, ...laptopJobs]), new Set(jobs.map(job => job.id)));
    assert.deepEqual(queue.activeBatches("capozen").map(batch => batch.id), [officeBatch.id, laptopBatch.id]);
    assert.throws(
      () => queue.claim("capozen", "office-second", "codex_mcp", "codex_mcp:office-pc"),
      /active batch/i,
    );
    assert.equal(queue.activeBatch("capozen", "codex_mcp:laptop")?.id, laptopBatch.id);
  } finally { db.close(); }
});

test("request IDs cannot reveal another owner's lease", () => {
  const { queue, db } = setup();
  try {
    const settings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 1 });
    queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "one", input: source, original: {}, settings });
    const officeBatch = queue.claim("capozen", "shared-request", "codex_mcp", "codex_mcp:office-pc");

    assert.throws(
      () => queue.claim("capozen", "shared-request", "codex_mcp", "codex_mcp:laptop"),
      /another owner/i,
    );
    assert.equal(queue.activeBatch("capozen", "codex_mcp:office-pc")?.leaseToken, officeBatch.leaseToken);
    assert.equal(queue.activeBatch("capozen", "codex_mcp:laptop"), null);
  } finally { db.close(); }
});

test("releasing one owner leaves another owner's batch active", () => {
  const { queue, db } = setup();
  try {
    const settings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 1 });
    queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "one", input: { ...source, title: "one" }, original: {}, settings });
    queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "two", input: { ...source, title: "two" }, original: {}, settings });
    const officeBatch = queue.claim("capozen", "office", "codex_mcp", "codex_mcp:office-pc");
    const laptopBatch = queue.claim("capozen", "laptop", "codex_mcp", "codex_mcp:laptop");

    queue.release("capozen", officeBatch.id, officeBatch.leaseToken);

    assert.equal(queue.get("capozen", officeBatch.jobs[0]!.id).status, "PENDING");
    assert.equal(queue.get("capozen", laptopBatch.jobs[0]!.id).status, "IN_PROGRESS");
    assert.equal(queue.activeBatch("capozen", "codex_mcp:office-pc"), null);
    assert.equal(queue.activeBatch("capozen", "codex_mcp:laptop")?.id, laptopBatch.id);
  } finally { db.close(); }
});

test("separate queue connections claim disjoint jobs for separate owners", () => {
  const folder = mkdtempSync(join(tmpdir(), "gpt-seo-parallel-"));
  const filename = join(folder, "queue.sqlite3");
  const firstDb = new DatabaseSync(filename);
  const secondDb = new DatabaseSync(filename);
  try {
    const firstQueue = new CustomGptQueue(firstDb);
    const secondQueue = new CustomGptQueue(secondDb);
    const settings = firstQueue.configure("capozen", { provider: "codex_mcp", batchSize: 2 });
    for (const sourceIdentity of ["one", "two", "three", "four"]) {
      firstQueue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity, input: { ...source, title: sourceIdentity }, original: {}, settings });
    }

    const firstBatch = firstQueue.claim("capozen", "first", "codex_mcp", "codex_mcp:first");
    const secondBatch = secondQueue.claim("capozen", "second", "codex_mcp", "codex_mcp:second");
    const firstIds = new Set(firstBatch.jobs.map(job => job.id));
    const secondIds = new Set(secondBatch.jobs.map(job => job.id));

    assert.equal([...firstIds].some(jobId => secondIds.has(jobId)), false);
    assert.equal(firstIds.size + secondIds.size, 4);
  } finally {
    firstDb.close();
    secondDb.close();
    rmSync(folder, { recursive: true, force: true });
  }
});

test("queue migrates version two batch owners by provider", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE gpt_batches (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, request_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, active INTEGER NOT NULL, provider TEXT NOT NULL DEFAULT 'custom_gpt', UNIQUE(store_id,request_id));
      INSERT INTO gpt_batches VALUES ('codex-batch','capozen','codex-request','codex-lease',999999,1,'codex_mcp');
      INSERT INTO gpt_batches VALUES ('custom-batch','capozen','custom-request','custom-lease',999999,1,'custom_gpt');
      PRAGMA user_version=2;
    `);

    const queue = new CustomGptQueue(db, () => 1_000);

    assert.equal(queue.activeBatch("capozen", "codex_mcp:default")?.id, "codex-batch");
    assert.equal(queue.activeBatch("capozen", "custom_gpt")?.id, "custom-batch");
    assert.equal(db.prepare("PRAGMA user_version").get()?.user_version, 3);
  } finally { db.close(); }
});

test("queue migrates legacy jobs and batches to the Custom GPT provider", () => {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(`
      CREATE TABLE gpt_settings (store_id TEXT PRIMARY KEY, payload TEXT NOT NULL);
      CREATE TABLE gpt_jobs (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, dedup TEXT NOT NULL, status TEXT NOT NULL, batch_id TEXT, payload TEXT NOT NULL, created_at INTEGER NOT NULL, UNIQUE(store_id,dedup));
      CREATE TABLE gpt_batches (id TEXT PRIMARY KEY, store_id TEXT NOT NULL, request_id TEXT NOT NULL, token TEXT NOT NULL, expires_at INTEGER NOT NULL, active INTEGER NOT NULL, UNIQUE(store_id,request_id));
    `);
    const legacyJob = { storeId: "capozen", source: "amazon", sourceIdentity: "LEGACY", inputHash: "hash", input: source, original: {}, settings: { provider: "custom_gpt", batchSize: 5, version: 1, language: "en-US", instructions: "facts" }, id: "legacy-job", status: "PENDING", checkpoints: {}, createdAt: 1, updatedAt: 1 };
    db.prepare("INSERT INTO gpt_jobs VALUES (?,?,?,?,?,?,?)").run("legacy-job", "capozen", "legacy-dedup", "PENDING", null, JSON.stringify(legacyJob), 1);

    const queue = new CustomGptQueue(db);

    assert.equal(db.prepare("SELECT provider FROM gpt_jobs WHERE id=?").get("legacy-job")?.provider, "custom_gpt");
    assert.equal(queue.claim("capozen", "legacy-claim", "custom_gpt", "custom_gpt").jobs[0]?.id, "legacy-job");
  } finally { db.close(); }
});
test("Custom GPT mutation keys reject different payloads and release preserves completed jobs", () => {
  const { queue, db } = setup();
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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

test("cancelling a ready review preserves its result and checkpoints", () => {
  const { queue, db } = setup();
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "cancel-ready", input: source, original: {} });
    const batch = queue.claim("capozen", "cancel-ready-claim", "custom_gpt", "custom_gpt");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit-cancel", stage: "submission", payload: { title: "SEO title" } });
    queue.finish("capozen", job.id, { title: "Final SEO title" });

    queue.cancelReview("capozen", job.id);

    const cancelled = queue.get("capozen", job.id);
    assert.equal(cancelled.status, "CANCELLED");
    assert.deepEqual(cancelled.result, { title: "Final SEO title" });
    assert.deepEqual(cancelled.checkpoints.submission, { title: "SEO title" });
    assert.equal(queue.list("capozen", "REVIEW_READY").length, 0);
    assert.equal(queue.counts("capozen").CANCELLED, 1);
    assert.throws(() => queue.cancelReview("capozen", job.id), /ready review/i);
  } finally { db.close(); }
});

test("AEO backfill resets only unsynced ready reviews and removes stale submissions", () => {
  const { queue, db } = setup();
  try {
    const settings = queue.configure("jeminise-real", { provider: "codex_mcp", batchSize: 10 });
    const job = queue.enqueue({ storeId: "jeminise-real", source: "auto_seo", sourceIdentity: "aeo-backfill", input: source, original: {}, settings });
    const batch = queue.claim("jeminise-real", "aeo-backfill-claim", "codex_mcp", "codex_mcp:acer-codex");
    const lease = { batchId: batch.id, leaseToken: batch.leaseToken };
    queue.checkpoint("jeminise-real", job.id, { ...lease, requestId: "analysis-old", stage: "analysis", payload: { visual: true } });
    queue.checkpoint("jeminise-real", job.id, { ...lease, requestId: "research-old", stage: "research", payload: { suggestions: [] } });
    queue.checkpoint("jeminise-real", job.id, { ...lease, requestId: "keywords-old", stage: "keywords", payload: { keywords: ["cotton rug"] } });
    queue.checkpoint("jeminise-real", job.id, { ...lease, requestId: "submission-old", stage: "submission", payload: { draft: { productTitle: "Old" } } });
    queue.finish("jeminise-real", job.id, { output: { productTitle: "Old" } });
    queue.release("jeminise-real", batch.id, batch.leaseToken);

    const result = queue.resetReviewReadyForAeoBackfill("jeminise-real", "codex_mcp");
    const reset = queue.get("jeminise-real", job.id);

    assert.deepEqual(result, { resetCount: 1, jobIds: [job.id] });
    assert.equal(reset.status, "PENDING");
    assert.deepEqual(reset.checkpoints.analysis, { visual: true });
    assert.deepEqual(reset.checkpoints.research, { suggestions: [] });
    assert.deepEqual(reset.checkpoints.keywords, { keywords: ["cotton rug"] });
    assert.equal(reset.checkpoints.submission, undefined);
    assert.equal(reset.result, undefined);
    assert.equal(db.prepare("SELECT 1 FROM gpt_deliveries WHERE job_id=?").get(job.id), undefined);
  } finally { db.close(); }
});

test("AEO backfill refuses reviews already approved or synchronized", () => {
  const { queue, db } = setup();
  try {
    const settings = queue.configure("jeminise-real", { provider: "codex_mcp", batchSize: 10 });
    const job = queue.enqueue({ storeId: "jeminise-real", source: "auto_seo", sourceIdentity: "approved-aeo", input: source, original: {}, settings });
    const batch = queue.claim("jeminise-real", "approved-aeo-claim", "codex_mcp", "codex_mcp:acer-codex");
    queue.checkpoint("jeminise-real", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "approved-submit", stage: "submission", payload: {} });
    queue.finish("jeminise-real", job.id, {});
    queue.saveReviewState("jeminise-real", job.id, { reviewDecision: "approved" });

    assert.throws(() => queue.resetReviewReadyForAeoBackfill("jeminise-real", "codex_mcp"), /approved|sync/i);
    assert.equal(queue.get("jeminise-real", job.id).status, "REVIEW_READY");
  } finally { db.close(); }
});

test("a synced GPT review can be removed without changing its Shopify sync record", () => {
  const { queue, db } = setup();
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "synced-review", input: source, original: {} });
    const batch = queue.claim("capozen", "synced-review-claim", "custom_gpt", "custom_gpt");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "synced-submit", stage: "submission", payload: {} });
    queue.finish("capozen", job.id, {});
    queue.saveReviewState("capozen", job.id, { reviewDecision: "approved" });
    const token = queue.beginSync("capozen", job.id);
    assert.throws(() => queue.cancelReview("capozen", job.id), /sync has already started/i);
    queue.finishSync("capozen", job.id, token, "SYNCED");

    queue.cancelReview("capozen", job.id);

    assert.equal(queue.get("capozen", job.id).status, "CANCELLED");
    assert.equal(queue.syncState("capozen", job.id)?.status, "SYNCED");
  } finally { db.close(); }
});
test("updating analysis invalidates dependent keyword and research checkpoints", () => {
  const { queue, db } = setup();
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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
      const batch = queue.claim("capozen", `claim-${index}`, "custom_gpt", "custom_gpt");
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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "ASIN", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
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
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const job = queue.enqueue({ storeId: "capozen", source: "auto_seo", sourceIdentity: "1", input: source, original: {} });
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    assert.equal(queue.pendingFinalization().length, 1);
    const secondWorker = new CustomGptQueue(db, () => 1000);
    assert.equal(secondWorker.pendingFinalization().length, 0);
  } finally { db.close(); }
});

test("new source revisions invalidate unsynced ready drafts before a stale browser can publish", () => {
  const { queue, db } = setup();
  try {
    queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
    const original = { storeId: "capozen", source: "auto_seo" as const, sourceIdentity: "1", input: source, original: {} };
    const job = queue.enqueue(original);
    const batch = queue.claim("capozen", "claim", "custom_gpt", "custom_gpt");
    queue.checkpoint("capozen", job.id, { batchId: batch.id, leaseToken: batch.leaseToken, requestId: "submit", stage: "submission", payload: {} });
    queue.finish("capozen", job.id, {});
    queue.saveReviewState("capozen", job.id, { reviewDecision: "approved" });
    queue.enqueue({ ...original, sourceRevision: "newer" });
    assert.equal(queue.get("capozen", job.id).status, "CANCELLED");
    assert.throws(() => queue.beginSync("capozen", job.id), /ready/i);
  } finally { db.close(); }
});
