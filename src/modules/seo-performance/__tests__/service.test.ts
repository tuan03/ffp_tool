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

test("dashboard sends all filters in a store-scoped POST and keeps mock results independent", async () => {
  const filters = { startDate: "2025-12-05", endDate: "2026-01-01", country: "usa", device: "MOBILE" as const, query: "blanket", page: "/products/" };
  let request: RequestInit | undefined;
  let requestedUrl = "";
  const client = createSeoPerformanceClient(async (url, options) => { request = options; requestedUrl = String(url); return Response.json({ status: "pending" }); });
  await client.report("demo", filters, { dimension: "country", offset: 50 });
  assert.match(requestedUrl, /report\?storeId=demo/);
  assert.equal(request?.method, "POST");
  assert.deepEqual(JSON.parse(String(request?.body)), { filters, view: { dimension: "country", offset: 50 } });
  const mock = getSeoPerformanceClient("mock");
  const first = await mock.report("demo", filters);
  const second = await mock.report("demo", filters);
  assert.notEqual(first.rows.items[0], second.rows.items[0]);
  assert.equal(first.previousEnd, "2025-12-04");
  assert.equal((await mock.report("demo", { ...filters, country: "vnm" })).current, null);
});
