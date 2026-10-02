import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomGptClient } from "../service";
import { createMockCustomGptClient } from "../mocks/runner";

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

test("Custom GPT client lists configured Shopify stores for the queue selector", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const client = createCustomGptClient(async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(JSON.stringify({
      success: true,
      data: {
        stores: [
          { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
          { storeId: "wrydeco", shopDomain: "wrydeco.myshopify.com" },
          { storeId: "", shopDomain: "invalid.myshopify.com" },
        ],
      },
    }), { status: 200 });
  });

  const stores = await client.stores();

  assert.equal(requestedUrl, "/api/shopify");
  assert.equal(requestedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), { operation: "stores.list", payload: {} });
  assert.deepEqual(stores, [
    { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
    { storeId: "wrydeco", shopDomain: "wrydeco.myshopify.com" },
  ]);
});

test("mock Custom GPT client provides stores for the queue selector", async () => {
  const stores = await createMockCustomGptClient().stores();

  assert.ok(stores.some(store => store.storeId === "capozen"));
});

test("Custom GPT client loads review pages and saves bulk review states", async () => {
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const client = createCustomGptClient(async (url, init) => {
    requests.push({ url: String(url), init });
    return new Response(JSON.stringify(
      init?.method === "POST"
        ? { saved: 2 }
        : { reviews: [], counts: { REVIEW_READY: 100 }, nextOffset: 50 },
    ), { status: 200 });
  });

  const page = await client.reviews("jeminise-real", 0);
  const saved = await client.saveReviewStates("jeminise-real", [
    { jobId: "job-1", state: { reviewDecision: "approved" } },
    { jobId: "job-2", state: { reviewDecision: "approved" } },
  ]);

  assert.equal(page.counts.REVIEW_READY, 100);
  assert.equal(saved.saved, 2);
  assert.equal(requests[0]?.url, "/api/v1/gpt-seo/admin/reviews?offset=0&storeId=jeminise-real");
  assert.equal(requests[1]?.url, "/api/v1/gpt-seo/admin/review-states?storeId=jeminise-real");
  assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
    reviews: [
      { jobId: "job-1", state: { reviewDecision: "approved" } },
      { jobId: "job-2", state: { reviewDecision: "approved" } },
    ],
  });
});

test("Custom GPT client sends queue filters before server pagination", async () => {
  let requestedUrl = "";
  const client = createCustomGptClient(async (url) => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({
      jobs: [],
      counts: { PENDING: 50, REVIEW_READY: 200 },
      activeBatch: null,
      activeBatches: [],
      nextOffset: null,
    }), { status: 200 });
  });

  await client.list("jeminise-real", 0, {
    statuses: ["PENDING"],
    provider: "codex_mcp",
  });

  assert.equal(
    requestedUrl,
    "/api/v1/gpt-seo/admin/jobs?offset=0&statuses=PENDING&provider=codex_mcp&storeId=jeminise-real",
  );
});
