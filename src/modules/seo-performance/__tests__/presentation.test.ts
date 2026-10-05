import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBenchmarkCsvRows,
  formatPercent,
  formatPositionChange,
  formatPp,
  getStatusBadge,
  metricChange,
  presetPeriod,
  sanitizeHtmlContent,
} from "../ui/presentation";

test("date presets use inclusive days, including leap years", () => {
  assert.deepEqual(presetPeriod("2026-09-29", 28), { startDate: "2026-09-02", endDate: "2026-09-29" });
  assert.deepEqual(presetPeriod("2024-03-01", 3), { startDate: "2024-02-28", endDate: "2024-03-01" });
  assert.equal(presetPeriod("2026-09-29", 90).startDate, "2026-07-02");
});

test("metric changes treat lower position as improvement without dividing by zero", () => {
  assert.equal(metricChange("position", 8, 10).tone, "positive");
  assert.equal(metricChange("clicks", 8, 10).tone, "negative");
  assert.equal(metricChange("clicks", 8, 0).text.includes("Infinity"), false);
  assert.equal(metricChange("ctr", null, 0.1).tone, "neutral");
  assert.equal(metricChange("clicks", 10, 10).tone, "neutral");
});

test("formatPp formats percentage points with sign and 2 decimals", () => {
  assert.equal(formatPp(0.5), "+0.50 pp");
  assert.equal(formatPp(-0.35), "−0.35 pp");
  assert.equal(formatPp(0), "0.00 pp");
  assert.equal(formatPp(null), "—");
});

test("formatPercent formats percentages with sign and 1 decimal", () => {
  assert.equal(formatPercent(60), "+60.0%");
  assert.equal(formatPercent(-52), "−52.0%");
  assert.equal(formatPercent(0), "0.0%");
  assert.equal(formatPercent(null), "—");
});

test("formatPositionChange handles positive improvement and negative drops", () => {
  const imp = formatPositionChange(12.0, 9.0);
  assert.equal(imp.tone, "positive");
  assert.equal(imp.text, "12.0 → 9.0 · +3.0 bậc");

  const drop = formatPositionChange(15.0, 21.0);
  assert.equal(drop.tone, "negative");
  assert.equal(drop.text, "15.0 → 21.0 · −6.0 bậc");

  const stable = formatPositionChange(8.5, 8.5);
  assert.equal(stable.tone, "neutral");
  assert.match(stable.text, /ổn định/);

  assert.equal(formatPositionChange(null, null).text, "—");
});

test("getStatusBadge assigns correct styles and labels across status layers", () => {
  assert.equal(getStatusBadge("IMPROVING", "ELIGIBLE").label, "Đang cải thiện");
  assert.equal(getStatusBadge("DECLINING", "ELIGIBLE").label, "Suy giảm");
  assert.equal(getStatusBadge("NOT_EVALUATED", "BASELINE").label, "Baseline · v0");
  assert.equal(getStatusBadge("NOT_EVALUATED", "COLLECTING").label, "Đang thu thập");
  assert.equal(getStatusBadge("MIXED", "CONTENT_CHANGED").label, "External Changes");
  assert.equal(getStatusBadge("NOT_EVALUATED", "ELIGIBLE", ["NOINDEX"]).label, "Cần kiểm tra kỹ thuật");
});

test("sanitizeHtmlContent strips malicious tags and scripts while keeping safe formatting", () => {
  const dirty = '<p>Hello <script>alert("xss")</script><iframe src="evil.com"></iframe><b>World</b><a href="javascript:alert(1)">link</a></p>';
  const clean = sanitizeHtmlContent(dirty);
  assert.equal(clean.includes("<script"), false);
  assert.equal(clean.includes("<iframe"), false);
  assert.equal(clean.includes("javascript:"), false);
  assert.ok(clean.includes("Hello"));
  assert.ok(clean.includes("World"));
});

test("buildBenchmarkCsvRows masks organic sessions when GSC query filter is active (Rule 12.7)", () => {
  const sampleItem = {
    productId: "prod_01",
    shopifyProductGid: "gid://shopify/Product/1001",
    title: "Sample Product",
    url: "https://jeminise.com/products/sample",
    thumbnailUrl: "",
    currentVersion: "v1",
    versionSource: "AUTO_SEO" as const,
    promptVersion: "v2.1",
    batchId: "batch_1",
    publishedAt: "2026-08-01T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 30,
    targetDays: 28,
    coverageDays: 28,
    clicks: { after: 10, before: 5, deltaAbsolute: 5, deltaPercent: 100, isNewActivity: false },
    impressions: { after: 100, before: 50, deltaAbsolute: 50, deltaPercent: 100 },
    ctr: { after: 0.1, before: 0.1, deltaPercentagePoints: 0 },
    position: { after: 10, before: 12, improvement: 2 },
    queries: { afterCount: 5, beforeCount: 3, delta: 2, newlyObserved: 2, noLongerObserved: 0, matchedCount: 3 },
    organicSessions: { after: 20, before: 15, deltaAbsolute: 5, deltaPercent: 33.3, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH" as const,
      measurementStatus: "ELIGIBLE" as const,
      performanceStatus: "IMPROVING" as const,
      technicalFlags: [],
      label: "Improving",
      reason: "OK",
      rulesetVersion: "v1.0.0",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "VIEW" as const, label: "Xem", enabled: true },
  };

  // Normal case: sessions are numbers
  const normalResult = buildBenchmarkCsvRows([sampleItem]);
  assert.equal(normalResult.rows.length, 1);
  assert.equal(normalResult.rows[0][29], 20); // Organic Sessions After
  assert.equal(normalResult.rows[0][30], 15); // Organic Sessions Before
  assert.equal(normalResult.rows[0][31], 5);  // Organic Sessions Delta

  // Filtered case: Rule 12.7 applies, sessions replaced with N/A
  const filteredItem = {
    ...sampleItem,
    organicSessions: {
      ...sampleItem.organicSessions,
      isGscQueryFilterApplied: true,
    },
  };
  const filteredResult = buildBenchmarkCsvRows([filteredItem]);
  assert.equal(filteredResult.rows[0][29], "N/A (Query filter applied)");
  assert.equal(filteredResult.rows[0][30], "N/A (Query filter applied)");
  assert.equal(filteredResult.rows[0][31], "N/A (Query filter applied)");
});


