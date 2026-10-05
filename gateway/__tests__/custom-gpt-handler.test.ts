import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createCustomGptHandler } from "../custom-gpt-seo/handler";
import { createTestEnqueue } from "./seo-v2-fixtures";

test("Actions reject missing keys and cannot access administration or another store", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({ queue, actionKey: "action-key", storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/capabilities`)).status, 401);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/capabilities`, { headers: { Authorization: "Bearer action-key" } })).status, 200);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/admin/settings`, { headers: { Authorization: "Bearer action-key" } })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/queue?storeId=other`, { headers: { Authorization: "Bearer action-key" } })).status, 403);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test("Actions resolve independent stores from their Bearer keys", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const capozenContext = await fetch(`${base}/api/v1/gpt-seo/context`, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(capozenContext.status, 200);
    assert.equal((await capozenContext.json() as { storeId: string }).storeId, "capozen");

    const wrydecoContext = await fetch(`${base}/api/v1/gpt-seo/context`, { headers: { Authorization: "Bearer wrydeco-key" } });
    assert.equal(wrydecoContext.status, 200);
    assert.equal((await wrydecoContext.json() as { storeId: string }).storeId, "wrydeco");

    assert.equal((await fetch(`${base}/api/v1/gpt-seo/queue?storeId=wrydeco`, { headers: { Authorization: "Bearer capozen-key" } })).status, 403);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/queue`, { headers: { Authorization: "Bearer unknown-key" } })).status, 401);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/admin/settings?storeId=wrydeco`, { headers: { Authorization: "Bearer admin-key" } })).status, 200);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test("Actions reject an Action key that duplicates the administration key", () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  try {
    assert.throws(
      () => createCustomGptHandler({ queue, actionKeys: { capozen: "shared-key" }, storeId: "capozen", adminKey: "shared-key" }),
      /must differ from the administration key/,
    );
  } finally { db.close(); }
});

test("administration lists every active batch for the selected store", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const settings = queue.configure("capozen", { provider: "codex_mcp", batchSize: 1 });
  for (const sourceIdentity of ["office-product", "laptop-product"]) {
    queue.enqueue(createTestEnqueue({ storeId: "capozen", sourceIdentity, input: { niche: "home", images: [] }, settings }));
  }
  const officeBatch = queue.claim("capozen", "office-claim", "codex_mcp", "codex_mcp:office-pc");
  const laptopBatch = queue.claim("capozen", "laptop-claim", "codex_mcp", "codex_mcp:laptop");
  const handler = createCustomGptHandler({ queue, storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin/jobs?storeId=capozen`, {
      headers: { Authorization: "Bearer admin-key" },
    });
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      activeBatch: { readonly id: string } | null;
      activeBatches: readonly { readonly id: string; readonly ownerId: string }[];
    };
    assert.equal(payload.activeBatch?.id, officeBatch.id);
    assert.deepEqual(payload.activeBatches.map(batch => [batch.id, batch.ownerId]), [
      [officeBatch.id, "codex_mcp:office-pc"],
      [laptopBatch.id, "codex_mcp:laptop"],
    ]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("administration filters queue status before pagination", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  for (let index = 0; index < 51; index += 1) {
    const job = queue.enqueue(createTestEnqueue({ storeId: "jeminise-real", sourceIdentity: `product-${index}`,
      input: { niche: "home", images: [] }, settings: { provider: "codex_mcp", batchSize: 10, version: 1, language: "en-US", instructions: "Grounded facts only." } }));
    if (index < 50) {
      db.prepare("UPDATE gpt_jobs SET status='REVIEW_READY',payload=json_set(payload,'$.status','REVIEW_READY') WHERE id=?").run(job.id);
    }
  }

  const handler = createCustomGptHandler({ queue, storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin/jobs?storeId=jeminise-real&statuses=PENDING&provider=codex_mcp&offset=0`,
      { headers: { Authorization: "Bearer admin-key" } },
    );
    assert.equal(response.status, 200);
    const payload = await response.json() as {
      readonly jobs: readonly { readonly status: string }[];
      readonly nextOffset: number | null;
    };
    assert.equal(payload.jobs.length, 1);
    assert.equal(payload.jobs[0]?.status, "PENDING");
    assert.equal(payload.nextOffset, null);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("administration lists complete review records and saves review states in bulk", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  queue.configure("jeminise-real", { provider: "custom_gpt", batchSize: 1 });
  const job = queue.enqueue(createTestEnqueue({ storeId: "jeminise-real", sourceIdentity: "review-product",
    input: { niche: "home", images: [] }, original: { id: "review-product" } }));
  const batch = queue.claim("jeminise-real", "review-claim", "custom_gpt", "custom_gpt");
  queue.checkpoint("jeminise-real", job.id, {
    batchId: batch.id,
    leaseToken: batch.leaseToken,
    requestId: "review-submit",
    stage: "submission",
    payload: {},
  });
  queue.finish("jeminise-real", job.id, { output: { productTitle: "Optimized product" } });

  const handler = createCustomGptHandler({ queue, storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin`;

  try {
    const listResponse = await fetch(`${base}/reviews?storeId=jeminise-real&offset=0`, {
      headers: { Authorization: "Bearer admin-key" },
    });
    assert.equal(listResponse.status, 200);
    const firstPage = await listResponse.json() as {
      readonly reviews: readonly { readonly job: { readonly id: string }; readonly state: Readonly<Record<string, unknown>> }[];
      readonly nextOffset: number | null;
    };
    assert.equal(firstPage.reviews[0]?.job.id, job.id);
    assert.deepEqual(firstPage.reviews[0]?.state, {});
    assert.equal(firstPage.nextOffset, null);

    const saveResponse = await fetch(`${base}/review-states?storeId=jeminise-real`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-key", "Content-Type": "application/json" },
      body: JSON.stringify({ reviews: [{ jobId: job.id, state: { reviewDecision: "approved" } }] }),
    });
    assert.equal(saveResponse.status, 200);
    assert.deepEqual(await saveResponse.json(), { saved: 1 });
    assert.deepEqual(queue.reviewState("jeminise-real", job.id), { reviewDecision: "approved" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("waiting-jobs lists read-only identifiers for the authenticated store without claiming work", async () => {
  const db = new DatabaseSync(":memory:");
  let currentTime = 0;
  const queue = new CustomGptQueue(db, () => ++currentTime);
  queue.configure("capozen", { provider: "custom_gpt", batchSize: 2 });
  const firstJob = queue.enqueue(createTestEnqueue({ storeId: "capozen", sourceIdentity: "waiting-product-1", productId: "101",
    input: { niche: "home",
      images: [
        { id: "front", url: "https://cdn.shopify.com/front.jpg" },
        { id: "detail", url: "https://cdn.shopify.com/detail.jpg" },
      ],
    }, original: {} }));
  const secondJob = queue.enqueue(createTestEnqueue({ storeId: "capozen", source: "amazon", sourceIdentity: "WAITINGPRODUCT2",
    input: { niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/second.jpg" }],
    }, original: {} }));
  const batch = queue.claim("capozen", "claim-waiting-products", "custom_gpt", "custom_gpt");
  queue.issue("capozen", firstJob.id, batch.id, batch.leaseToken, "Attach clearer product images");
  queue.issue("capozen", secondJob.id, batch.id, batch.leaseToken, "Confirm visible product text");
  queue.release("capozen", batch.id, batch.leaseToken);

  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/waiting-jobs`;

  try {
    assert.equal((await fetch(endpoint)).status, 401);
    const queueResponse = await fetch(`http://127.0.0.1:${address.port}/api/v1/gpt-seo/queue`, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal((await queueResponse.json() as { nextAction: string }).nextAction, "listSeoWaitingJobs");
    const response = await fetch(endpoint, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      jobs: [
        {
          jobId: firstJob.id,
          status: "WAITING_INPUT",
          imageCount: 2,
          issue: "Attach clearer product images",
        },
        {
          jobId: secondJob.id,
          status: "WAITING_INPUT",
          imageCount: 1,
          issue: "Confirm visible product text",
        },
      ],
      nextOffset: null,
      instructions: "Use jobId with getSeoJob and getSeoJobImages. This read-only action does not claim jobs or change their status.",
    });
    assert.equal(queue.activeBatch("capozen", "custom_gpt"), null);
    assert.equal(queue.get("capozen", firstJob.id).status, "WAITING_INPUT");
    assert.equal(queue.get("capozen", secondJob.id).status, "WAITING_INPUT");
    const otherStoreResponse = await fetch(endpoint, { headers: { Authorization: "Bearer wrydeco-key" } });
    assert.deepEqual(await otherStoreResponse.json(), {
      jobs: [],
      nextOffset: null,
      instructions: "Use jobId with getSeoJob and getSeoJobImages. This read-only action does not claim jobs or change their status.",
    });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("image listings return the original public image URL without signing it", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
    publicUrl: "https://seo.example.test",
  });
  const job = queue.enqueue(createTestEnqueue({ storeId: "capozen", sourceIdentity: "product-1",
    input: { niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }],
    }, original: {} }));
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${base}/api/v1/gpt-seo/images?jobId=${job.id}`, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 200);
    const payload = await response.json() as { images: readonly { id: string }[] };
    assert.deepEqual(payload.images, [{ id: "front" }]);
    assert.equal((await fetch(`${base}/api/v1/gpt-seo/images?jobId=${job.id}`, { headers: { Authorization: "Bearer wrydeco-key" } })).status, 404);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test("image-content is no longer exposed after image listings return original URLs", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
    publicUrl: "https://ffp.example.test",
  });
  const job = queue.enqueue(createTestEnqueue({ storeId: "capozen", sourceIdentity: "product-image-content",
    input: { niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/s/files/1/2/files/product.jpg?v=1784524386" }],
    }, original: {} }));
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/image-content?jobId=${job.id}&imageId=front`;
  try {
    const response = await fetch(endpoint, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 405);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("administration can cancel a ready review without deleting its audit data", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  queue.configure("capozen", { provider: "custom_gpt", batchSize: 5 });
  const job = queue.enqueue(createTestEnqueue({ storeId: "capozen", sourceIdentity: "cancel-through-api", input: { niche: "home", images: [] }, original: {} }));
  const batch = queue.claim("capozen", "cancel-api-claim", "custom_gpt", "custom_gpt");
  queue.checkpoint("capozen", job.id, {
    batchId: batch.id,
    leaseToken: batch.leaseToken,
    requestId: "cancel-api-submit",
    stage: "submission",
    payload: { title: "SEO title" },
  });
  queue.finish("capozen", job.id, { title: "Final title" });
  const handler = createCustomGptHandler({ queue, actionKey: "action-key", storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin/cancel?storeId=capozen`,
      {
        method: "POST",
        headers: { Authorization: "Bearer admin-key", "Content-Type": "application/json" },
        body: JSON.stringify({ jobId: job.id }),
      },
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cancelled: true });
    assert.equal(queue.get("capozen", job.id).status, "CANCELLED");
    assert.deepEqual(queue.get("capozen", job.id).result, { title: "Final title" });
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("administration clears only safe jobs in the selected store", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  queue.enqueue(createTestEnqueue({
    storeId: "capozen",
    sourceIdentity: "clear-api",
    input: { niche: "home", images: [] },
    original: {},
  }));
  queue.enqueue(createTestEnqueue({
    storeId: "other",
    sourceIdentity: "keep-other",
    input: { niche: "home", images: [] },
    original: {},
  }));
  const handler = createCustomGptHandler({ queue, storeId: "capozen", adminKey: "admin-key" });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/gpt-seo/admin/clear?storeId=capozen`, {
      method: "POST",
      headers: { Authorization: "Bearer admin-key", "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { cleared: 1, preservedActive: 0, preservedSynced: 0 });
    assert.equal(queue.list("capozen").length, 0);
    assert.equal(queue.list("other").length, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
