import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

import { handlePerformanceHttp } from "../seo-performance/http-handler";
import { CustomGptQueue } from "../custom-gpt-seo/queue";

import { createTestEnqueue } from "./seo-v2-fixtures";

test("SEO Performance HTTP requires admin authentication, custom mutation header and enabled runtime", async () => {
  const server = http.createServer((req, res) => { void handlePerformanceHttp(req, res, { authToken: "test-admin", hasStore: () => true }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/seo-performance/oauth/start`;
    assert.equal((await fetch(url, { method: "POST" })).status, 401);
    assert.equal((await fetch(url, { method: "POST", headers: { "x-gateway-key": "test-admin" } })).status, 403);
    const disabled = await fetch(url, { method: "POST", headers: { "x-gateway-key": "test-admin", "x-ffp-performance": "1" } });
    assert.equal(disabled.status, 503);
    assert.match(await disabled.text(), /SEO_PERFORMANCE_DISABLED/);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
test("Performance revision preserves old review and still prevents syncing the superseded revision", () => {
  const database = new DatabaseSync(":memory:");
  const queue = new CustomGptQueue(database, () => 1000);
  try {
    const input = createTestEnqueue({ storeId: "demo", productId: "123", original: { updatedAt: "2026-01-01" }, input: { images: [{ id: "front", url: "https://cdn.shopify.com/front.png" }], niche: "Blankets" } });
    const old = queue.enqueue(input);
    const ready = { ...old, status: "REVIEW_READY", result: { output: { productTitle: "Old draft" } } };
    database.prepare("UPDATE gpt_jobs SET status='REVIEW_READY',payload=? WHERE id=?").run(JSON.stringify(ready), old.id);
    const revisionInput = createTestEnqueue({ storeId: "demo", productId: "123", sourceRevision: "performance:proposal", performanceRecommendationId: "proposal", original: { updatedAt: "2026-01-01" }, input: input.input });
    const revision = queue.enqueue(revisionInput);
    assert.notEqual(revision.id, old.id);
    assert.equal(queue.get("demo", old.id).status, "REVIEW_READY");
    assert.deepEqual(queue.get("demo", old.id).result, ready.result);
    assert.throws(() => queue.beginSync("demo", old.id), /newer source revision/);
    assert.equal(queue.enqueue(revisionInput).id, revision.id);
  } finally { database.close(); }
});
