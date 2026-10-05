import assert from "node:assert/strict";
import test from "node:test";

import {
  advanceSuccessfulWatermark,
  classifyProviderFailure,
  createPerformanceCacheSignature,
  createPerformancePartitionKey,
  createSyncWindow,
  evaluatePerformanceFreshness,
  providerForSyncJob,
  selectFairSyncJobs,
} from "../seo-performance/sync-policy";
import type { PerformancePartitionInput, PerformanceSignatureInput, PendingSyncJob, SuccessfulSyncWatermark } from "../seo-performance/sync-policy";

const signature: PerformanceSignatureInput = {
  storeId: "jeminise",
  mappingRevision: 3,
  provider: "gsc",
  property: "sc-domain:jeminise.com",
  metricContract: "gsc-page-v1",
  filters: { country: "USA", device: "MOBILE" },
  windows: [{ startDate: "2026-09-01", endDate: "2026-09-28" }],
  versionIds: ["version-before", "version-after"],
  dataRevision: "gsc-2026-10-05",
};

test("sync job kinds are provider-aware", () => {
  assert.equal(providerForSyncJob("gsc_backfill"), "gsc");
  assert.equal(providerForSyncJob("ga4_incremental"), "ga4");
  assert.equal(providerForSyncJob("url_inspection"), "url_inspection");
  assert.equal(providerForSyncJob("benchmark_evaluation"), "internal");
});

test("partition keys and cache signatures include every tenant, mapping, metric, window and revision dimension", () => {
  const base = createPerformanceCacheSignature(signature);
  const variants: readonly PerformanceSignatureInput[] = [
    { ...signature, storeId: "other" },
    { ...signature, mappingRevision: 4 },
    { ...signature, provider: "ga4" },
    { ...signature, property: "properties/123" },
    { ...signature, metricContract: "gsc-page-v2" },
    { ...signature, filters: { country: "CAN", device: "MOBILE" } },
    { ...signature, windows: [{ startDate: "2026-09-02", endDate: "2026-09-28" }] },
    { ...signature, versionIds: ["version-after", "version-before"] },
    { ...signature, dataRevision: "gsc-2026-10-06" },
  ];
  assert.equal(new Set([base, ...variants.map(createPerformanceCacheSignature)]).size, variants.length + 1);
  assert.equal(base, createPerformanceCacheSignature({ ...signature, filters: { device: "MOBILE", country: "USA" } }));

  const partition: PerformancePartitionInput = { ...signature, kind: "gsc_incremental", partition: "2026-09-01:USA:MOBILE" };
  assert.notEqual(createPerformancePartitionKey(partition), createPerformancePartitionKey({ ...partition, partition: "2026-09-02:USA:MOBILE" }));
  assert.throws(() => createPerformancePartitionKey({ ...partition, kind: "ga4_incremental" }), /PERFORMANCE_PARTITION_INVALID/);
});

test("sync windows default to a 90-day initial backfill and seven-day overlap", () => {
  assert.deepEqual(createSyncWindow({ mode: "initial", dataThrough: "2026-10-05" }), {
    startDate: "2026-07-08", endDate: "2026-10-05",
  });
  assert.deepEqual(createSyncWindow({ mode: "incremental", dataThrough: "2026-10-05", lastSuccessfulDataThrough: "2026-10-01" }), {
    startDate: "2026-09-25", endDate: "2026-10-05",
  });
  assert.throws(() => createSyncWindow({ mode: "incremental", dataThrough: "2026-10-05", lastSuccessfulDataThrough: "2026-10-06" }), /WATERMARK_AHEAD/);
});

test("freshness applies source-specific lag and keeps preliminary or partial quality explicit", () => {
  const now = Date.parse("2026-10-10T12:00:00Z");
  const common = {
    sourceDate: "2026-10-10",
    fetchedAt: "2026-10-10T11:00:00Z",
    lastSuccessfulSync: "2026-10-10T11:00:00Z",
    quality: "complete" as const,
    now,
  };
  assert.deepEqual(evaluatePerformanceFreshness({ ...common, source: "gsc", dataThrough: "2026-10-05" }), {
    source: "gsc", availability: "finalized", stale: true, staleReason: "DATA_THROUGH_BEHIND",
    dataThrough: "2026-10-05", fetchedAt: common.fetchedAt, lastSuccessfulSync: common.lastSuccessfulSync,
  });
  assert.equal(evaluatePerformanceFreshness({ ...common, source: "url_inspection", dataThrough: "2026-10-05" }).stale, false);
  assert.deepEqual(evaluatePerformanceFreshness({ ...common, source: "ga4", dataThrough: "2026-10-08", quality: "preliminary" }), {
    source: "ga4", availability: "preliminary", stale: false, staleReason: null,
    dataThrough: "2026-10-08", fetchedAt: common.fetchedAt, lastSuccessfulSync: common.lastSuccessfulSync,
  });
  assert.equal(evaluatePerformanceFreshness({ ...common, source: "ga4", dataThrough: null, quality: "unavailable" }).staleReason, "NO_SUCCESSFUL_SYNC");
});

test("provider failure policy distinguishes reconnect, permission, quota, invalid and bounded transient retries", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  assert.deepEqual(classifyProviderFailure({ failure: { status: 401 }, attempt: 1, now, jitter: () => 0 }), {
    category: "reconnect", retryable: false, reconnectRequired: true, retryAt: null, attempt: 1, maxAttempts: 5,
  });
  assert.equal(classifyProviderFailure({ failure: { code: "invalid_grant" }, attempt: 1, now, jitter: () => 0 }).category, "reconnect");
  assert.equal(classifyProviderFailure({ failure: { status: 403, reason: "permissionDenied" }, attempt: 1, now, jitter: () => 0 }).category, "permission");
  assert.equal(classifyProviderFailure({ failure: { status: 403, reason: "accessNotConfigured" }, attempt: 1, now, jitter: () => 0 }).category, "api_disabled");
  const quota = classifyProviderFailure({ failure: { status: 403, reason: "quotaExceeded" }, attempt: 1, now, jitter: () => 0 });
  assert.equal(quota.category, "quota");
  assert.equal(quota.retryAt, now + 30_000);
  assert.equal(classifyProviderFailure({ failure: { status: 400, reason: "invalidArgument" }, attempt: 1, now, jitter: () => 0 }).retryable, false);
  assert.equal(classifyProviderFailure({ failure: { code: "ETIMEDOUT" }, attempt: 2, now, jitter: () => 0 }).category, "timeout");
  assert.equal(classifyProviderFailure({ failure: { status: 503 }, attempt: 5, now, jitter: () => 0 }).retryable, false);
});

test("429 Retry-After accepts numeric and HTTP-date values and uses injected bounded jitter", () => {
  const now = Date.parse("2026-10-05T00:00:00Z");
  const numeric = classifyProviderFailure({ failure: { status: 429, retryAfter: "120" }, attempt: 1, now, jitter: () => 0.5 });
  assert.equal(numeric.category, "rate_limit");
  assert.equal(numeric.retryAt, now + 126_000);
  const date = classifyProviderFailure({ failure: { status: 429, retryAfter: "Mon, 05 Oct 2026 00:01:00 GMT" }, attempt: 1, now, jitter: () => 0.5 });
  assert.equal(date.retryAt, now + 63_000);
  const bounded = classifyProviderFailure({ failure: { status: 429, retryAfter: "7200" }, attempt: 1, now, jitter: () => 1, maxDelayMs: 3_600_000 });
  assert.equal(bounded.retryAt, now + 3_600_000);
});

test("fair concurrency gives providers and stores turns instead of draining one backlog", () => {
  const pending: readonly PendingSyncJob[] = [
    { id: "gsc-a-1", storeId: "a", provider: "gsc", kind: "gsc_incremental", createdAt: 1 },
    { id: "gsc-a-2", storeId: "a", provider: "gsc", kind: "gsc_incremental", createdAt: 2 },
    { id: "gsc-b-1", storeId: "b", provider: "gsc", kind: "gsc_incremental", createdAt: 3 },
    { id: "ga4-c-1", storeId: "c", provider: "ga4", kind: "ga4_incremental", createdAt: 4 },
  ];
  const selection = selectFairSyncJobs({ pending, active: [], globalLimit: 3, perProviderLimit: 2, perStoreLimit: 1 });
  assert.deepEqual(new Set(selection.selected.map(job => job.storeId)), new Set(["a", "b", "c"]));
  assert.deepEqual(selection.selected.map(job => job.provider), ["ga4", "gsc", "gsc"]);

  const providerLimited = selectFairSyncJobs({ pending, active: [], globalLimit: 2, perProviderLimit: 1, perStoreLimit: 2 });
  assert.deepEqual(new Set(providerLimited.selected.map(job => job.provider)), new Set(["gsc", "ga4"]));
  const activeBlocked = selectFairSyncJobs({ pending, active: [{ storeId: "c", provider: "ga4", count: 1 }], globalLimit: 3, perProviderLimit: 1, perStoreLimit: 1 });
  assert.deepEqual(activeBlocked.selected.map(job => job.provider), ["gsc"]);
});

test("failed or partial partitions never advance the last successful watermark", () => {
  const current: SuccessfulSyncWatermark = {
    storeId: "jeminise", mappingRevision: 3, provider: "gsc", property: "sc-domain:jeminise.com",
    dataThrough: "2026-10-01", lastSuccessfulSync: "2026-10-02T00:00:00Z",
  };
  const baseOutcome = {
    storeId: current.storeId, mappingRevision: current.mappingRevision, provider: current.provider, property: current.property,
    dataThrough: "2026-10-05", completedAt: "2026-10-06T00:00:00Z",
  } as const;
  assert.equal(advanceSuccessfulWatermark(current, { ...baseOutcome, status: "failed", fetchComplete: false }), current);
  assert.equal(advanceSuccessfulWatermark(current, { ...baseOutcome, status: "succeeded", fetchComplete: false }), current);
  assert.deepEqual(advanceSuccessfulWatermark(current, { ...baseOutcome, status: "succeeded", fetchComplete: true }), {
    ...current, dataThrough: "2026-10-05", lastSuccessfulSync: "2026-10-06T00:00:00Z",
  });
  assert.throws(() => advanceSuccessfulWatermark(current, { ...baseOutcome, storeId: "other", status: "succeeded", fetchComplete: true }), /SCOPE_MISMATCH/);
});
