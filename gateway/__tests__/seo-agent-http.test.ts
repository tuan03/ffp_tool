import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { handleSeoAgentHttp } from "../seo-worker/admin-handler";

test("review history requires operator access and validates pagination before reading", async () => {
  let calls = 0;
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "admin" : undefined,
    hasStore: storeId => storeId === "demo", repository: async () => { throw new Error("unused"); },
    history: async (storeId, jobId, offset) => { calls++; assert.equal(storeId, "demo"); assert.equal(jobId, "job"); assert.equal(offset, 50); return { total: 0, nextOffset: null, entries: [] }; },
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/review-history?storeId=demo&jobId=job&offset=50`;
    assert.equal((await fetch(url)).status, 401);
    const headers = { authorization: "Basic test" };
    assert.equal((await fetch(url.replace("offset=50", "offset=-1"), { headers })).status, 400);
    assert.equal((await fetch(url.replace("storeId=demo", "storeId=other"), { headers })).status, 404);
    const response = await fetch(url, { headers });
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(calls, 1);
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("revision endpoint requires operator/CSRF and rejects client-supplied store or provider", async () => {
  let calls = 0;
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "admin" : undefined,
    hasStore: storeId => storeId === "demo", repository: async () => { throw new Error("unused"); },
    createRevision: async input => { calls++; assert.equal(input.storeId, "demo"); assert.equal(input.operator, "admin"); return { jobId: "new", previousJobId: input.jobId }; },
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/revisions?storeId=demo`;
    const input = { jobId: "old", requestId: "7a9eb972-2a47-4f59-8cb0-aa735c80ea20" };
    const headers = { authorization: "Basic test", "x-ffp-agent": "1", "content-type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", body: "{}" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: "Basic test" }, body: "{}" })).status, 403);
    for (const extra of [{ storeId: "other" }, { provider: "gemini" }]) assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...input, ...extra }) })).status, 400);
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify(input) });
    assert.equal(response.status, 201);
    assert.deepEqual(await response.json(), { jobId: "new", previousJobId: "old" });
    assert.equal(calls, 1);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("Agent Access rejects non-operator, CSRF, cross-site and invalid store requests", async () => {
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "admin" : undefined,
    hasStore: storeId => storeId === "demo",
    repository: () => { throw new Error("postgresql://private-secret"); },
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/tokens?storeId=demo`;
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { authorization: "Basic test" } })).status, 403);
    const headers = { authorization: "Basic test", "x-ffp-agent": "1", "content-type": "application/json" };
    assert.equal((await fetch(url, { method: "POST", headers: { ...headers, "sec-fetch-site": "cross-site" }, body: "{}" })).status, 403);
    assert.equal((await fetch(url.replace("demo", "unknown"), { headers })).status, 404);
    const failed = await fetch(url, { headers });
    assert.equal(failed.status, 503);
    assert.equal(failed.headers.get("cache-control"), "no-store");
    assert.equal((await failed.text()).includes("private-secret"), false);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("publish routes require an operator and a configured publisher", async () => {
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: req.headers.authorization === "Basic test" ? "admin" : undefined,
    hasStore: () => true, repository: async () => { throw new Error("must not read worker tokens"); },
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/publish?storeId=demo`;
    assert.equal((await fetch(url)).status, 401);
    const response = await fetch(url, { method: "POST", headers: { authorization: "Basic test", "x-ffp-agent": "1", "content-type": "application/json" }, body: "{}" });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: { code: "PUBLISH_DISABLED" } });
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test("publish returns a safe asynchronous receipt and derives operator/store server-side", async () => {
  let submissions = 0;
  const operation = { id: "receipt", jobId: "job", storeId: "demo", productId: "123", state: "QUEUED", sourceVersion: "v1", leaseId: "private-lease", seoVersion: null, errorCode: null, fields: { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" } } };
  const server = http.createServer((req, res) => { void handleSeoAgentHttp(req, res, {
    operator: "operator", hasStore: storeId => storeId === "demo", repository: async () => { throw new Error("not used"); },
    publisher: async () => ({ requestReconciliation: async () => operation, status: async () => ({ managed: true, operation }), enqueue: async input => {
      assert.deepEqual(input, { storeId: "demo", operator: "operator", jobId: "job", requestId: "sync", reviewUpdatedAt: 1 });
      submissions++; return operation;
    } }),
  }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-agent/publish?storeId=demo`;
    const headers = { "x-ffp-agent": "1", "content-type": "application/json" };
    const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ jobId: "job", requestId: "sync", reviewUpdatedAt: 1 }) });
    assert.equal(response.status, 202);
    const receipt = await response.json();
    assert.deepEqual(receipt, { id: "receipt", jobId: "job", state: "QUEUED", errorCode: null, seoVersion: null });
    assert.equal((await fetch(url, { method: "POST", headers, body: JSON.stringify({ jobId: "job", requestId: "sync", reviewUpdatedAt: 1, force: true }) })).status, 400);
    assert.equal(submissions, 1);
    assert.equal((await fetch(`${url}&jobId=job`)).status, 200);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
