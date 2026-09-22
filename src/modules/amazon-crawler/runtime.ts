import { clearMockAmazonCrawlerCache, runMockAmazonCrawler } from "./mocks/runner";
import { createAmazonCrawlerCacheClearer, createAmazonCrawlerClientsLoader, createAmazonCrawlerRunner } from "./service";

import type { AppEnvironment } from "../../shared/types";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerRunner } from "./types";

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
