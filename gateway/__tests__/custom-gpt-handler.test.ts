import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";
import { DatabaseSync } from "node:sqlite";
import { CustomGptQueue } from "../custom-gpt-seo/queue";
import { createCustomGptHandler } from "../custom-gpt-seo/handler";

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

test("waiting-jobs lists read-only identifiers for the authenticated store without claiming work", async () => {
  const db = new DatabaseSync(":memory:");
  let currentTime = 0;
  const queue = new CustomGptQueue(db, () => ++currentTime);
  queue.configure("capozen", { provider: "custom_gpt", batchSize: 2 });
  const firstJob = queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "waiting-product-1",
    input: {
      productId: "101",
      title: "First waiting product",
      description: "Description",
      handle: "first-waiting-product",
      niche: "home",
      images: [
        { id: "front", url: "https://cdn.shopify.com/front.jpg" },
        { id: "detail", url: "https://cdn.shopify.com/detail.jpg" },
      ],
    },
    original: {},
  });
  const secondJob = queue.enqueue({
    storeId: "capozen",
    source: "amazon",
    sourceIdentity: "WAITINGPRODUCT2",
    input: {
      title: "Second waiting product",
      description: "Description",
      handle: "second-waiting-product",
      niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/second.jpg" }],
    },
    original: {},
  });
  const batch = queue.claim("capozen", "claim-waiting-products");
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
          source: "auto_seo",
          productId: "101",
          title: "First waiting product",
          handle: "first-waiting-product",
          status: "WAITING_INPUT",
          imageCount: 2,
          issue: "Attach clearer product images",
        },
        {
          jobId: secondJob.id,
          source: "amazon",
          title: "Second waiting product",
          handle: "second-waiting-product",
          status: "WAITING_INPUT",
          imageCount: 1,
          issue: "Confirm visible product text",
        },
      ],
      nextOffset: null,
      instructions: "Use jobId with getSeoJob and getSeoJobImages. This read-only action does not claim jobs or change their status.",
    });
    assert.equal(queue.activeBatch("capozen"), null);
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

test("signed image URLs remain scoped to the authenticated store", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
    publicUrl: "https://seo.example.test",
  });
  const job = queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "product-1",
    input: {
      title: "Product",
      description: "Description",
      handle: "product",
      niche: "home",
      images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }],
    },
    original: {},
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;

  try {
    const response = await fetch(`${base}/api/v1/gpt-seo/images?jobId=${job.id}`, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 200);
    const payload = await response.json() as { images: readonly { url: string }[] };
    const signedUrl = new URL(payload.images[0].url);
    assert.equal(signedUrl.searchParams.get("storeId"), "capozen");
    signedUrl.searchParams.set("storeId", "wrydeco");
    signedUrl.host = `127.0.0.1:${address.port}`;
    signedUrl.protocol = "http:";
    assert.equal((await fetch(signedUrl)).status, 401);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); db.close(); }
});

test("image-content returns an FFP-hosted URL that serves only the stored image without authentication", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
    publicUrl: "https://ffp.example.test",
  });
  const sourceImageUrl = "https://cdn.shopify.com/s/files/1/2/files/product.jpg?v=1784524386";
  const job = queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "product-image-content",
    input: {
      title: "Product",
      description: "Description",
      handle: "product",
      niche: "home",
      images: [{ id: "front", url: sourceImageUrl }],
    },
    original: {},
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/image-content?jobId=${job.id}&imageId=front`;
  const originalFetch = globalThis.fetch;

  try {
    assert.equal((await originalFetch(endpoint)).status, 401);
    assert.equal((await originalFetch(endpoint, { headers: { Authorization: "Bearer wrydeco-key" } })).status, 404);
    const response = await originalFetch(endpoint, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^application\/json/);
    const payload = await response.json() as { imageId: string; imageUrl: string; instructions: string };
    const publicImageUrl = new URL(payload.imageUrl);
    assert.equal(payload.imageId, "front");
    assert.equal(publicImageUrl.origin, "https://ffp.example.test");
    assert.equal(publicImageUrl.pathname, "/api/v1/gpt-seo/public-image");
    assert.deepEqual(Object.fromEntries(publicImageUrl.searchParams), {
      storeId: "capozen",
      jobId: job.id,
      imageId: "front",
    });
    assert.equal(payload.instructions, "Open imageUrl to inspect the image. Do not use imageId as a URL.");

    let downloadCount = 0;
    globalThis.fetch = async (input, init) => {
      const requestedUrl = input instanceof Request ? input.url : String(input);
      assert.equal(requestedUrl, sourceImageUrl);
      assert.equal(init?.redirect, "manual");
      downloadCount += 1;
      return new Response(Buffer.from("stored-image"), {
        status: 200,
        headers: { "Content-Type": "image/jpeg", "Content-Length": "12" },
      });
    };
    publicImageUrl.protocol = "http:";
    publicImageUrl.host = `127.0.0.1:${address.port}`;
    const imageResponse = await originalFetch(publicImageUrl);
    assert.equal(imageResponse.status, 200);
    assert.equal(imageResponse.headers.get("content-type"), "image/jpeg");
    assert.equal(imageResponse.headers.get("cache-control"), "public, max-age=300");
    assert.equal(await imageResponse.text(), "stored-image");
    assert.equal(downloadCount, 1);

    publicImageUrl.searchParams.set("imageId", "not-in-job");
    assert.equal((await originalFetch(publicImageUrl)).status, 404);
    assert.equal(downloadCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});

test("image-content Action rejects a non-HTTPS source URL", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key" },
    storeId: "capozen",
    adminKey: "admin-key",
  });
  const job = queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "product-http-image",
    input: {
      title: "Product",
      description: "Description",
      handle: "product",
      niche: "home",
      images: [{ id: "front", url: "http://cdn.example.org/front.jpg" }],
    },
    original: {},
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/gpt-seo/image-content?jobId=${job.id}&imageId=front`, {
      headers: { Authorization: "Bearer capozen-key" },
    });
    assert.equal(response.status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    db.close();
  }
});
