import type { CustomGptClient } from "../service";
import { mockJobs, mockSettings } from "./data";

export function createMockCustomGptClient(): CustomGptClient {
  let settings = structuredClone(mockSettings);
  return {
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
    beginSync: async () => ({ token: "mock-sync" }), finishSync: async () => ({}),
    transfer: async () => ({}),
    enqueue: async input => ({ ...structuredClone(mockJobs[0]), ...input }),
    retry: async () => ({}), cancelReview: async () => ({ cancelled: true }), release: async () => ({}), reviewState: async () => ({}), saveReviewState: async () => ({}), saveReviewStates: async (_storeId, reviews) => ({ saved: reviews.length }),
  };
}
