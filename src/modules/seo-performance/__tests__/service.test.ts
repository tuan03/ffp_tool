import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPerformanceClient, getSeoPerformanceClient } from "../index";

test("Performance real client scopes requests, sends CSRF marker and never falls back to mocks", async () => {
  const calls: { url: string; options?: RequestInit }[] = [];
  const client = createSeoPerformanceClient(async (input, options) => {
    calls.push({ url: String(input), options });
    return new Response(JSON.stringify({ error: { message: "Unavailable" } }), { status: 503, headers: { "Content-Type": "application/json" } });
  });
  await assert.rejects(client.pages("sample-store", { offset: 50, kind: "product" }), /Unavailable/);
  assert.match(calls[0].url, /storeId=sample-store.*offset=50.*kind=product/);
  await assert.rejects(client.start("sample-store", "crawl"), /Unavailable/);
  assert.equal(new Headers(calls[1].options?.headers).get("X-FFP-Performance"), "1");
});
test("Performance mock returns fresh fixtures and filters before pagination", async () => {
  const client = getSeoPerformanceClient("mock");
  assert.equal((await client.pages("demo", { kind: "blog" })).total, 0);
  assert.equal((await client.pages("demo", { offset: 50 })).items.length, 0);
  const first = await client.pages("demo");
  const second = await client.pages("demo");
  assert.notEqual(first.items[0], second.items[0]);
  assert.equal(first.total, 1);
});
test("Performance client handles HTML proxy responses without a JSON syntax error", async () => {
  const client = createSeoPerformanceClient(async () => new Response("<html>Login</html>", { headers: { "Content-Type": "text/html" } }));
  await assert.rejects(client.overview("demo"), /Gateway/);
});
