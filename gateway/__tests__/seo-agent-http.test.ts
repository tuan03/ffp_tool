import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";

import { handleSeoAgentHttp } from "../seo-worker/admin-handler";

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
