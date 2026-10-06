import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FunnelTab } from "../ui/tabs/FunnelTab";

test("funnel retains six indicators and analysis column when sources are unavailable", () => {
  const html = renderToStaticMarkup(createElement(FunnelTab, { summary: null, reconciliation: null }));
  assert.match(html, /Độ chênh lệch &amp; Phân tích/);
  for (const label of ["Link Clicks", "Sessions", "Landing Page Views", "Add To Cart", "Checkouts", "Purchases"]) assert.ok(html.includes(label));
  assert.match(html, /Chưa có dữ liệu/);
  assert.doesNotMatch(html, /108\.97|533\.50|970|Lãi ròng|Attribution lag/);
});

test("restored funnel preserves reported zeros instead of sample fallback values", async () => {
  const { mockChillgenSummary } = await import("../mocks/data");
  const summary = { ...mockChillgenSummary, linkClicks: "0", lpv: "0", atc: "0", checkout: "0", purchases: "0", spend: "0.00", purchaseValue: "0", cpa: null, roas: null };
  const html = renderToStaticMarkup(createElement(FunnelTab, { summary, reconciliation: null }));
  assert.match(html, /0 Link Clicks/);
  assert.match(html, /Không tính được \(0 purchases\)/);
  assert.doesNotMatch(html, /108\.97|533\.50|970/);
});
