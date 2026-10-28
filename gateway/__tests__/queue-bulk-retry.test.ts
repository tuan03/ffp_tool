import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import http from "node:http";

import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createCustomGptHandler } from "../custom-gpt-seo/handler";
import { createTestEnqueue } from "./seo-v2-fixtures";

test("bulk retry snapshots all pages, fences stores and replays without resetting jobs twice", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const queue = new CustomGptQueue(db);
    const jobs = Array.from({ length: 55 }, (_, i) => queue.enqueue(createTestEnqueue({ storeId: "sample", sourceIdentity: String(i) })));
    db.exec("UPDATE gpt_jobs SET status='FAILED',payload=json_set(payload,'$.status','FAILED')");
    const other = queue.enqueue(createTestEnqueue({ storeId: "other", sourceIdentity: "other" }));
    assert.equal(queue.retryCandidates("sample").length, 55);
    const id = jobs[0].id;
    assert.deepEqual(queue.retrySafely("sample", id, "run-one"), { jobId: id, status: "retried" });
    db.prepare("UPDATE gpt_jobs SET status='FAILED',payload=json_set(payload,'$.status','FAILED') WHERE id=?").run(id);
    assert.equal(queue.retrySafely("sample", id, "run-one").status, "retried");
    assert.equal(queue.get("sample", id).status, "FAILED");
    assert.equal(queue.retrySafely("sample", other.id, "run-one").status, "skipped");
    db.prepare("UPDATE gpt_jobs SET payload=json_set(payload,'$.queueArchivedAt',1) WHERE id=?").run(jobs[1].id);
    assert.equal(queue.retrySafely("sample", jobs[1].id, "run-one").status, "skipped");
    assert.equal(queue.retryCandidates("sample").length, 54);
    assert.equal(queue.retryCandidates("sample", "custom_gpt").length, 0);
  } finally { db.close(); }
});

test("bulk endpoints require admin auth, bound each request and preserve partial successes", async context => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const job = queue.enqueue(createTestEnqueue({ storeId: "sample" }));
  db.exec("UPDATE gpt_jobs SET status='FAILED',payload=json_set(payload,'$.status','FAILED')");
  const handler = createCustomGptHandler({ queue, storeId: "sample", adminKey: "test-admin" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin`;
  const headers = { Authorization: "Bearer test-admin", "Content-Type": "application/json" };
  const retrySafely = queue.retrySafely.bind(queue);
  context.mock.method(queue, "retrySafely", (storeId: string, jobId: string, requestId: string) => {
    if (jobId === "fail") throw new Error("Simulated storage failure");
    return retrySafely(storeId, jobId, requestId);
  });
  try {
    assert.equal((await fetch(`${base}/retry-candidates?storeId=sample`)).status, 401);
    assert.deepEqual(await (await fetch(`${base}/retry-candidates?storeId=sample`, { headers })).json(), { jobIds: [job.id] });
    const response = await fetch(`${base}/retry-batch?storeId=sample`, { method: "POST", headers, body: JSON.stringify({ requestId: "batch", jobIds: [job.id, "fail", "missing"] }) });
    assert.deepEqual(await response.json(), { outcomes: [{ jobId: job.id, status: "retried" }, { jobId: "fail", status: "failed" }, { jobId: "missing", status: "skipped" }] });
    assert.equal((await fetch(`${base}/retry-batch?storeId=sample`, { method: "POST", headers, body: JSON.stringify({ requestId: "oversize", jobIds: Array.from({ length: 21 }, (_, i) => String(i)) }) })).status, 400);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});
