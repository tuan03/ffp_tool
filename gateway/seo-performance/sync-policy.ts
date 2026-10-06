import { calculateSha256, canonicalizeJson } from "../canonical-json";

export type PerformanceSyncProvider = "gsc" | "ga4" | "url_inspection" | "internal";
export type PerformanceSyncJobKind =
  | "gsc_backfill"
  | "gsc_incremental"
  | "ga4_backfill"
  | "ga4_incremental"
  | "url_inspection"
  | "benchmark_evaluation"
  | "recommendation_evaluation"
  | "sync_health";

const JOB_PROVIDERS: Readonly<Record<PerformanceSyncJobKind, PerformanceSyncProvider>> = {
  gsc_backfill: "gsc",
  gsc_incremental: "gsc",
  ga4_backfill: "ga4",
  ga4_incremental: "ga4",
  url_inspection: "url_inspection",
  benchmark_evaluation: "internal",
  recommendation_evaluation: "internal",
  sync_health: "internal",
};

export function providerForSyncJob(kind: PerformanceSyncJobKind): PerformanceSyncProvider { return JOB_PROVIDERS[kind]; }

export interface PerformanceDateWindow {
  readonly startDate: string;
  readonly endDate: string;
}

export interface PerformanceSignatureInput {
  readonly storeId: string;
  readonly mappingRevision: number;
  readonly provider: PerformanceSyncProvider;
  readonly property: string;
  readonly metricContract: string;
  readonly filters: Readonly<Record<string, unknown>>;
  readonly windows: readonly PerformanceDateWindow[];
  readonly versionIds: readonly string[];
  readonly dataRevision: string;
}

export interface PerformancePartitionInput extends PerformanceSignatureInput {
  readonly kind: PerformanceSyncJobKind;
  readonly partition: string;
}

function assertSignature(input: PerformanceSignatureInput): void {
  if (!input.storeId || !input.property || !input.metricContract || !input.dataRevision) throw new Error("PERFORMANCE_SIGNATURE_INVALID");
  if (!Number.isInteger(input.mappingRevision) || input.mappingRevision < 1) throw new Error("PERFORMANCE_MAPPING_REVISION_INVALID");
  for (const window of input.windows) assertDateWindow(window);
}

export function createPerformanceCacheSignature(input: PerformanceSignatureInput): string {
  assertSignature(input);
  return `sp-cache:${calculateSha256(canonicalizeJson(input))}`;
}

export function createPerformancePartitionKey(input: PerformancePartitionInput): string {
  assertSignature(input);
  if (providerForSyncJob(input.kind) !== input.provider || !input.partition) throw new Error("PERFORMANCE_PARTITION_INVALID");
  return `sp-partition:${calculateSha256(canonicalizeJson(input))}`;
}

function parseDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("PERFORMANCE_DATE_INVALID");
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new Error("PERFORMANCE_DATE_INVALID");
  return parsed;
}

function formatDate(value: Date): string { return value.toISOString().slice(0, 10); }
function shiftDate(value: string, days: number): string {
  const parsed = parseDate(value);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return formatDate(parsed);
}
function assertDateWindow(window: PerformanceDateWindow): void {
  parseDate(window.startDate);
  parseDate(window.endDate);
  if (window.startDate > window.endDate) throw new Error("PERFORMANCE_DATE_WINDOW_INVALID");
}

export interface SyncWindowInput {
  readonly mode: "initial" | "incremental";
  readonly dataThrough: string;
  readonly lastSuccessfulDataThrough?: string | null;
  readonly initialDays?: number;
  readonly overlapDays?: number;
}

export function createSyncWindow(input: SyncWindowInput): PerformanceDateWindow {
  parseDate(input.dataThrough);
  const initialDays = input.initialDays ?? 90;
  const overlapDays = input.overlapDays ?? 7;
  if (!Number.isInteger(initialDays) || initialDays < 1 || !Number.isInteger(overlapDays) || overlapDays < 1) throw new Error("PERFORMANCE_SYNC_WINDOW_POLICY_INVALID");
  if (input.mode === "initial" || !input.lastSuccessfulDataThrough) {
    return { startDate: shiftDate(input.dataThrough, -(initialDays - 1)), endDate: input.dataThrough };
  }
  parseDate(input.lastSuccessfulDataThrough);
  if (input.lastSuccessfulDataThrough > input.dataThrough) throw new Error("PERFORMANCE_WATERMARK_AHEAD_OF_SOURCE");
  return { startDate: shiftDate(input.lastSuccessfulDataThrough, -(overlapDays - 1)), endDate: input.dataThrough };
}

export type PerformanceFreshnessSource = Exclude<PerformanceSyncProvider, "internal">;
export type PerformanceDataAvailability = "finalized" | "preliminary" | "partial" | "unavailable";
export interface PerformanceFreshnessInput {
  readonly source: PerformanceFreshnessSource;
  /** The current calendar date already converted to the provider/property timezone. */
  readonly sourceDate: string;
  readonly dataThrough: string | null;
  readonly fetchedAt: string | null;
  readonly lastSuccessfulSync: string | null;
  readonly quality: "complete" | "preliminary" | "partial" | "unavailable";
  readonly now: number;
}
export interface PerformanceFreshness {
  readonly source: PerformanceFreshnessSource;
  readonly availability: PerformanceDataAvailability;
  readonly stale: boolean;
  readonly staleReason: "NO_SUCCESSFUL_SYNC" | "LAST_SUCCESS_TOO_OLD" | "DATA_THROUGH_BEHIND" | null;
  readonly dataThrough: string | null;
  readonly fetchedAt: string | null;
  readonly lastSuccessfulSync: string | null;
}

const FRESHNESS_POLICIES: Readonly<Record<PerformanceFreshnessSource, { readonly finalizationLagDays: number; readonly maxSyncAgeHours: number }>> = {
  gsc: { finalizationLagDays: 3, maxSyncAgeHours: 36 },
  ga4: { finalizationLagDays: 2, maxSyncAgeHours: 36 },
  url_inspection: { finalizationLagDays: 7, maxSyncAgeHours: 168 },
};

export function evaluatePerformanceFreshness(input: PerformanceFreshnessInput): PerformanceFreshness {
  parseDate(input.sourceDate);
  if (input.dataThrough) parseDate(input.dataThrough);
  const availability: PerformanceDataAvailability = input.quality === "complete" ? "finalized" : input.quality;
  if (input.quality === "unavailable" || !input.dataThrough || !input.lastSuccessfulSync) {
    return { source: input.source, availability: "unavailable", stale: true, staleReason: "NO_SUCCESSFUL_SYNC", dataThrough: input.dataThrough, fetchedAt: input.fetchedAt, lastSuccessfulSync: input.lastSuccessfulSync };
  }
  const lastSuccessfulSync = Date.parse(input.lastSuccessfulSync);
  if (!Number.isFinite(lastSuccessfulSync)) throw new Error("PERFORMANCE_FRESHNESS_TIMESTAMP_INVALID");
  const policy = FRESHNESS_POLICIES[input.source];
  const isSyncOld = input.now - lastSuccessfulSync > policy.maxSyncAgeHours * 3_600_000;
  const expectedDataThrough = shiftDate(input.sourceDate, -policy.finalizationLagDays);
  const isDataBehind = input.dataThrough < expectedDataThrough;
  return {
    source: input.source,
    availability,
    stale: isSyncOld || isDataBehind,
    staleReason: isSyncOld ? "LAST_SUCCESS_TOO_OLD" : isDataBehind ? "DATA_THROUGH_BEHIND" : null,
    dataThrough: input.dataThrough,
    fetchedAt: input.fetchedAt,
    lastSuccessfulSync: input.lastSuccessfulSync,
  };
}

export interface ProviderFailure {
  readonly status?: number;
  readonly code?: string;
  readonly reason?: string;
  readonly message?: string;
  readonly retryAfter?: string;
}
export type ProviderFailureCategory = "reconnect" | "permission" | "api_disabled" | "quota" | "rate_limit" | "transient" | "timeout" | "invalid_request" | "permanent";
export interface ClassifiedProviderFailure {
  readonly category: ProviderFailureCategory;
  readonly retryable: boolean;
  readonly reconnectRequired: boolean;
  readonly retryAt: number | null;
  readonly attempt: number;
  readonly maxAttempts: number;
}
export interface FailurePolicyInput {
  readonly failure: ProviderFailure;
  readonly attempt: number;
  readonly now: number;
  readonly jitter: () => number;
  readonly maxAttempts?: number;
  readonly maxDelayMs?: number;
}

function retryAfterMs(value: string | undefined, now: number): number | null {
  if (!value) return null;
  const numericSeconds = Number(value);
  if (Number.isFinite(numericSeconds) && numericSeconds >= 0) return numericSeconds * 1000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

export function classifyProviderFailure(input: FailurePolicyInput): ClassifiedProviderFailure {
  const { failure, attempt, now } = input;
  const maxAttempts = input.maxAttempts ?? 5;
  const maxDelayMs = input.maxDelayMs ?? 3_600_000;
  if (!Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(maxAttempts) || maxAttempts < 1 || maxDelayMs < 1) throw new Error("PERFORMANCE_RETRY_POLICY_INVALID");
  const fingerprint = `${failure.code ?? ""} ${failure.reason ?? ""} ${failure.message ?? ""}`.toUpperCase();
  let category: ProviderFailureCategory;
  let retryCandidate = false;
  let reconnectRequired = false;
  if (failure.status === 401 || /INVALID_GRANT|TOKEN_REVOKED|REVOKED/.test(fingerprint)) {
    category = "reconnect"; reconnectRequired = true;
  } else if (failure.status === 403) {
    if (/QUOTA|RATE.?LIMIT|RESOURCE_EXHAUSTED/.test(fingerprint)) { category = "quota"; retryCandidate = true; }
    else if (/API.?NOT.?ENABLED|ACCESS.?NOT.?CONFIGURED|SERVICE.?DISABLED/.test(fingerprint)) category = "api_disabled";
    else category = "permission";
  } else if (failure.status === 429) {
    category = "rate_limit"; retryCandidate = true;
  } else if ((failure.status !== undefined && failure.status >= 500) || /INTERNAL|UNAVAILABLE/.test(fingerprint)) {
    category = "transient"; retryCandidate = true;
  } else if (/TIMEOUT|TIMEDOUT|ETIMEDOUT|ABORT_ERR|ABORTERROR/.test(fingerprint)) {
    category = "timeout"; retryCandidate = true;
  } else if (failure.status === 400 || /INVALID.?ARGUMENT|INVALID.?REQUEST/.test(fingerprint)) category = "invalid_request";
  else category = "permanent";

  const retryable = retryCandidate && attempt < maxAttempts;
  if (!retryable) return { category, retryable: false, reconnectRequired, retryAt: null, attempt, maxAttempts };
  const serverDelay = retryAfterMs(failure.retryAfter, now);
  const exponentialDelay = Math.min(maxDelayMs, 30_000 * 2 ** Math.max(0, attempt - 1));
  const boundedDelay = Math.min(maxDelayMs, serverDelay ?? exponentialDelay);
  const jitterRatio = Math.max(0, Math.min(1, input.jitter()));
  const jitterMs = Math.floor(jitterRatio * Math.min(30_000, boundedDelay * 0.1));
  return { category, retryable: true, reconnectRequired, retryAt: now + Math.min(maxDelayMs, boundedDelay + jitterMs), attempt, maxAttempts };
}

export interface PendingSyncJob {
  readonly id: string;
  readonly storeId: string;
  readonly provider: PerformanceSyncProvider;
  readonly kind: PerformanceSyncJobKind;
  readonly createdAt: number;
}
export interface ActiveSyncCount {
  readonly storeId: string;
  readonly provider: PerformanceSyncProvider;
  readonly count: number;
}
export interface FairConcurrencyCursor {
  readonly provider: PerformanceSyncProvider | null;
  readonly stores: Readonly<Partial<Record<PerformanceSyncProvider, string>>>;
}
export interface FairSelectionInput {
  readonly pending: readonly PendingSyncJob[];
  readonly active: readonly ActiveSyncCount[];
  readonly globalLimit: number;
  readonly perProviderLimit: number;
  readonly perStoreLimit: number;
  readonly cursor?: FairConcurrencyCursor;
}
export interface FairSelectionResult {
  readonly selected: readonly PendingSyncJob[];
  readonly cursor: FairConcurrencyCursor;
}

function rotateAfter<T>(values: readonly T[], cursor: T | null | undefined): T[] {
  if (cursor === null || cursor === undefined) return [...values];
  const index = values.indexOf(cursor);
  return index < 0 ? [...values] : [...values.slice(index + 1), ...values.slice(0, index + 1)];
}

export function selectFairSyncJobs(input: FairSelectionInput): FairSelectionResult {
  for (const limit of [input.globalLimit, input.perProviderLimit, input.perStoreLimit]) if (!Number.isInteger(limit) || limit < 1) throw new Error("PERFORMANCE_CONCURRENCY_LIMIT_INVALID");
  const ids = new Set<string>();
  for (const job of input.pending) {
    if (ids.has(job.id) || providerForSyncJob(job.kind) !== job.provider) throw new Error("PERFORMANCE_PENDING_JOB_INVALID");
    ids.add(job.id);
  }
  const activeGlobal = input.active.reduce((total, entry) => total + Math.max(0, entry.count), 0);
  const availableGlobal = Math.max(0, input.globalLimit - activeGlobal);
  const providerCounts = new Map<PerformanceSyncProvider, number>();
  const storeCounts = new Map<string, number>();
  for (const entry of input.active) {
    providerCounts.set(entry.provider, (providerCounts.get(entry.provider) ?? 0) + Math.max(0, entry.count));
    storeCounts.set(entry.storeId, (storeCounts.get(entry.storeId) ?? 0) + Math.max(0, entry.count));
  }
  const lanes = new Map<PerformanceSyncProvider, Map<string, PendingSyncJob[]>>();
  for (const job of [...input.pending].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))) {
    const stores = lanes.get(job.provider) ?? new Map<string, PendingSyncJob[]>();
    const jobs = stores.get(job.storeId) ?? [];
    jobs.push(job); stores.set(job.storeId, jobs); lanes.set(job.provider, stores);
  }
  const providerOrder = rotateAfter([...lanes.keys()].sort(), input.cursor?.provider);
  const storeOrders = new Map(providerOrder.map(provider => [provider, rotateAfter([...lanes.get(provider)!.keys()].sort(), input.cursor?.stores[provider])]));
  const storeIndexes = new Map(providerOrder.map(provider => [provider, 0]));
  const nextStores: Partial<Record<PerformanceSyncProvider, string>> = { ...input.cursor?.stores };
  const selected: PendingSyncJob[] = [];
  let lastProvider = input.cursor?.provider ?? null;
  while (selected.length < availableGlobal) {
    let madeProgress = false;
    for (const provider of providerOrder) {
      if (selected.length >= availableGlobal || (providerCounts.get(provider) ?? 0) >= input.perProviderLimit) continue;
      const stores = storeOrders.get(provider) ?? [];
      let checked = 0;
      while (checked < stores.length) {
        const index = storeIndexes.get(provider) ?? 0;
        const storeId = stores[index % stores.length];
        storeIndexes.set(provider, index + 1);
        checked += 1;
        if ((storeCounts.get(storeId) ?? 0) >= input.perStoreLimit) continue;
        const job = lanes.get(provider)?.get(storeId)?.shift();
        if (!job) continue;
        selected.push(job);
        providerCounts.set(provider, (providerCounts.get(provider) ?? 0) + 1);
        storeCounts.set(storeId, (storeCounts.get(storeId) ?? 0) + 1);
        nextStores[provider] = storeId;
        lastProvider = provider;
        madeProgress = true;
        break;
      }
    }
    if (!madeProgress) break;
  }
  return { selected, cursor: { provider: lastProvider, stores: nextStores } };
}

export interface SuccessfulSyncWatermark {
  readonly storeId: string;
  readonly mappingRevision: number;
  readonly provider: PerformanceSyncProvider;
  readonly property: string;
  readonly dataThrough: string;
  readonly lastSuccessfulSync: string;
}
export interface SyncPartitionOutcome {
  readonly storeId: string;
  readonly mappingRevision: number;
  readonly provider: PerformanceSyncProvider;
  readonly property: string;
  readonly status: "succeeded" | "failed";
  readonly fetchComplete: boolean;
  readonly dataThrough: string;
  readonly completedAt: string;
}

export function advanceSuccessfulWatermark(current: SuccessfulSyncWatermark | null, outcome: SyncPartitionOutcome): SuccessfulSyncWatermark | null {
  parseDate(outcome.dataThrough);
  if (current && (current.storeId !== outcome.storeId || current.mappingRevision !== outcome.mappingRevision || current.provider !== outcome.provider || current.property !== outcome.property)) {
    throw new Error("PERFORMANCE_WATERMARK_SCOPE_MISMATCH");
  }
  if (outcome.status !== "succeeded" || !outcome.fetchComplete) return current;
  if (current && current.dataThrough > outcome.dataThrough) return current;
  if (!Number.isFinite(Date.parse(outcome.completedAt))) throw new Error("PERFORMANCE_WATERMARK_TIMESTAMP_INVALID");
  return { storeId: outcome.storeId, mappingRevision: outcome.mappingRevision, provider: outcome.provider, property: outcome.property, dataThrough: outcome.dataThrough, lastSuccessfulSync: outcome.completedAt };
}
