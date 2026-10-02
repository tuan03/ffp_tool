import assert from "node:assert/strict";
import test from "node:test";

import { runReviewImageUploadTick } from "../../scripts/review-image-upload-worker";

test("review upload retries only result delivery after Shopify success", async () => {
  let writes = 0;
  let acknowledgements = 0;
  await runReviewImageUploadTick({
    coordinatorUrl: "http://coordinator", gatewayUrl: "http://gateway", pipelineToken: "pipeline", gatewayToken: "gateway",
    outputRoot: "/runtime/outputs",
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/claim")) return Response.json({ upload: {
        jobId: "a".repeat(32), attemptId: "b".repeat(32), storeId: "capozen", outputName: `${"a".repeat(32)}.png`,
      } });
      if (url === "http://gateway") {
        writes++;
        assert.equal(new Headers(init?.headers).get("x-gateway-key"), "gateway");
        return Response.json({ success: true, data: { fileId: "file-1", shopifyCdnUrl: "https://cdn.shopify.com/a.png", fileStatus: "READY" } });
      }
      acknowledgements++;
      if (acknowledgements === 1) throw new Error("connection lost");
      const body: unknown = JSON.parse(String(init?.body));
      assert.deepEqual(body, { attemptId: "b".repeat(32), result: { fileId: "file-1", shopifyCdnUrl: "https://cdn.shopify.com/a.png", fileStatus: "READY" } });
      return Response.json({ status: "completed" });
    },
  });
  assert.equal(writes, 1);
  assert.equal(acknowledgements, 2);
});

test("review upload records ambiguous transport failure without replaying Shopify write", async () => {
  let writes = 0;
  await runReviewImageUploadTick({
    coordinatorUrl: "http://coordinator", gatewayUrl: "http://gateway", pipelineToken: "pipeline", gatewayToken: "gateway", outputRoot: "/runtime/outputs",
    fetcher: async (input, init) => {
      if (String(input).endsWith("/claim")) return Response.json({ upload: {
        jobId: "a".repeat(32), attemptId: "b".repeat(32), storeId: "capozen", outputName: `${"a".repeat(32)}.png`,
      } });
      if (String(input) === "http://gateway") { writes++; throw new Error("unknown outcome"); }
      assert.equal(JSON.parse(String(init?.body)).result, null);
      return Response.json({ status: "uncertain" });
    },
  });
  assert.equal(writes, 1);
});
