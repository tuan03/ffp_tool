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
  const html = renderToStaticMarkup(createElement(CompetitorsTab, { competitorReport: null, onCreateBriefFromGap() {} }));
  assert.match(html, /Chưa có dữ liệu đối thủ xác minh/);
  assert.doesNotMatch(html, /210|0.0658|ScrapeCreators/);
});
