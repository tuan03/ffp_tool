import type { AmazonCrawlerCacheClearer, AmazonCrawlerCacheClearResult } from "../types";

import { resetCrawlerOutput } from "./crawler-session";

export async function clearCrawlerCacheAndOutput(
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer,
): Promise<AmazonCrawlerCacheClearResult> {
  const clearResult = await clearAmazonCrawlerCache();
  resetCrawlerOutput();
  return clearResult;
}
