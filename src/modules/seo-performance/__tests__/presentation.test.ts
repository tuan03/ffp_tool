import assert from "node:assert/strict";
import test from "node:test";

import {
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

