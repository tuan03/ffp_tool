import { clearMockAmazonCrawlerCache, runMockAmazonCrawler } from "./mocks/runner";
import { createAmazonCrawlerCacheClearer, createAmazonCrawlerRunner } from "./service";

import type { AppEnvironment } from "../../shared/types";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerRunner } from "./types";

export function getAmazonCrawlerRunner(environment: AppEnvironment, engineUrl: string): AmazonCrawlerRunner {
  return environment === "mock" ? runMockAmazonCrawler : createAmazonCrawlerRunner({ engineUrl });
}

export function getAmazonCrawlerCacheClearer(environment: AppEnvironment, engineUrl: string): AmazonCrawlerCacheClearer {
  return environment === "mock" ? clearMockAmazonCrawlerCache : createAmazonCrawlerCacheClearer({ engineUrl });
}
