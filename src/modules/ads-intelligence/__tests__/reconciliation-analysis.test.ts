import assert from "node:assert/strict";
import test from "node:test";
import { describeReconciliation } from "../ui/reconciliation-analysis";
import { mockChillgenSummary } from "../mocks/data";
import type { AdsReconciliationReport } from "../types";

const summary = {...mockChillgenSummary, currency:"USD", spend:"325.28", linkClicks:"243", purchases:"0", purchaseValue:"0", cpa:null};
const report: AdsReconciliationReport = {
  storeId:"fixture",periodStart:"2024-08-06",periodEnd:"2026-10-05",
  meta:{spend:"325.28",impressions:"1000",linkClicks:"243",purchases:"0",purchaseValue:"0",cpa:null,roas:"0"},
  ga4:{status:"CONNECTED",sessions:586,ecommercePurchases:0,purchaseRevenue:0,clickToSessionDropPct:null,metaPaid:{status:"AVAILABLE",sessions:41,ecommercePurchases:0,purchaseRevenue:0,unverifiedMetaSessions:99,timezone:"America/Chicago",currency:"USD",warnings:[],scope:"fixture"}},
  shopify:{status:"CONNECTED",totalOrders:1,grossSales:"106.90",totalRefunds:"0.00",netSales:"106.90",averageOrderValue:"106.90",mer:"0.33",blendedCpa:"325.28",source:"fixture"},
  gaps:{purchaseDiscrepancy:-1,revenueDiscrepancy:"-106.90",clickDropPct:"N/A",notes:[]},
};

test("analysis renders quantitative differences without inventing attribution",()=>{
  const analysis=describeReconciliation(report,summary);
  assert.match(analysis.traffic,/243 clicks − 41 sessions = \+202/);
  assert.match(analysis.traffic,/16,87%/);
  assert.match(analysis.orders,/Shopify − Meta: \+1 đơn/);
  assert.match(analysis.revenue,/Shopify − Meta: USD 106.90/);
  assert.match(analysis.cpa,/325.28.*1 đơn.*325.28/);
  assert.match(analysis.ratio,/0,329×/);
  assert.match(analysis.cpa,/Meta có 0 purchases/);
});

test("analysis preserves unknowns, zero denominators and currency mismatch",()=>{
  const unknown=describeReconciliation(null,null);
  assert.doesNotMatch(Object.values(unknown).join(" "),/NaN|Infinity|0,00%/);
  const paid = report.ga4.metaPaid;
  assert.ok(paid);
  const changed={...report,meta:{...report.meta,linkClicks:"0",spend:"0"},ga4:{...report.ga4,metaPaid:{...paid,currency:"EUR"}}};
  const analysis=describeReconciliation(changed,summary);
  assert.match(analysis.traffic,/clicks = 0/);
  assert.match(analysis.ratio,/chi tiêu Meta bằng 0/);
  assert.match(analysis.revenue,/Chưa đủ giá trị cùng tiền tệ/);
  assert.doesNotMatch(analysis.revenue,/Shopify − GA4 Meta trả phí: USD/);
});


test("analysis column displays calculations without changing table structure",async()=>{
  const {createElement}=await import("react");
  const {renderToStaticMarkup}=await import("react-dom/server");
  const {FunnelTab}=await import("../ui/tabs/FunnelTab");
  const html=renderToStaticMarkup(createElement(FunnelTab,{summary,reconciliation:report}));
  assert.match(html,/16,87%/);
  assert.match(html,/Độ chênh lệch &amp; Phân tích/);
  assert.equal((html.match(/scope="col"/g)||[]).length,5);
});
