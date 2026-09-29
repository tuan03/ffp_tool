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

test("image-content Action returns the public HTTPS product image URL for the owning store", async () => {
  const db = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(db);
  const handler = createCustomGptHandler({
    queue,
    actionKeys: { capozen: "capozen-key", wrydeco: "wrydeco-key" },
    storeId: "capozen",
    adminKey: "admin-key",
  });
  const imageUrl = "https://chillgen.com/cdn/shop/files/product.jpg?v=1784524386&width=480";
  const job = queue.enqueue({
    storeId: "capozen",
    source: "auto_seo",
    sourceIdentity: "product-image-content",
    input: {
      title: "Product",
      description: "Description",
      handle: "product",
      niche: "home",
      images: [{ id: "front", url: imageUrl }],
    },
    original: {},
  });
  const server = http.createServer((req, res) => { void handler(req, res); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const endpoint = `http://127.0.0.1:${address.port}/api/v1/gpt-seo/image-content?jobId=${job.id}&imageId=front`;

  try {
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { headers: { Authorization: "Bearer wrydeco-key" } })).status, 404);
    const response = await fetch(endpoint, { headers: { Authorization: "Bearer capozen-key" } });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /^application\/json/);
    assert.deepEqual(await response.json(), {
      imageId: "front",
      imageUrl,
      instructions: "Use imageUrl as the public image URL. Do not use imageId as a URL.",
    });
  } finally {
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
