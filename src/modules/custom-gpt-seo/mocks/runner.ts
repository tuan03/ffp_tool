import type { CustomGptClient } from "../service";
import { mockJobs, mockSettings } from "./data";

export function createMockCustomGptClient(): CustomGptClient {
  let settings = structuredClone(mockSettings);
  return {
    settings: async () => structuredClone(settings),
    configure: async (_storeId, next) => { settings = { ...next }; return structuredClone(settings); },
    list: async () => ({ jobs: structuredClone(mockJobs), counts: { PENDING: 1 }, activeBatch: null, nextOffset: 50 }),
    job: async () => structuredClone(mockJobs[0]),
    beginSync: async () => ({ token: "mock-sync" }), finishSync: async () => ({}),
    transfer: async () => ({}),
    enqueue: async input => ({ ...structuredClone(mockJobs[0]), ...input }),
    retry: async () => ({}), release: async () => ({}), reviewState: async () => ({}), saveReviewState: async () => ({}),
  };
}
