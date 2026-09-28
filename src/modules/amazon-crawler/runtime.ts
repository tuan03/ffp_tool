import { clearMockAmazonCrawlerCache, createMockAmazonCrawlerJobLoader, runMockAmazonCrawler } from "./mocks/runner";
import { createAmazonCrawlerCacheClearer, createAmazonCrawlerClientsLoader, createAmazonCrawlerJobController, createAmazonCrawlerJobLoader, createAmazonCrawlerReviewClient, createAmazonCrawlerRunner, createAmazonCrawlerSyncRetrier, createImageProcessingProfileManager } from "./service";

import type { AppEnvironment } from "../../shared/types";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerJobController, AmazonCrawlerJobLoader, AmazonCrawlerReviewClient, AmazonCrawlerRunner, AmazonCrawlerSyncRetrier, ImageProcessingProfileManager } from "./types";

export function getAmazonCrawlerRunner(environment: AppEnvironment, engineUrl: string): AmazonCrawlerRunner {
  return environment === "mock" ? runMockAmazonCrawler : createAmazonCrawlerRunner({ engineUrl });
}

export function getAmazonCrawlerClientsLoader(environment: AppEnvironment, engineUrl: string): AmazonCrawlerClientsLoader {
  return environment === "mock"
    ? async () => [{ id: "mock-client", displayName: "Mock crawler", status: "online", isConnected: true, maxConcurrentInputs: 4, activeTasks: 0, leasedTasks: 0, availableSlots: 4, lastSeenAt: new Date(0).toISOString() }]
    : createAmazonCrawlerClientsLoader({ engineUrl });
}

export function getAmazonCrawlerJobController(environment: AppEnvironment, engineUrl: string): AmazonCrawlerJobController {
  if (environment !== "mock") return createAmazonCrawlerJobController({ engineUrl });
  return {
    list: async () => [],
    get: async () => { throw new Error("Mock job was not found."); },
    cancel: async () => { throw new Error("Mock job was not found."); },
    replace: async () => { throw new Error("Mock job was not found."); },
    delete: async () => undefined,
  };
}

export function getAmazonCrawlerCacheClearer(environment: AppEnvironment, engineUrl: string): AmazonCrawlerCacheClearer {
  return environment === "mock" ? clearMockAmazonCrawlerCache : createAmazonCrawlerCacheClearer({ engineUrl });
}

export function getAmazonCrawlerSyncRetrier(environment: AppEnvironment, engineUrl: string): AmazonCrawlerSyncRetrier {
  return environment === "mock" ? async () => ({ retried: 0 }) : createAmazonCrawlerSyncRetrier({ engineUrl });
}

export function getAmazonCrawlerJobLoader(environment: AppEnvironment, engineUrl: string): AmazonCrawlerJobLoader {
  return environment === "mock" ? createMockAmazonCrawlerJobLoader() : createAmazonCrawlerJobLoader({ engineUrl });
}

export function getAmazonCrawlerReviewClient(environment: AppEnvironment, engineUrl: string): AmazonCrawlerReviewClient {
  if (environment !== "mock") return createAmazonCrawlerReviewClient({ engineUrl });
  return {
    list: async () => [],
    subscribe: () => () => undefined,
    update: async () => { throw new Error("Mock review item was not found."); },
    decide: async () => { throw new Error("Mock review item was not found."); },
    sync: async () => { throw new Error("Mock review item was not found."); },
    syncAllApproved: async () => ({ queued: 0, itemIds: [] }),
    markSynced: async () => { throw new Error("Mock review item was not found."); },
    markFailed: async () => { throw new Error("Mock review item was not found."); },
    deleteAll: async () => ({ deleted: 0, skipped: 0 }),
    imageUrl: (fileToken) => fileToken,
  };
}

export function getImageProcessingProfileManager(environment: AppEnvironment, engineUrl: string): ImageProcessingProfileManager {
  if (environment !== "mock") return createImageProcessingProfileManager({ engineUrl });
  const profile = {
    slug: "default", name: "Default image profile", enabled: false, revision: "mock", hasLogo: false,
    randomPixels: 100, pixelDelta: 3, jpegQuality: 92,
    output: { width: 1500, height: 1500, fit: "contain" as const, upscale: true, background: "#ffffff" },
    logo: { enabled: false, width: 120, height: 60, maxPercent: 15, percentBasis: "width" as const, padding: 0, position: "bottom-right" as const, opacity: 1 },
  };
  return {
    list: async () => [{ ...profile }],
    save: async (_slug, value) => ({ ...value }),
    delete: async () => undefined,
    uploadLogo: async (_slug, dataUrl) => ({ ...profile, hasLogo: true, logoUrl: dataUrl }),
    preview: async (_slug, _value, dataUrl) => dataUrl,
  };
}
