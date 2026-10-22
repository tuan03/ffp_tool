import assert from "node:assert/strict";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { createServer } from "node:http";

import { parseChatGptSamples } from "../review-text-provider";
import { ReviewTextJobs } from "../review-text-jobs";
import type { ReviewTextJob, ReviewTextRepository } from "../review-text-repository";
import { PostgresReviewTextRepository } from "../review-text-repository";
import { handleAmazonReviewsHttpRequest } from "../amazon-reviews-handler";

test("ChatGPT JSON parser retains missing positions instead of shifting review plans", () => {
  const valid = { author: "Morgan Reed", body: "A floral pattern covers this rug.", rating: 5, variantText: "", verifiedPurchase: false };
  const parsed = parseChatGptSamples('```json\n' + JSON.stringify({ samples: [null, valid] }) + '\n```');
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0]?.author, "");
  assert.equal(parsed[1]?.author, "Morgan Reed");
  assert.throws(() => parseChatGptSamples("I cannot do that."), /JSON/);
});

test("PostgreSQL job storage deduplicates active context, isolates stores and recovers without replay", async () => {
  const db = new PGlite();
  const repository = new PostgresReviewTextRepository("unused", {
    async query<T extends Record<string, unknown>>(sql: string, values?: unknown[]) {
      if (sql.includes("CREATE TABLE")) { await db.exec(sql); return { rows: [] as T[] }; }
      return db.query<T>(sql, values);
    },
    async end() { await db.close(); },
  });
  try {
    await repository.initialize();
    const job: ReviewTextJob = { id: "one", requestId: "request-1", contextJobId: "context", storeId: "fixture", count: 1,
      createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", status: "queued" };
    await repository.insert(job);
    assert.equal((await repository.insert({ ...job, id: "two", requestId: "request-2" })).id, "one");
    assert.equal(await repository.latest("context", "other-store"), null);
    await repository.recover();
    assert.equal((await repository.get("one"))?.status, "interrupted");
    assert.equal((await repository.byRequest("request-1"))?.id, "one");
    const second = await repository.insert({ ...job, id: "two", requestId: "request-2" });
    second.status = "saving"; second.result = { samples: [], warnings: [], rejected: 0, promptVersion: "review_sample_v3" };
    await repository.update(second); await repository.recover();
    assert.equal((await repository.get("two"))?.status, "save_failed");
  } finally { await repository.close(); }
});

test("a cancelled generation cannot save late text results", async () => {
  let release: (() => void) | undefined;
  let started: (() => void) | undefined;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const pending = new Promise<void>(resolve => { release = resolve; });
  let saved = false;
  const service = new ReviewTextJobs(memoryRepository(), {
    async readContext() { return { asin: "B012345678", count: 1, product: { title: "Floral rug" }, sourceReviews: [], priorSamples: [] }; },
    async checkBridge() {},
    async generate() { started?.(); await pending; return { samples: [], rejected: 1, warnings: [], promptVersion: "review_sample_v3" }; },
    async cancelBridge() { release?.(); }, async save() { saved = true; },
  });
  const job = await service.create({ contextJobId: "context", storeId: "fixture", count: 1, requestId: "request" });
  await didStart;
  const duplicate = await service.create({ contextJobId: "context", storeId: "fixture", count: 1, requestId: "other" });
  assert.equal(duplicate.id, job.id);
  await service.cancel(job.id);
  assert.equal((await service.get(job.id))?.status, "cancelled");
  assert.equal(saved, false);
});

function memoryRepository(): ReviewTextRepository {
  const jobs = new Map<string, ReviewTextJob>();
  return {
    async insert(job) {
      const previous = [...jobs.values()].find(entry => entry.requestId === job.requestId ||
        entry.contextJobId === job.contextJobId && !["completed", "partial", "failed", "cancelled", "interrupted"].includes(entry.status));
      if (previous) return structuredClone(previous);
      jobs.set(job.id, structuredClone(job)); return structuredClone(job);
    },
    async get(id) { return structuredClone(jobs.get(id) ?? null); },
    async byRequest(requestId) { return structuredClone([...jobs.values()].find(job => job.requestId === requestId) ?? null); },
    async latest(contextJobId, storeId) { return structuredClone([...jobs.values()].reverse().find(job => job.contextJobId === contextJobId && job.storeId === storeId) ?? null); },
    async update(job) { jobs.set(job.id, structuredClone(job)); },
    async recover() {}, async close() {},
  };
}

test("background generation preserves accepted samples on save failure and retries only saving", async () => {
  let generations = 0; let saves = 0;
  const service = new ReviewTextJobs(memoryRepository(), {
    async readContext() { return { asin: "B012345678", count: 1, product: { title: "Floral rug" }, sourceReviews: [], priorSamples: [], startIndex: 1 }; },
    async checkBridge() {}, async cancelBridge() {},
    async generate(_input, _id, _signal, progress) {
      generations++;
      await progress("running", "reading_response");
      assert.equal((await service.get(_id))?.phase, "reading_response");
      await progress("validating");
      assert.equal((await service.get(_id))?.phase, undefined, "browser phase must clear after server receives the response");
      return { samples: [{ reviewId: "SYNTH-B012345678-001", author: "Morgan Reed", rating: 5, body: "A floral pattern covers this rug.", variantText: "", verifiedPurchase: false, synthetic: true, source: "ai_sample", promptVersion: "review_sample_v3", qualityStatus: "accepted", qualityWarnings: [] }], rejected: 0, warnings: [], promptVersion: "review_sample_v3" };
    },
    async save() { if (++saves === 1) throw new Error("Unavailable"); },
  });
  const first = await service.create({ contextJobId: "context-1", storeId: "fixture", count: 1, requestId: "request-1" });
  await service.wait(first.id);
  assert.equal((await service.get(first.id))?.status, "save_failed");
  const duplicate = await service.create({ contextJobId: "context-1", storeId: "fixture", count: 1, requestId: "request-1" });
  assert.equal(duplicate.id, first.id);
  await service.retrySave(first.id); await service.wait(first.id);
  assert.equal((await service.get(first.id))?.status, "completed");
  assert.equal(generations, 1); assert.equal(saves, 2);
});

test("text job HTTP routes authenticate, return 202, and never expose private context", async () => {
  const service = new ReviewTextJobs(memoryRepository(), {
    async readContext() { return { asin: "B012345678", count: 1, product: { title: "private fixture" }, sourceReviews: [], priorSamples: [] }; },
    async checkBridge() {}, async cancelBridge() {}, async save() {},
    async generate() { return { samples: [], rejected: 1, warnings: [], promptVersion: "review_sample_v3" }; },
  });
  const server = createServer((req, res) => { void handleAmazonReviewsHttpRequest(req, res, { jobs: service, authToken: "fixture-token", maxBodyBytes: 1024 }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/amazon-reviews/samples`;
    assert.equal((await fetch(base)).status, 401);
    const headers = { "X-Gateway-Key": "fixture-token", "Content-Type": "application/json" };
    assert.equal((await fetch(base, { method: "POST", headers, body: JSON.stringify({ asin: "B012345678", count: 1 }) })).status, 422);
    const response = await fetch(base, { method: "POST", headers, body: JSON.stringify({ contextJobId: "fixture-context", storeId: "fixture-store", count: 1, requestId: "fixture-request" }) });
    assert.equal(response.status, 202);
    const body = await response.text(); assert.doesNotMatch(body, /private fixture|"input"|"product"/);
    const latest = await fetch(`${base}?contextJobId=fixture-context&storeId=fixture-store`, { headers });
    assert.equal(latest.status, 200);
    assert.match(await latest.text(), /fixture-context/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
