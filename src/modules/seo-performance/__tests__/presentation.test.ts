import assert from "node:assert/strict";
import test from "node:test";

import { presetPeriod, metricChange } from "../ui/presentation";

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
