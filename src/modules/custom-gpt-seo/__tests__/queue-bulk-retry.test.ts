import assert from "node:assert/strict";
import test from "node:test";

import { continueQueueRetry } from "../ui/queue-bulk-retry";
import type { QueueRetryRun } from "../ui/queue-bulk-retry";
import { createCustomGptClient } from "../service";
import { createMockCustomGptClient } from "../mocks/runner";

test("bulk retry keeps successful chunks and resumes the interrupted chunk with the same request key", async () => {
  let run: QueueRetryRun = { storeId: "sample", requestId: "stable", jobIds: Array.from({ length: 55 }, (_, i) => String(i)), outcomes: [] };
  let calls = 0;
  const client = { retryBatch: async (storeId: string, ids: readonly string[], requestId: string) => {
    assert.equal(storeId, "sample"); assert.equal(requestId, "stable"); assert.ok(ids.length <= 20);
    calls++;
    if (calls === 2) throw new Error("Disconnected");
    return { outcomes: ids.map(jobId => ({ jobId, status: "retried" as const })) };
  } };
  await assert.rejects(continueQueueRetry({ client, run, shouldStop: () => false, onProgress: next => { run = next; } }), /Disconnected/);
  assert.equal(run.outcomes.length, 20);
  run = await continueQueueRetry({ client, run, shouldStop: () => false, onProgress: next => { run = next; } });
  assert.equal(run.outcomes.length, 55);
  assert.equal(calls, 4);
  assert.equal(new Set(run.outcomes.map(outcome => outcome.jobId)).size, 55);
});

test("stop preserves the completed group and never schedules another", async () => {
  let stop = false;
  const run: QueueRetryRun = { storeId: "sample", requestId: "stop", jobIds: Array.from({ length: 50 }, (_, i) => String(i)), outcomes: [] };
  const result = await continueQueueRetry({ run, shouldStop: () => stop, onProgress: () => { stop = true; },
    client: { retryBatch: async (_store, ids) => ({ outcomes: ids.map(jobId => ({ jobId, status: "skipped" as const })) }) } });
  assert.equal(result.outcomes.length, 20);
});

test("real and mock clients scope snapshots and batches without claiming jobs", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const client = createCustomGptClient(async (url, init) => {
    calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
    return Response.json(String(url).includes("retry-candidates") ? { jobIds: ["one"] } : { outcomes: [{ jobId: "one", status: "skipped" }] });
  });
  await client.retryCandidates("store one", "codex_mcp");
  await client.retryBatch("store one", ["one"], "same-key");
  assert.match(calls[0].url, /provider=codex_mcp&storeId=store%20one/);
  assert.deepEqual(calls[1].body, { jobIds: ["one"], requestId: "same-key" });
  const mock = createMockCustomGptClient();
  assert.deepEqual(await mock.retryCandidates("other"), { jobIds: [] });
  assert.deepEqual(await mock.retryBatch("other", ["mock-gpt-1"], "key"), { outcomes: [{ jobId: "mock-gpt-1", status: "skipped" }] });
});
