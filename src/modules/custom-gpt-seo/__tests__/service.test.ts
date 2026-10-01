import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomGptClient } from "../service";

test("Custom GPT client preserves store scope and reports server errors", async () => {
  let requested = "";
  const client = createCustomGptClient(async (url) => { requested = String(url); return new Response(JSON.stringify({ error: { message: "Invalid batch size" } }), { status: 400 }); });
  await assert.rejects(client.settings("store one"), /Invalid batch size/);
  assert.match(requested, /storeId=store%20one/);
});

test("Custom GPT client cancels a review through the store-scoped admin route", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const client = createCustomGptClient(async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(JSON.stringify({ cancelled: true }), { status: 200 });
  });

  await client.cancelReview("store one", "job-123");

  assert.equal(requestedUrl, "/api/v1/gpt-seo/admin/cancel?storeId=store%20one");
  assert.equal(requestedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), { jobId: "job-123" });
});
