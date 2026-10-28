import type { CustomGptClient } from "../service";
import { mockJobs, mockSettings } from "./data";
import { mockWorkerMetrics } from "./worker-metrics";
import type { QueueRetryOutcome } from "../types";

export function createMockCustomGptClient(): CustomGptClient {
  let settings = structuredClone(mockSettings);
  let jobs = [...structuredClone(mockJobs)];
  const retryReceipts = new Map<string, QueueRetryOutcome>();
  return {
    reviewList: async () => ({ items: [], total: 0, nextOffset: null }),
    reviewDetail: async (storeId, jobId) => {
      const job = mockJobs.find(entry => entry.storeId === storeId && entry.id === jobId);
      if (!job) throw new Error("Job not found");
      return { job: structuredClone(job), state: {} };
    },
    seoVersionLifecycle: async (storeId, productGid) => ({
      flags: { storeId, readEnabled: true, writeEnabled: false },
      current: { storeId, shopifyProductGid: productGid, currentVersion: {
        id: "mock-version-0", storeId, productId: "mock-product", versionNumber: 0, snapshotId: "mock-snapshot-0",
        beforeSnapshotId: null, predecessorVersionId: null, source: "BASELINE", publishOperationId: null,
        restoredFromVersionId: null, appliedAt: 0, publicEffectiveAt: null,
      }, currentSnapshotId: "mock-snapshot-0", currentContentHash: "0".repeat(64), state: "ACTIVE",
      shopifyStatus: "ACTIVE", currentUrl: null, lastSeenAt: 0, hasExternalChanges: false },
      capabilities: {
        baselineRefresh: { enabled: true, reasonCode: null }, rollbackDraft: { enabled: false, reasonCode: "SEO_VERSION_WRITE_DISABLED" },
        publish: { enabled: false, reasonCode: "SEO_VERSION_WRITE_DISABLED" }, reconcile: { enabled: false, reasonCode: "PUBLISH_DISABLED" },
      },
    }),
    seoVersionHistory: async (storeId) => ({ entries: [{ id: "mock-version-0", storeId, productId: "mock-product",
      versionNumber: 0, snapshotId: "mock-snapshot-0", beforeSnapshotId: null, predecessorVersionId: null,
      source: "BASELINE", publishOperationId: null, restoredFromVersionId: null, appliedAt: 0, publicEffectiveAt: null }],
    total: 1, nextOffset: null }),
    seoVersionDiff: async (storeId, _productGid, fromVersionId, toVersionId) => ({
      fromVersion: { id: fromVersionId, storeId, productId: "mock-product", versionNumber: 0, snapshotId: "mock-snapshot-0",
        beforeSnapshotId: null, predecessorVersionId: null, source: "BASELINE", publishOperationId: null,
        restoredFromVersionId: null, appliedAt: 0, publicEffectiveAt: null },
      toVersion: { id: toVersionId, storeId, productId: "mock-product", versionNumber: 0, snapshotId: "mock-snapshot-0",
        beforeSnapshotId: null, predecessorVersionId: null, source: "BASELINE", publishOperationId: null,
        restoredFromVersionId: null, appliedAt: 0, publicEffectiveAt: null },
      fields: [], images: [], hasChanges: false,
    }),
    refreshSeoBaseline: async () => ({}),
    requestSeoRollbackDraft: async (storeId, productGid, targetVersionId, requestId) => ({ id: `mock-${requestId}`, requestId,
      storeId, shopifyProductGid: productGid, basedOnVersionId: "mock-version-current", basedOnSnapshotId: "mock-snapshot-current",
      basedOnContentHash: "0".repeat(64), restoredFromVersionId: targetVersionId, restoredFromSnapshotId: "mock-snapshot-target",
      status: "REQUESTED", requestedBy: "mock-operator", createdAt: 0 }),
    workerMetrics: async (_storeId, hours = 24) => mockWorkerMetrics(hours),
    reconcilePublish: async (_storeId, jobId) => ({ id: `mock-${jobId}`, jobId, state: "SUCCEEDED", errorCode: null, seoVersion: 1 }),
    publishStatus: async () => ({ managed: false, operation: null }),
    workerReviewHistory: async () => ({ total: 0, nextOffset: null, entries: [] }),
    createRevision: async (_storeId, jobId, requestId) => ({ jobId: `mock-revision-${requestId}`, previousJobId: jobId }),
    publishReview: async (_storeId, jobId) => ({ id: `mock-${jobId}`, jobId, state: "SUCCEEDED", errorCode: null, seoVersion: 1 }),
    agentAccess: async () => ({ tokens: [], total: 0, nextOffset: null, claimsEnabled: false }),
    agentRuns: async () => ({ runs: [], total: 0, nextOffset: null }),
    createAgentToken: async () => ({ token: "mock-not-a-credential", tokenId: "mock-token", expiresAt: null, isPermanent: true, allStores: true }),
    revokeAgentToken: async () => ({ revoked: true }),
    deleteAgentToken: async () => ({ deleted: true }),
    enableClaims: async () => ({ enabled: true }),
    disableClaims: async () => ({ enabled: false }),
    stores: async () => [
      { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
      { storeId: "chillgen", shopDomain: "bbjttb-n9.myshopify.com" },
      { storeId: "jeminise", shopDomain: "b6-theme-test.myshopify.com" },
    ],
    settings: async () => structuredClone(settings),
    configure: async (_storeId, next) => { settings = { ...next }; return structuredClone(settings); },
    list: async (storeId, offset = 0, filters = {}) => {
      const visible = jobs.filter(job => job.storeId === storeId && job.status !== "CANCELLED" && !job.queueArchivedAt);
      const filtered = visible.filter(job => (!filters.statuses?.length || filters.statuses.includes(job.status)) && (!filters.provider || job.settings.provider === filters.provider));
      const counts: Record<string, number> = {};
      for (const job of visible) counts[job.status] = (counts[job.status] ?? 0) + 1;
      return { jobs: structuredClone(filtered.slice(offset, offset + 50)), filteredCount: filtered.length, counts, activeBatch: null, activeBatches: [], nextOffset: offset + 50 < filtered.length ? offset + 50 : null };
    },
    retryCandidates: async (storeId, provider) => ({ jobIds: jobs.filter(job => job.storeId === storeId && !job.queueArchivedAt && ["FAILED", "WAITING_INPUT", "NEEDS_CHANGES"].includes(job.status) && (!provider || job.settings.provider === provider)).map(job => job.id) }),
    retryBatch: async (storeId, ids, requestId) => ({ outcomes: ids.map(jobId => {
      const key = `${storeId}:${requestId}:${jobId}`;
      const saved = retryReceipts.get(key);
      if (saved) return { ...saved };
      const job = jobs.find(candidate => candidate.id === jobId && candidate.storeId === storeId);
      const canRetry = job && !job.queueArchivedAt && ["FAILED", "WAITING_INPUT", "NEEDS_CHANGES"].includes(job.status);
      if (canRetry) jobs = jobs.map(candidate => candidate.id === jobId && candidate.storeId === storeId ? { ...candidate, status: "PENDING", error: undefined } : candidate);
      const outcome: QueueRetryOutcome = { jobId, status: canRetry ? "retried" : "skipped" };
      retryReceipts.set(key, outcome);
      return { ...outcome };
    }) }),
    reviews: async () => ({ reviews: [], counts: { PENDING: 1 }, nextOffset: null }),
    job: async () => structuredClone(mockJobs[0]),
    enqueue: async () => structuredClone(mockJobs[0]),
    beginSync: async () => ({ token: "mock-sync" }), finishSync: async () => ({}),
    archiveReview: async () => ({ archived: true }),
    transfer: async () => ({}),
    retry: async () => ({}), requeue: async (_storeId, jobIds) => ({ requeued: jobIds.length }), cancelReview: async () => ({ cancelled: true }), clearQueue: async () => ({ cleared: mockJobs.length, archived: 0, preservedActive: 0, preservedFailed: 0 }), release: async () => ({}), reviewState: async () => ({}), saveReviewState: async () => ({}), saveReviewStates: async (_storeId, reviews) => ({ saved: reviews.length }),
  };
}
