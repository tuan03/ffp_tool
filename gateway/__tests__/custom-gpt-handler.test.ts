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
