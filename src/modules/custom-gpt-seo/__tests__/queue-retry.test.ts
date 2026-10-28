import assert from "node:assert/strict";
import test from "node:test";

import { mockJobs } from "../mocks/data";
import { applyConfirmedQueueRetry } from "../ui/queue-retry";

test("confirmed retry moves a product out of attention and updates counts only once", () => {
  const seed = mockJobs[0];
  assert.ok(seed);
  const job = { ...seed, status: "FAILED" as const };
  const queue = { jobs: [job], counts: { FAILED: 3, PENDING: 2 }, activeBatch: null, activeBatches: [], nextOffset: null };
  const next = applyConfirmedQueueRetry(queue, job.id);
  assert.equal(next.jobs[0].status, "PENDING");
  assert.equal(next.jobs[0].error, undefined);
  assert.deepEqual(next.counts, { FAILED: 2, PENDING: 3 });
  assert.deepEqual(applyConfirmedQueueRetry(next, job.id), next);
  assert.equal(applyConfirmedQueueRetry(queue, "different-page"), queue);
  assert.equal(queue.jobs[0].status, "FAILED");
});
