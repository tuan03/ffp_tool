import type { CustomGptClient } from "../service";
import { mockJobs, mockSettings } from "./data";
import { mockWorkerMetrics } from "./worker-metrics";

export function createMockCustomGptClient(): CustomGptClient {
  let settings = structuredClone(mockSettings);
  return {
    workerMetrics: async (_storeId, hours = 24) => mockWorkerMetrics(hours),
    reconcilePublish: async (_storeId, jobId) => ({ id: `mock-${jobId}`, jobId, state: "SUCCEEDED", errorCode: null, seoVersion: 1 }),
    publishStatus: async () => ({ managed: false, operation: null }),
    workerReviewHistory: async () => ({ total: 0, nextOffset: null, entries: [] }),
    createRevision: async (_storeId, jobId, requestId) => ({ jobId: `mock-revision-${requestId}`, previousJobId: jobId }),
    publishReview: async (_storeId, jobId) => ({ id: `mock-${jobId}`, jobId, state: "SUCCEEDED", errorCode: null, seoVersion: 1 }),
    agentAccess: async () => ({ tokens: [], total: 0, nextOffset: null, claimsEnabled: false }),
    agentRuns: async () => ({ runs: [], total: 0, nextOffset: null }),
    createAgentToken: async () => ({ token: "mock-not-a-credential", tokenId: "mock-token", expiresAt: 0 }),
    revokeAgentToken: async () => ({ revoked: true }),
    deleteAgentToken: async () => ({ deleted: true }),
    stores: async () => [
      { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
      { storeId: "chillgen", shopDomain: "bbjttb-n9.myshopify.com" },
      { storeId: "jeminise", shopDomain: "b6-theme-test.myshopify.com" },
    ],
    settings: async () => structuredClone(settings),
    configure: async (_storeId, next) => { settings = { ...next }; return structuredClone(settings); },
    list: async () => ({ jobs: structuredClone(mockJobs), counts: { PENDING: 1 }, activeBatch: null, activeBatches: [], nextOffset: 50 }),
    reviews: async () => ({ reviews: [], counts: { PENDING: 1 }, nextOffset: null }),
    job: async () => structuredClone(mockJobs[0]),
    enqueue: async () => structuredClone(mockJobs[0]),
    beginSync: async () => ({ token: "mock-sync" }), finishSync: async () => ({}),
    transfer: async () => ({}),
    retry: async () => ({}), requeue: async (_storeId, jobIds) => ({ requeued: jobIds.length }), cancelReview: async () => ({ cancelled: true }), release: async () => ({}), reviewState: async () => ({}), saveReviewState: async () => ({}), saveReviewStates: async (_storeId, reviews) => ({ saved: reviews.length }),
  };
}
