import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { createAmazonCrawlerJobController, getAmazonCrawlerJobController } from "..";
import { crawlerMockMetrics } from "../mocks/observability";
import { CrawlerMetricsView } from "../ui/components/CrawlerObservability";

test("metrics use a separate small endpoint and traces preserve pagination", async () => {
  const urls: string[] = [];
  const controller = createAmazonCrawlerJobController({ engineUrl: "http://coordinator.test", fetchImplementation: async (url) => {
    urls.push(String(url));
    return new Response(JSON.stringify(String(url).includes("crawler-metrics") ? crawlerMockMetrics : { events: [], nextCursor: "next" }), { status: 200 });
  } });
  assert.ok(controller.metrics);
  assert.ok(controller.trace);
  const metrics = await controller.metrics("job/id");
  assert.equal(metrics.counts.familyCacheHits, crawlerMockMetrics.counts.familyCacheHits);
  const trace = await controller.trace("job/id", "request/id", "cursor/value");
  assert.equal(trace.nextCursor, "next");
  assert.match(urls[0] ?? "", /crawler-metrics\?jobId=job%2Fid$/);
  assert.match(urls[1] ?? "", /job%2Fid\/traces\/request%2Fid\?cursor=cursor%2Fvalue$/);
  assert.ok(urls.every((url) => !url.includes("/results")));
});

test("mock metrics return fresh copies of nested counters and agents", async () => {
  const controller = getAmazonCrawlerJobController("mock", "http://unused.test");
  assert.ok(controller.metrics);
  const first = await controller.metrics();
  first.counts.familyCacheHits = 999;
  first.agents.length = 0;
  const second = await controller.metrics();
  assert.notEqual(second.counts.familyCacheHits, 999);
  assert.ok(second.agents.length > 0);
});

test("dashboard shows metrics and reports missing memory instead of zero", () => {
  const metrics = structuredClone(crawlerMockMetrics);
  metrics.agents = [{ agentId: "agent", displayName: "Test agent", cache: {}, resources: { isComplete: false }, backlog: 0, dropped: 2 }];
  const html = renderToStaticMarkup(createElement(CrawlerMetricsView, { metrics }));
  for (const label of ["Cache hit", "HTTP thành công", "Playwright fallback", "CAPTCHA", "Retry", "Partial family", "Parser lỗi", "Hàng đợi crawl"])
    assert.ok(html.includes(label), label);
  assert.match(html, /Chưa đo RAM/);
  assert.match(html, /2 sự kiện telemetry bị bỏ/);
});

test("service rejects malformed metric responses", async () => {
  const controller = createAmazonCrawlerJobController({ engineUrl: "http://coordinator.test", fetchImplementation: async () => new Response(JSON.stringify({ ...crawlerMockMetrics, rates: { ...crawlerMockMetrics.rates, cacheHit: "invalid" } })) });
  assert.ok(controller.metrics);
  await assert.rejects(controller.metrics(), /invalid.*metrics/i);
});
