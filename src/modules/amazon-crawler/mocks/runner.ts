import { amazonCrawlerMockOutput } from "./data";

import type { AmazonCrawlerOutput, AmazonCrawlerRunOptions } from "../types";

export async function runMockAmazonCrawler({
  input,
  onProgress,
  signal,
}: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> {
  if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
  onProgress?.({ phase: "product", completed: 1, total: 1, message: "Mock crawl completed." });
  const mockSettings = {
    profileSlug: input.profileSlug,
    applyJeminisePreset: input.applyJeminisePreset,
    productThreads: input.productThreads,
    variantThreads: input.variantThreads,
    urllibThreads: input.urllibThreads,
    browserProfiles: input.browserProfiles,
    browserTabs: input.browserTabs,
    headless: input.headless,
    amazonZip: input.amazonZip,
    captchaTimeoutSeconds: input.captchaTimeoutSeconds,
    maxMatrixVariants: input.maxMatrixVariants,
  };
  const output = structuredClone(amazonCrawlerMockOutput);
  output.settings = mockSettings;
  return output;
}
