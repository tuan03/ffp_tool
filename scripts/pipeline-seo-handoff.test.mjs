import assert from "node:assert/strict";
import test from "node:test";

import { SeoGatewayRequestError, settleSeoEnqueueConflict } from "./pipeline-seo-handoff.ts";

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
