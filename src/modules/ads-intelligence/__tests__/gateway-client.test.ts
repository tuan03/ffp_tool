import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createAdsIntelligenceClient } from "../service";
import { AdsHeader } from "../ui/components/AdsHeader";

test("Gateway store discovery and Shopify reports work without Meta configuration", async context => {
  context.mock.method(globalThis, "fetch", async (url: string) => {
    if (url.endsWith("/stores")) return Response.json([{ storeId: "new-store", shopDomain: "new-store.myshopify.com", hasProxy: true }]);
    if (url.includes("/shopify?storeId=new-store")) return Response.json({ totalOrders: 0, status: "CONNECTED" });
    return Response.json({error:{code:"META_NOT_CONFIGURED"}},{status:503});
  });
  const client = createAdsIntelligenceClient();
  assert.ok(client.getStores); assert.ok(client.getShopifySummary);
  assert.equal((await client.getStores())[0]?.storeId, "new-store");
  await assert.rejects(client.getStoreSummary("new-store"), /META_NOT_CONFIGURED/);
  assert.equal((await client.getShopifySummary("new-store")).totalOrders, 0);
});
test("store selector renders Gateway stores rather than hardcoded store options", () => {
  const html = renderToStaticMarkup(createElement(AdsHeader, {
    stores: [{ storeId: "new-store", shopDomain: "new-store.myshopify.com", hasProxy: true }], currentStoreId: "new-store", summary: null,
    syncing: false, syncMessage: null, onStoreChange() {}, onSync() {}, onOpenMcp() {},
  }));
  assert.match(html, /new-store.myshopify.com/);
  assert.doesNotMatch(html, /value="chillgen"|value="jeminise"|value="wrydeco"/);
});

test("KPI ribbon preserves zero eligible orders and does not invent a click-to-session rate", async () => {
  const { ExecutiveKpiRibbon } = await import("../ui/components/ExecutiveKpiRibbon");
  const html = renderToStaticMarkup(createElement(ExecutiveKpiRibbon, {
    summary: null, reconciliation: null,
    shopifySummary: { status: "CONNECTED", totalOrders: 0, grossSales: "0.00", totalRefunds: "0.00", netSales: "0.00", averageOrderValue: "0.00", currency: "USD", source: "Verified test source", periodStart: "2026-09-05", periodEnd: "2026-10-04" },
  }));
  assert.match(html, /0 đơn/);
  assert.match(html, /Không phải tỷ lệ rơi rụng/);
  assert.doesNotMatch(html, /0\.0%|MER \(Hiệu quả\)|Lãi ròng/);
});

test("missing competitor data renders unavailable without fake counts or provider claims", async () => {
  const { CompetitorsTab } = await import("../ui/tabs/CompetitorsTab");
  const html = renderToStaticMarkup(createElement(CompetitorsTab, { storeId: "new-store", client: createAdsIntelligenceClient(), competitorReport: null, onCreateBriefFromGap() {} }));
  assert.match(html, /Đối thủ đã xác minh/);
  for (const label of ["Tất cả định dạng", "VIDEO", "IMAGE", "CAROUSEL"]) assert.ok(html.includes(label));
  assert.ok(html.indexOf("Tất cả định dạng") < html.indexOf("Đối thủ đã xác minh"));
  assert.doesNotMatch(html, /210|0.0658|ScrapeCreators/);
});

test("research client requests the selected store independently of ad provider", async context => {
  context.mock.method(globalThis, "fetch", async (url: string) => {
    assert.equal(url, "/api/ads-intelligence/competitor-research?storeId=new-store");
    return Response.json({ research: null });
  });
  const client = createAdsIntelligenceClient();
  assert.ok(client.getCompetitorResearch);
  assert.deepEqual(await client.getCompetitorResearch("new-store"), { research: null });
});

test("ad media preserves playable video, images and carousel rather than replacing them with research text", async () => {
  const { CompetitorAdMedia } = await import("../ui/components/CompetitorAdMedia");
  const base = { pageName: "Synthetic test brand", headline: "Test blanket", archiveAdId: "123456", thumbnailUrl: "https://example.com/preview.jpg", mediaUrls: ["https://example.com/clip.mp4"] };
  const video = renderToStaticMarkup(createElement(CompetitorAdMedia, { ad: { ...base, mediaType: "VIDEO" } }));
  assert.match(video, /<video/);
  assert.match(video, /controls=""/);
  assert.match(video, /clip.mp4/);
  assert.doesNotMatch(video, /autoPlay/);
  const image = renderToStaticMarkup(createElement(CompetitorAdMedia, { ad: { ...base, mediaType: "IMAGE", mediaUrls: [] } }));
  assert.match(image, /<img/);
  assert.match(image, /preview.jpg/);
  const carousel = renderToStaticMarkup(createElement(CompetitorAdMedia, { ad: { ...base, mediaType: "CAROUSEL", cards: [{ mediaUrl: "https://example.com/one.jpg" }, { mediaUrl: "https://example.com/two.jpg" }] } }));
  assert.match(carousel, /one.jpg/); assert.match(carousel, /two.jpg/);
  const missing = renderToStaticMarkup(createElement(CompetitorAdMedia, { ad: { ...base, mediaType: "VIDEO", thumbnailUrl: "", mediaUrls: [] } }));
  assert.match(missing, /Nguồn chưa cung cấp/);
  assert.match(missing, /facebook.com\/ads\/library/);
});

test("Spy start and cancellation carry the selected store, runner and model", async context => {
  const requests: { url: string; init?: RequestInit }[] = [];
  context.mock.method(globalThis, "fetch", async (url: string, init?: RequestInit) => { requests.push({ url, init }); return Response.json({ job: { id: "job-one" } }); });
  const client = createAdsIntelligenceClient();
  await client.startSpyJob?.({ storeId: "another-store", runner: "agy", model: "chosen-model" });
  await client.cancelSpyJob?.("another-store", "job-one");
  assert.equal(requests[0]?.url, "/api/ads-intelligence/spy/jobs?storeId=another-store");
  assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), { storeId: "another-store", runner: "agy", model: "chosen-model" });
  assert.equal(requests[1]?.url, "/api/ads-intelligence/spy/jobs/job-one/cancel?storeId=another-store");
});
