import { runMockAmazonCrawler } from "./mocks/runner";
import { createAmazonCrawlerRunner } from "./service";

import type { AppEnvironment } from "../../shared/types";
import type { AmazonCrawlerRunner } from "./types";

export function getAmazonCrawlerRunner(environment: AppEnvironment, engineUrl: string): AmazonCrawlerRunner {
  return environment === "mock" ? runMockAmazonCrawler : createAmazonCrawlerRunner({ engineUrl });
}
