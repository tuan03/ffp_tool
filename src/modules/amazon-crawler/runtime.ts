import { clearMockAmazonCrawlerCache, createMockAmazonCrawlerJobLoader, runMockAmazonCrawler } from "./mocks/runner";
import { createAmazonCrawlerCacheClearer, createAmazonCrawlerClientsLoader, createAmazonCrawlerJobLoader, createAmazonCrawlerRunner, createAmazonCrawlerSyncRetrier, createImageProcessingProfileManager } from "./service";

import type { AppEnvironment } from "../../shared/types";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerJobLoader, AmazonCrawlerRunner, AmazonCrawlerSyncRetrier, ImageProcessingProfileManager } from "./types";

export function getAmazonCrawlerRunner(environment: AppEnvironment, engineUrl: string): AmazonCrawlerRunner {
  return environment === "mock" ? runMockAmazonCrawler : createAmazonCrawlerRunner({ engineUrl });
}

export function getAmazonCrawlerClientsLoader(environment: AppEnvironment, engineUrl: string): AmazonCrawlerClientsLoader {
  return environment === "mock"
    ? async () => [{ id: "mock-client", displayName: "Mock crawler", status: "online", isConnected: true, maxConcurrentInputs: 4, activeTasks: 0, leasedTasks: 0, availableSlots: 4, lastSeenAt: new Date(0).toISOString() }]
    : createAmazonCrawlerClientsLoader({ engineUrl });
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
