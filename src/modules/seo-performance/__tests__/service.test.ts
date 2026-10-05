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

test("benchmark mock runner returns items with 11-column metrics, summary KPIs and handles filters", async () => {
  const mock = getSeoPerformanceClient("mock");
  const allRes = await mock.benchmark("jeminise", {});
  assert.equal(allRes.items.length, 7);
  assert.equal(allRes.total, 7);
  assert.equal(allRes.kpis.totalManaged, 7);
  assert.equal(allRes.kpis.eligibleCount, 3);

  // Filter v0
  const v0Res = await mock.benchmark("jeminise", { versionFilter: "v0" });
  assert.equal(v0Res.items.length, 1);
  assert.equal(v0Res.items[0].currentVersion, "v0");

  // Filter v1+
  const v1Res = await mock.benchmark("jeminise", { versionFilter: "v1+" });
  assert.equal(v1Res.items.length, 6);
  assert.ok(v1Res.items.every(p => p.currentVersion !== "v0"));

  // Status filter
  const impRes = await mock.benchmark("jeminise", { statusFilter: "IMPROVING" });
  assert.equal(impRes.items.length, 1);
  assert.equal(impRes.items[0].status.performanceStatus, "IMPROVING");

  // GSC Query filter marks GA4 organic sessions as N/A notice
  const queryRes = await mock.benchmark("jeminise", { query: "chan long cuu" });
  assert.equal(queryRes.items[0].organicSessions.isGscQueryFilterApplied, true);

  // Product detail
  const detail = await mock.productDetail("jeminise", "prod_01");
  assert.equal(detail.product.productId, "prod_01");
  assert.equal(detail.selectedVersionNumber, 2);
  assert.ok(detail.diffs.length >= 4);
  assert.ok(detail.queries.length >= 3);
  assert.equal(detail.ga4.landingSessions.current, 85);

  // Batch detail
  const batch = await mock.batchDetail("jeminise", "batch_2026_08_pilot");
  assert.equal(batch.batchId, "batch_2026_08_pilot");
  assert.equal(batch.totalProducts, 4);
  assert.equal(batch.statusDistribution.improving, 1);

  // Connections sync
  const conns = await mock.connectionsSync("jeminise");
  assert.equal(conns.gsc.status, "CONNECTED");
  assert.equal(conns.ga4.propertyId, "549055707");
  assert.ok(conns.gsc.grantedScopes.length > 0);

  // Backfill
  const backfill = await mock.backfill("jeminise", "gsc", 28);
  assert.ok(backfill.jobId.startsWith("job-backfill-gsc-28d-"));
});

test("real client dispatches benchmark requests with proper parameters", async () => {
  let requestedUrl = "";
  const client = createSeoPerformanceClient(async url => {
    requestedUrl = String(url);
    return new Response(JSON.stringify({ items: [], total: 0, kpis: {} }), {
      headers: { "Content-Type": "application/json" },
    });
  });

  await client.benchmark("jeminise", { versionFilter: "v1+", windowDays: 28, query: "wool" });
  assert.match(requestedUrl, /\/api\/seo-performance\/benchmark\/products\?/);
  assert.match(requestedUrl, /storeId=jeminise/);
  assert.match(requestedUrl, /versionFilter=v1%2B/);
  assert.match(requestedUrl, /windowDays=28/);
  assert.match(requestedUrl, /query=wool/);
});

