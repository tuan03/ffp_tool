import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateGscMetrics,
  buildCalendarWindows,
  buildVersionWindows,
  calculateGscBenchmark,
  calculateSeoBenchmark,
} from "../seo-performance/benchmark";
import type {
  BenchmarkQualityInput,
  GscMetricRow,
  VersionBenchmarkInput,
} from "../seo-performance/benchmark";

const freshQuality: BenchmarkQualityInput = {
  dataStatus: "FRESH",
  sourceScopeValid: true,
  beforeCompleteDays: 28,
  afterCompleteDays: 28,
  crawlState: "OBSERVED",
  technicalFlags: [],
};

const beforeRows: readonly GscMetricRow[] = [
  { clicks: 10, impressions: 100, position: 10 },
  { clicks: 20, impressions: 300, position: 20 },
];
const afterRows: readonly GscMetricRow[] = [
  { clicks: 25, impressions: 200, position: 8 },
  { clicks: 35, impressions: 400, position: 12 },
];

function versionInput(
  overrides: Partial<VersionBenchmarkInput> = {},
): VersionBenchmarkInput {
  return {
    mode: "VERSION",
    sourceTimezone: "America/Los_Angeles",
    checkpointDays: 28,
    version: {
      versionId: "version-1",
      isV0: false,
      hasPredecessor: true,
      publicEffectiveAt: "2026-08-23T07:00:00.000Z",
      publicEffectiveDay: "2026-08-23",
      newerVersionPublicEffectiveDay: null,
      hasExternalDrift: false,
      historicalContentVerified: true,
    },
    quality: freshQuality,
    beforeRows,
    afterRows,
    ...overrides,
  };
}

test("version windows exclude publish and settling days and remain equal", () => {
  assert.deepEqual(
    buildVersionWindows({
      publicEffectiveDay: "2026-08-23",
      checkpointDays: 28,
      settlingDays: 7,
      sourceTimezone: "America/Los_Angeles",
    }),
    {
      before: { startDay: "2026-07-26", endDay: "2026-08-22", days: 28 },
      after: { startDay: "2026-08-31", endDay: "2026-09-27", days: 28 },
      plannedAfterEndDay: "2026-09-27",
      equalLength: true,
      sourceTimezone: "America/Los_Angeles",
      settlingDays: 7,
    },
  );
});

test("explicit source days stay correct across the Pacific DST boundary", () => {
  const windows = buildVersionWindows({
    publicEffectiveDay: "2026-03-08",
    checkpointDays: 7,
    sourceTimezone: "America/Los_Angeles",
  });
  assert.deepEqual(windows.before, {
    startDay: "2026-03-01",
    endDay: "2026-03-07",
    days: 7,
  });
  assert.deepEqual(windows.after, {
    startDay: "2026-03-16",
    endDay: "2026-03-22",
    days: 7,
  });
});

test("calendar comparison creates a labelled equal previous period", () => {
  assert.deepEqual(
    buildCalendarWindows({
      currentStartDay: "2026-11-01",
      currentEndDay: "2026-11-14",
      sourceTimezone: "America/Los_Angeles",
    }),
    {
      before: { startDay: "2026-10-18", endDay: "2026-10-31", days: 14 },
      after: { startDay: "2026-11-01", endDay: "2026-11-14", days: 14 },
      sourceTimezone: "America/Los_Angeles",
    },
  );
});

test("newer versions cap the After window instead of mixing content", () => {
  const windows = buildVersionWindows({
    publicEffectiveDay: "2026-08-23",
    checkpointDays: 28,
    sourceTimezone: "America/Los_Angeles",
    newerVersionPublicEffectiveDay: "2026-09-15",
  });
  assert.deepEqual(windows.after, {
    startDay: "2026-08-31",
    endDay: "2026-09-14",
    days: 15,
  });
  assert.equal(windows.equalLength, false);
  const benchmark = calculateSeoBenchmark(versionInput({
    version: {
      ...versionInput().version,
      newerVersionPublicEffectiveDay: "2026-09-15",
    },
  }));
  assert.equal(benchmark.measurementStatus, "COLLECTING");
  assert.equal(benchmark.performanceStatus, "NOT_EVALUATED");
  assert.ok(benchmark.reasons.includes("NEWER_VERSION_OVERLAP"));
});

test("GSC aggregation uses ratio-of-sums and impression-weighted position", () => {
  assert.deepEqual(aggregateGscMetrics(beforeRows), {
    availability: "OBSERVED",
    clicks: 30,
    impressions: 400,
    ctr: 0.075,
    position: 17.5,
  });
  const metrics = calculateGscBenchmark({ beforeRows, afterRows });
  assert.equal(metrics.after.ctr, 0.1);
  assert.equal(metrics.after.position, 32 / 3);
  assert.equal(metrics.ctrPercentagePoints, 2.500000000000001);
  assert.equal(metrics.positionImprovement, 17.5 - 32 / 3);
  assert.deepEqual(metrics.clicks, {
    before: 30,
    after: 60,
    absolute: 30,
    percent: 100,
  });
});

test("observed zero, missing data and undefined CTR remain distinct", () => {
  const zero = calculateGscBenchmark({
    beforeRows: [],
    afterRows: [{ clicks: 12, impressions: 400, position: 9 }],
  });
  assert.deepEqual(zero.clicks, {
    before: 0,
    after: 12,
    absolute: 12,
    percent: null,
  });
  assert.equal(zero.before.ctr, null);
  assert.equal(zero.before.position, null);

  const missing = calculateGscBenchmark({ beforeRows: null, afterRows: [] });
  assert.equal(missing.before.availability, "MISSING");
  assert.equal(missing.clicks.absolute, null);
  assert.equal(missing.ctrPercentagePoints, null);
});

test("unknown public effectiveness blocks version attribution", () => {
  const result = calculateSeoBenchmark(versionInput({
    version: {
      ...versionInput().version,
      publicEffectiveAt: null,
      publicEffectiveDay: null,
    },
  }));
  assert.equal(result.windows, null);
  assert.equal(result.metrics, null);
  assert.equal(result.measurementStatus, "INSUFFICIENT_DATA");
  assert.deepEqual(result.reasons, ["PUBLIC_EFFECTIVE_TIME_UNKNOWN"]);
});

test("v0 exposes raw metrics but never a version delta", () => {
  const result = calculateSeoBenchmark(versionInput({
    version: {
      ...versionInput().version,
      versionId: "version-0",
      isV0: true,
      hasPredecessor: false,
      publicEffectiveAt: null,
      publicEffectiveDay: null,
    },
  }));
  assert.equal(result.measurementStatus, "BASELINE");
  assert.equal(result.performanceStatus, "NOT_EVALUATED");
  assert.equal(result.metrics, null);
  assert.equal(result.raw.after.clicks, 60);
  assert.deepEqual(result.reasons, ["BASELINE_VERSION"]);
});

test("layered gates retain data, measurement, performance and technical states", () => {
  const external = calculateSeoBenchmark(versionInput({
    version: { ...versionInput().version, hasExternalDrift: true },
  }));
  assert.equal(external.dataStatus, "FRESH");
  assert.equal(external.measurementStatus, "CONTENT_CHANGED");
  assert.equal(external.performanceStatus, "NOT_EVALUATED");

  const technical = calculateSeoBenchmark(versionInput({
    quality: { ...freshQuality, technicalFlags: ["CANONICAL_REVIEW"] },
  }));
  assert.equal(technical.measurementStatus, "ELIGIBLE");
  assert.equal(technical.performanceStatus, "NOT_EVALUATED");
  assert.deepEqual(technical.technicalFlags, ["CANONICAL_REVIEW"]);
  assert.ok(technical.reasons.includes("TECHNICAL_REVIEW"));

  const stale = calculateSeoBenchmark(versionInput({
    quality: { ...freshQuality, dataStatus: "STALE" },
  }));
  assert.equal(stale.dataStatus, "STALE");
  assert.equal(stale.measurementStatus, "INSUFFICIENT_DATA");
  assert.ok(stale.reasons.includes("DATA_STALE"));
});

test("complete eligible windows classify performance with frozen V1 click rules", () => {
  const improving = calculateSeoBenchmark(versionInput());
  assert.equal(improving.measurementStatus, "ELIGIBLE");
  assert.equal(improving.performanceStatus, "IMPROVING");

  const declining = calculateSeoBenchmark(versionInput({
    beforeRows: afterRows,
    afterRows: beforeRows,
  }));
  assert.equal(declining.performanceStatus, "DECLINING");

  const newActivity = calculateSeoBenchmark(versionInput({
    beforeRows: [],
    afterRows: [{ clicks: 12, impressions: 400, position: 8 }],
  }));
  assert.equal(newActivity.performanceStatus, "MIXED");
  assert.ok(newActivity.reasons.includes("NEW_ACTIVITY"));

  const lowVolume = calculateSeoBenchmark(versionInput({
    beforeRows: [{ clicks: 2, impressions: 100, position: 8 }],
    afterRows: [{ clicks: 4, impressions: 120, position: 7 }],
  }));
  assert.equal(lowVolume.measurementStatus, "INSUFFICIENT_DATA");
  assert.equal(lowVolume.performanceStatus, "NOT_EVALUATED");
  assert.ok(lowVolume.reasons.includes("LOW_VOLUME"));
});

test("incomplete, crawl-unknown and unverified history stay ineligible", () => {
  const collecting = calculateSeoBenchmark(versionInput({
    quality: { ...freshQuality, afterCompleteDays: 14 },
  }));
  assert.equal(collecting.measurementStatus, "COLLECTING");
  assert.ok(collecting.reasons.includes("AFTER_WINDOW_INCOMPLETE"));

  const waiting = calculateSeoBenchmark(versionInput({
    quality: { ...freshQuality, crawlState: "UNKNOWN" },
  }));
  assert.equal(waiting.measurementStatus, "WAITING_FOR_CRAWL");
  assert.ok(waiting.reasons.includes("CRAWL_STATUS_UNKNOWN"));

  const historical = calculateSeoBenchmark(versionInput({
    version: { ...versionInput().version, historicalContentVerified: false },
  }));
  assert.equal(historical.measurementStatus, "INSUFFICIENT_DATA");
  assert.ok(historical.reasons.includes("HISTORICAL_CONTENT_UNVERIFIED"));
});

test("7, 14 and 28 day checkpoints are accepted and other lengths fail", () => {
  for (const checkpointDays of [7, 14, 28] as const) {
    assert.equal(buildVersionWindows({
      publicEffectiveDay: "2026-01-15",
      checkpointDays,
      sourceTimezone: "UTC",
    }).before.days, checkpointDays);
  }
  assert.throws(
    () => buildVersionWindows({
      publicEffectiveDay: "2026-01-15",
      checkpointDays: 21 as 28,
      sourceTimezone: "UTC",
    }),
    /INVALID_BENCHMARK_CHECKPOINT/,
  );
});
