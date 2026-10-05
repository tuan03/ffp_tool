export const BENCHMARK_CHECKPOINT_DAYS = [7, 14, 28] as const;

export type BenchmarkCheckpointDays = typeof BENCHMARK_CHECKPOINT_DAYS[number];
export type BenchmarkMode = "CALENDAR" | "VERSION";
export type BenchmarkDataStatus = "FRESH" | "PARTIAL" | "STALE" | "ERROR" | "DISCONNECTED";
export type BenchmarkMeasurementStatus =
  | "BASELINE"
  | "WAITING_FOR_CRAWL"
  | "COLLECTING"
  | "ELIGIBLE"
  | "INSUFFICIENT_DATA"
  | "CONTENT_CHANGED";
export type BenchmarkPerformanceStatus =
  | "NOT_EVALUATED"
  | "IMPROVING"
  | "STABLE"
  | "MIXED"
  | "DECLINING";
export type BenchmarkCrawlState = "UNKNOWN" | "WAITING" | "OBSERVED";
export type BenchmarkReason =
  | "PUBLIC_EFFECTIVE_TIME_UNKNOWN"
  | "BASELINE_VERSION"
  | "SOURCE_SCOPE_INVALID"
  | "DATA_DISCONNECTED"
  | "DATA_ERROR"
  | "DATA_STALE"
  | "DATA_PARTIAL"
  | "EXTERNAL_CONTENT_DRIFT"
  | "HISTORICAL_CONTENT_UNVERIFIED"
  | "NEWER_VERSION_OVERLAP"
  | "WAITING_FOR_OBSERVED_RECRAWL"
  | "CRAWL_STATUS_UNKNOWN"
  | "AFTER_WINDOW_INCOMPLETE"
  | "BEFORE_WINDOW_INCOMPLETE"
  | "BASELINE_MISSING"
  | "AFTER_DATA_MISSING"
  | "LOW_VOLUME"
  | "NEW_ACTIVITY"
  | "TECHNICAL_REVIEW";

export interface BenchmarkDateWindow {
  readonly startDay: string;
  readonly endDay: string;
  readonly days: number;
}

export interface VersionBenchmarkWindows {
  readonly before: BenchmarkDateWindow;
  readonly after: BenchmarkDateWindow;
  readonly plannedAfterEndDay: string;
  readonly equalLength: boolean;
  readonly sourceTimezone: string;
  readonly settlingDays: number;
}

export interface GscMetricRow {
  readonly clicks: number;
  readonly impressions: number;
  readonly position: number | null;
}

export interface GscPeriodMetrics {
  readonly availability: "MISSING" | "OBSERVED";
  readonly clicks: number | null;
  readonly impressions: number | null;
  readonly ctr: number | null;
  readonly position: number | null;
}

export interface MetricDelta {
  readonly before: number | null;
  readonly after: number | null;
  readonly absolute: number | null;
  readonly percent: number | null;
}

export interface GscBenchmarkMetrics {
  readonly before: GscPeriodMetrics;
  readonly after: GscPeriodMetrics;
  readonly clicks: MetricDelta;
  readonly impressions: MetricDelta;
  readonly ctrPercentagePoints: number | null;
  readonly positionImprovement: number | null;
}

export interface BenchmarkQualityInput {
  readonly dataStatus: BenchmarkDataStatus;
  readonly sourceScopeValid: boolean;
  readonly beforeCompleteDays: number;
  readonly afterCompleteDays: number;
  readonly crawlState: BenchmarkCrawlState;
  readonly technicalFlags: readonly string[];
}

export interface VersionBenchmarkInput {
  readonly mode: "VERSION";
  readonly sourceTimezone: string;
  readonly checkpointDays: BenchmarkCheckpointDays;
  readonly settlingDays?: number;
  readonly version: {
    readonly versionId: string;
    readonly isV0: boolean;
    readonly hasPredecessor: boolean;
    readonly publicEffectiveAt: string | null;
    readonly publicEffectiveDay: string | null;
    readonly newerVersionPublicEffectiveDay: string | null;
    readonly hasExternalDrift: boolean;
    readonly historicalContentVerified: boolean;
  };
  readonly quality: BenchmarkQualityInput;
  readonly beforeRows: readonly GscMetricRow[] | null;
  readonly afterRows: readonly GscMetricRow[] | null;
}

export interface CalendarBenchmarkInput {
  readonly mode: "CALENDAR";
  readonly sourceTimezone: string;
  readonly currentStartDay: string;
  readonly currentEndDay: string;
  readonly quality: BenchmarkQualityInput;
  readonly beforeRows: readonly GscMetricRow[] | null;
  readonly afterRows: readonly GscMetricRow[] | null;
}

export type SeoBenchmarkInput = VersionBenchmarkInput | CalendarBenchmarkInput;

export interface SeoBenchmarkResult {
  readonly mode: BenchmarkMode;
  readonly label: "CALENDAR_COMPARISON" | "VERSION_COMPARISON";
  readonly sourceTimezone: string;
  readonly windows: {
    readonly before: BenchmarkDateWindow;
    readonly after: BenchmarkDateWindow;
    readonly settlingDays: number;
    readonly plannedAfterEndDay: string;
    readonly equalLength: boolean;
  } | null;
  readonly raw: {
    readonly before: GscPeriodMetrics;
    readonly after: GscPeriodMetrics;
  };
  readonly metrics: GscBenchmarkMetrics | null;
  readonly dataStatus: BenchmarkDataStatus;
  readonly measurementStatus: BenchmarkMeasurementStatus;
  readonly performanceStatus: BenchmarkPerformanceStatus;
  readonly technicalFlags: readonly string[];
  readonly reasons: readonly BenchmarkReason[];
}

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function dayNumber(day: string): number {
  if (!DAY_PATTERN.test(day)) throw new Error("INVALID_BENCHMARK_DAY");
  const value = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== day) {
    throw new Error("INVALID_BENCHMARK_DAY");
  }
  return value / DAY_MS;
}

function dayFromNumber(value: number): string {
  return new Date(value * DAY_MS).toISOString().slice(0, 10);
}

function shiftDay(day: string, amount: number): string {
  return dayFromNumber(dayNumber(day) + amount);
}

function inclusiveDays(startDay: string, endDay: string): number {
  const days = dayNumber(endDay) - dayNumber(startDay) + 1;
  if (!Number.isSafeInteger(days) || days < 1) throw new Error("INVALID_BENCHMARK_WINDOW");
  return days;
}

function assertNonNegativeInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("INVALID_BENCHMARK_QUALITY");
}

export function buildCalendarWindows(input: {
  readonly currentStartDay: string;
  readonly currentEndDay: string;
  readonly sourceTimezone: string;
}): { readonly before: BenchmarkDateWindow; readonly after: BenchmarkDateWindow; readonly sourceTimezone: string } {
  if (!input.sourceTimezone.trim()) throw new Error("SOURCE_TIMEZONE_REQUIRED");
  const days = inclusiveDays(input.currentStartDay, input.currentEndDay);
  const beforeEndDay = shiftDay(input.currentStartDay, -1);
  return {
    before: {
      startDay: shiftDay(beforeEndDay, -(days - 1)),
      endDay: beforeEndDay,
      days,
    },
    after: { startDay: input.currentStartDay, endDay: input.currentEndDay, days },
    sourceTimezone: input.sourceTimezone,
  };
}

export function buildVersionWindows(input: {
  readonly publicEffectiveDay: string;
  readonly checkpointDays: BenchmarkCheckpointDays;
  readonly settlingDays?: number;
  readonly sourceTimezone: string;
  readonly newerVersionPublicEffectiveDay?: string | null;
}): VersionBenchmarkWindows {
  if (!BENCHMARK_CHECKPOINT_DAYS.includes(input.checkpointDays)) {
    throw new Error("INVALID_BENCHMARK_CHECKPOINT");
  }
  if (!input.sourceTimezone.trim()) throw new Error("SOURCE_TIMEZONE_REQUIRED");
  const settlingDays = input.settlingDays ?? 7;
  assertNonNegativeInteger(settlingDays);
  const publishDayNumber = dayNumber(input.publicEffectiveDay);
  const beforeEndDay = dayFromNumber(publishDayNumber - 1);
  const afterStartDay = dayFromNumber(publishDayNumber + 1 + settlingDays);
  const plannedAfterEndDay = shiftDay(afterStartDay, input.checkpointDays - 1);
  let afterEndDay = plannedAfterEndDay;
  if (input.newerVersionPublicEffectiveDay) {
    const newerCap = shiftDay(input.newerVersionPublicEffectiveDay, -1);
    if (dayNumber(newerCap) < dayNumber(afterEndDay)) afterEndDay = newerCap;
  }
  const availableAfterDays = dayNumber(afterEndDay) < dayNumber(afterStartDay)
    ? 0
    : inclusiveDays(afterStartDay, afterEndDay);
  return {
    before: {
      startDay: shiftDay(beforeEndDay, -(input.checkpointDays - 1)),
      endDay: beforeEndDay,
      days: input.checkpointDays,
    },
    after: {
      startDay: afterStartDay,
      endDay: afterEndDay,
      days: availableAfterDays,
    },
    plannedAfterEndDay,
    equalLength: availableAfterDays === input.checkpointDays,
    sourceTimezone: input.sourceTimezone,
    settlingDays,
  };
}

function validateMetric(value: number): void {
  if (!Number.isFinite(value) || value < 0) throw new Error("INVALID_GSC_METRIC");
}

export function aggregateGscMetrics(
  rows: readonly GscMetricRow[] | null,
): GscPeriodMetrics {
  if (rows === null) {
    return { availability: "MISSING", clicks: null, impressions: null, ctr: null, position: null };
  }
  let clicks = 0;
  let impressions = 0;
  let positionNumerator = 0;
  let positionDenominator = 0;
  let hasMissingPosition = false;
  for (const row of rows) {
    validateMetric(row.clicks);
    validateMetric(row.impressions);
    if (row.position !== null) validateMetric(row.position);
    clicks += row.clicks;
    impressions += row.impressions;
    if (row.impressions > 0 && row.position === null) hasMissingPosition = true;
    if (row.impressions > 0 && row.position !== null) {
      positionNumerator += row.position * row.impressions;
      positionDenominator += row.impressions;
    }
  }
  return {
    availability: "OBSERVED",
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : null,
    position: impressions > 0 && positionDenominator > 0 && !hasMissingPosition
      ? positionNumerator / positionDenominator
      : null,
  };
}

function metricDelta(before: number | null, after: number | null): MetricDelta {
  const absolute = before === null || after === null ? null : after - before;
  return {
    before,
    after,
    absolute,
    percent: absolute === null || before === null || before === 0
      ? null
      : absolute / before * 100,
  };
}

export function calculateGscBenchmark(input: {
  readonly beforeRows: readonly GscMetricRow[] | null;
  readonly afterRows: readonly GscMetricRow[] | null;
}): GscBenchmarkMetrics {
  const before = aggregateGscMetrics(input.beforeRows);
  const after = aggregateGscMetrics(input.afterRows);
  return {
    before,
    after,
    clicks: metricDelta(before.clicks, after.clicks),
    impressions: metricDelta(before.impressions, after.impressions),
    ctrPercentagePoints: before.ctr === null || after.ctr === null
      ? null
      : (after.ctr - before.ctr) * 100,
    positionImprovement: before.position === null || after.position === null
      ? null
      : before.position - after.position,
  };
}

function dataGate(status: BenchmarkDataStatus): BenchmarkReason | null {
  switch (status) {
    case "DISCONNECTED": return "DATA_DISCONNECTED";
    case "ERROR": return "DATA_ERROR";
    case "STALE": return "DATA_STALE";
    case "PARTIAL": return "DATA_PARTIAL";
    case "FRESH": return null;
  }
}

function classifyPerformance(
  metrics: GscBenchmarkMetrics,
): { readonly status: BenchmarkPerformanceStatus; readonly reason?: BenchmarkReason } {
  const beforeClicks = metrics.before.clicks;
  const afterClicks = metrics.after.clicks;
  const beforeImpressions = metrics.before.impressions;
  const afterImpressions = metrics.after.impressions;
  if (beforeClicks === null || afterClicks === null ||
      beforeImpressions === null || afterImpressions === null) {
    return { status: "NOT_EVALUATED" };
  }
  if (Math.max(beforeImpressions, afterImpressions) < 300) {
    return { status: "NOT_EVALUATED", reason: "LOW_VOLUME" };
  }
  if (beforeClicks === 0 && afterClicks > 0) {
    return { status: "MIXED", reason: "NEW_ACTIVITY" };
  }
  const absolute = metrics.clicks.absolute ?? 0;
  const percent = metrics.clicks.percent;
  if (percent !== null && Math.max(beforeClicks, afterClicks) >= 20 &&
      Math.abs(absolute) >= 10 && Math.abs(percent) >= 20) {
    return { status: absolute > 0 ? "IMPROVING" : "DECLINING" };
  }
  const impressionsAbsolute = metrics.impressions.absolute ?? 0;
  if (absolute !== 0 && impressionsAbsolute !== 0 &&
      Math.sign(absolute) !== Math.sign(impressionsAbsolute)) {
    return { status: "MIXED" };
  }
  return { status: "STABLE" };
}

function qualityGate(input: {
  readonly quality: BenchmarkQualityInput;
  readonly expectedDays: number;
  readonly hasBefore: boolean;
  readonly hasAfter: boolean;
  readonly version?: VersionBenchmarkInput["version"];
  readonly windowsEqual: boolean;
}): { readonly measurement: BenchmarkMeasurementStatus; readonly reasons: readonly BenchmarkReason[] } {
  assertNonNegativeInteger(input.quality.beforeCompleteDays);
  assertNonNegativeInteger(input.quality.afterCompleteDays);
  const reasons: BenchmarkReason[] = [];
  if (!input.quality.sourceScopeValid) reasons.push("SOURCE_SCOPE_INVALID");
  const providerReason = dataGate(input.quality.dataStatus);
  if (providerReason) reasons.push(providerReason);
  if (input.version?.hasExternalDrift) reasons.push("EXTERNAL_CONTENT_DRIFT");
  if (input.version && !input.version.historicalContentVerified) {
    reasons.push("HISTORICAL_CONTENT_UNVERIFIED");
  }
  if (!input.windowsEqual) reasons.push("NEWER_VERSION_OVERLAP");
  if (!input.hasBefore) reasons.push("BASELINE_MISSING");
  if (!input.hasAfter) reasons.push("AFTER_DATA_MISSING");
  if (input.quality.beforeCompleteDays < input.expectedDays) {
    reasons.push("BEFORE_WINDOW_INCOMPLETE");
  }
  if (input.quality.afterCompleteDays < input.expectedDays) {
    reasons.push("AFTER_WINDOW_INCOMPLETE");
  }

  if (input.version?.hasExternalDrift) return { measurement: "CONTENT_CHANGED", reasons };
  if (["DISCONNECTED", "ERROR", "STALE"].includes(input.quality.dataStatus) ||
      !input.quality.sourceScopeValid || !input.hasBefore || !input.hasAfter ||
      (input.version && !input.version.historicalContentVerified)) {
    return { measurement: "INSUFFICIENT_DATA", reasons };
  }
  if (input.version && input.quality.crawlState === "WAITING") {
    reasons.push("WAITING_FOR_OBSERVED_RECRAWL");
    return { measurement: "WAITING_FOR_CRAWL", reasons };
  }
  if (input.quality.crawlState === "UNKNOWN" && input.version) {
    reasons.push("CRAWL_STATUS_UNKNOWN");
    return { measurement: "WAITING_FOR_CRAWL", reasons };
  }
  if (input.quality.dataStatus === "PARTIAL" || !input.windowsEqual ||
      input.quality.beforeCompleteDays < input.expectedDays ||
      input.quality.afterCompleteDays < input.expectedDays) {
    return { measurement: "COLLECTING", reasons };
  }
  return { measurement: "ELIGIBLE", reasons };
}

export function calculateSeoBenchmark(input: SeoBenchmarkInput): SeoBenchmarkResult {
  const before = aggregateGscMetrics(input.beforeRows);
  const after = aggregateGscMetrics(input.afterRows);
  if (input.mode === "VERSION" && input.version.isV0) {
    return {
      mode: input.mode,
      label: "VERSION_COMPARISON",
      sourceTimezone: input.sourceTimezone,
      windows: null,
      raw: { before, after },
      metrics: null,
      dataStatus: input.quality.dataStatus,
      measurementStatus: "BASELINE",
      performanceStatus: "NOT_EVALUATED",
      technicalFlags: [...input.quality.technicalFlags],
      reasons: ["BASELINE_VERSION"],
    };
  }

  let windows: SeoBenchmarkResult["windows"];
  let expectedDays: number;
  if (input.mode === "CALENDAR") {
    const calendar = buildCalendarWindows(input);
    expectedDays = calendar.after.days;
    windows = {
      before: calendar.before,
      after: calendar.after,
      settlingDays: 0,
      plannedAfterEndDay: calendar.after.endDay,
      equalLength: true,
    };
  } else {
    if (!input.version.publicEffectiveAt || !input.version.publicEffectiveDay) {
      return {
        mode: input.mode,
        label: "VERSION_COMPARISON",
        sourceTimezone: input.sourceTimezone,
        windows: null,
        raw: { before, after },
        metrics: null,
        dataStatus: input.quality.dataStatus,
        measurementStatus: "INSUFFICIENT_DATA",
        performanceStatus: "NOT_EVALUATED",
        technicalFlags: [...input.quality.technicalFlags],
        reasons: ["PUBLIC_EFFECTIVE_TIME_UNKNOWN"],
      };
    }
    if (!input.version.hasPredecessor) {
      return {
        mode: input.mode,
        label: "VERSION_COMPARISON",
        sourceTimezone: input.sourceTimezone,
        windows: null,
        raw: { before, after },
        metrics: null,
        dataStatus: input.quality.dataStatus,
        measurementStatus: "INSUFFICIENT_DATA",
        performanceStatus: "NOT_EVALUATED",
        technicalFlags: [...input.quality.technicalFlags],
        reasons: ["BASELINE_MISSING"],
      };
    }
    const versionWindows = buildVersionWindows({
      publicEffectiveDay: input.version.publicEffectiveDay,
      checkpointDays: input.checkpointDays,
      settlingDays: input.settlingDays,
      sourceTimezone: input.sourceTimezone,
      newerVersionPublicEffectiveDay: input.version.newerVersionPublicEffectiveDay,
    });
    expectedDays = input.checkpointDays;
    windows = {
      before: versionWindows.before,
      after: versionWindows.after,
      settlingDays: versionWindows.settlingDays,
      plannedAfterEndDay: versionWindows.plannedAfterEndDay,
      equalLength: versionWindows.equalLength,
    };
  }

  const metrics = calculateGscBenchmark(input);
  const gated = qualityGate({
    quality: input.quality,
    expectedDays,
    hasBefore: metrics.before.availability === "OBSERVED",
    hasAfter: metrics.after.availability === "OBSERVED",
    version: input.mode === "VERSION" ? input.version : undefined,
    windowsEqual: windows.equalLength,
  });
  const technicalReasons: BenchmarkReason[] = input.quality.technicalFlags.length
    ? ["TECHNICAL_REVIEW"]
    : [];
  const classification = gated.measurement === "ELIGIBLE" &&
      input.quality.technicalFlags.length === 0
    ? classifyPerformance(metrics)
    : { status: "NOT_EVALUATED" as const };
  const measurementStatus = classification.reason === "LOW_VOLUME"
    ? "INSUFFICIENT_DATA"
    : gated.measurement;
  return {
    mode: input.mode,
    label: input.mode === "VERSION" ? "VERSION_COMPARISON" : "CALENDAR_COMPARISON",
    sourceTimezone: input.sourceTimezone,
    windows,
    raw: { before, after },
    metrics,
    dataStatus: input.quality.dataStatus,
    measurementStatus,
    performanceStatus: classification.status,
    technicalFlags: [...input.quality.technicalFlags],
    reasons: [
      ...gated.reasons,
      ...technicalReasons,
      ...(classification.reason ? [classification.reason] : []),
    ],
  };
}
