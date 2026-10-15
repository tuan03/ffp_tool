import assert from "node:assert/strict";
import test from "node:test";

import { SeoGatewayRequestError, settleSeoEnqueueConflict, recoverUncertainSeoEnqueue } from "./pipeline-seo-handoff.ts";

test("enqueue collision is skipped only after the server verifies exact ASINs", async () => {
  const error = new SeoGatewayRequestError("ALREADY_IN_SEO_PIPELINE", 409, "ALREADY_IN_SEO_PIPELINE");
  assert.equal(await settleSeoEnqueueConflict({ error, verifyAndSkip: async () => true }), true);
  await assert.rejects(settleSeoEnqueueConflict({ error, verifyAndSkip: async () => false }),
    caught => caught.code === "SEO_PIPELINE_IDENTITY_CONFLICT");
});

test("transport failures and arbitrary error messages are never treated as duplicates", async () => {
  const verifyAndSkip = async () => { throw new Error("must not skip"); };
  assert.equal(await settleSeoEnqueueConflict({ error: new Error("ALREADY_IN_SEO_PIPELINE"), verifyAndSkip }), false);
  assert.equal(await settleSeoEnqueueConflict({ error: new SeoGatewayRequestError("UNAVAILABLE", 503, "offline"), verifyAndSkip }), false);
});

test("a timed-out enqueue recovers its own committed receipt without another enqueue", async () => {
  let reads = 0;
  const delays = [];
  assert.equal(await recoverUncertainSeoEnqueue({
    error: new DOMException("Timed out", "TimeoutError"),
    recover: async () => ++reads === 3,
    delay: async milliseconds => { delays.push(milliseconds); },
  }), true);
  assert.equal(reads, 3);
  assert.deepEqual(delays, [500, 1500]);
});

test("uncertain recovery is bounded and never swallows business errors", async () => {
  let reads = 0;
  assert.equal(await recoverUncertainSeoEnqueue({ error: new TypeError("fetch failed"),
    recover: async () => { reads++; throw new Error("offline"); }, delay: async () => {},
  }), false);
  assert.equal(reads, 3);
  assert.equal(await recoverUncertainSeoEnqueue({ error: new SeoGatewayRequestError("INVALID_INPUT", 400, "bad"),
    recover: async () => { throw new Error("must not run"); }, delay: async () => {},
  }), false);
});
