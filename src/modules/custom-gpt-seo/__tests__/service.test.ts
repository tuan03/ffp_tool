import assert from "node:assert/strict";
import { test } from "node:test";
import { createCustomGptClient } from "../service";
import { createMockCustomGptClient } from "../mocks/runner";

test("worker review history is store-scoped, paginated and has fresh mock results", async () => {
  const client = createCustomGptClient(async (url, init) => {
    assert.equal(String(url), "/api/seo-agent/review-history?jobId=job%2F1&offset=50&storeId=store%20one");
    assert.equal(init?.cache, "no-store");
    return new Response(JSON.stringify({ total: 51, nextOffset: null, entries: [] }));
  });
  assert.equal((await client.workerReviewHistory("store one", "job/1", 50)).total, 51);
  const mock = createMockCustomGptClient();
  assert.notEqual(await mock.workerReviewHistory("a", "1"), await mock.workerReviewHistory("a", "1"));
});

test("revision client creates a new job through the operator endpoint with mock parity", async () => {
  const client = createCustomGptClient(async (url, init) => {
    assert.equal(String(url), "/api/seo-agent/revisions?storeId=demo");
    assert.equal(new Headers(init?.headers).get("x-ffp-agent"), "1");
    assert.deepEqual(JSON.parse(String(init?.body)), { jobId: "old", requestId: "request", instructions: "Improve" });
    return new Response(JSON.stringify({ jobId: "new", previousJobId: "old" }), { status: 201 });
  });
  assert.deepEqual(await client.createRevision("demo", "old", "request", "Improve"), { jobId: "new", previousJobId: "old" });
  const mock = await createMockCustomGptClient().createRevision("demo", "old", "request");
  assert.equal(mock.previousJobId, "old");
  assert.notEqual(mock.jobId, "old");
});

test("backend publish client sends a revision and idempotency key without a Shopify write", async () => {
  const client = createCustomGptClient(async (url, init) => {
    assert.equal(String(url), "/api/seo-agent/publish?storeId=demo");
    assert.equal(init?.credentials, "same-origin");
    assert.equal(new Headers(init?.headers).get("x-ffp-agent"), "1");
    assert.deepEqual(JSON.parse(String(init?.body)), { jobId: "job", reviewUpdatedAt: 7, requestId: "sync" });
    return new Response(JSON.stringify({ id: "receipt", jobId: "job", state: "QUEUED", errorCode: null, seoVersion: null }), { status: 202 });
  });
  assert.equal((await client.publishReview("demo", "job", 7, "sync")).state, "QUEUED");
  assert.equal((await createMockCustomGptClient().publishStatus("demo", "job")).managed, false);
});

test("Agent Access client scopes tokens to store, disables cache and includes mutation protection", async () => {
  const client = createCustomGptClient(async (url, init) => {
    assert.equal(String(url), "/api/seo-agent/tokens?storeId=store%20one");
    assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("x-ffp-agent"), "1");
    assert.deepEqual(JSON.parse(String(init?.body)), { workerId: "laptop" });
    return new Response(JSON.stringify({ token: "test-only", tokenId: "id", expiresAt: 100 }));
  });
  assert.equal((await client.createAgentToken("store one", "laptop")).tokenId, "id");
  const mock = createMockCustomGptClient();
  assert.deepEqual((await mock.agentAccess("demo")).tokens, []);
  assert.equal((await mock.agentRuns("demo")).total, 0);
});

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

test("Custom GPT client requeues review jobs through admin/requeue route", async () => {
  let requestedUrl = "";
  let requestedInit: RequestInit | undefined;
  const client = createCustomGptClient(async (url, init) => {
    requestedUrl = String(url);
    requestedInit = init;
    return new Response(JSON.stringify({ requeued: 2 }), { status: 200 });
  });

  const res = await client.requeue("capozen", ["job-1", "job-2"], {
    provider: "gemini",
    instructions: "Viết lại mô tả theo phong cách sang trọng",
  });

  assert.equal(res.requeued, 2);
  assert.equal(requestedUrl, "/api/v1/gpt-seo/admin/requeue?storeId=capozen");
  assert.equal(requestedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(requestedInit?.body)), {
    jobIds: ["job-1", "job-2"],
    provider: "gemini",
    instructions: "Viết lại mô tả theo phong cách sang trọng",
  });
});

test("Mock Custom GPT client handles requeue correctly", async () => {
  const mockClient = createMockCustomGptClient();
  const res = await mockClient.requeue("capozen", ["job-mock-1"], { provider: "gemini" });
  assert.equal(res.requeued, 1);
});
