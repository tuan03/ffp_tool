import { amazonCrawlerMockOutput } from "./data";

import type {
  AmazonCrawlerCacheClearResult,
  AmazonCrawlerHydratedJob,
  AmazonCrawlerJobLoader,
  AmazonCrawlerJobSummary,
  AmazonCrawlerOutput,
  AmazonCrawlerRunOptions,
} from "../types";

export async function clearMockAmazonCrawlerCache(): Promise<AmazonCrawlerCacheClearResult> {
  return { removedFiles: 0, removedBytes: 0 };
}

export async function runMockAmazonCrawler({
  input,
  onProgress,
  signal,
}: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> {
  if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
  const source = input.urls[0] ?? "B0MOCK0001";
  onProgress?.({
    phase: "product",
    completed: 1,
    total: 1,
    message: "Mock crawl completed.",
    source,
    items: [{
      source,
      asin: "B0MOCK0001",
      phase: "product",
      status: "completed",
      message: "Đã cào variant 3/3: Size: Queen (B0MOCK0003)",
      variantCompleted: 3,
      variantTotal: 3,
      currentAsin: "B0MOCK0003",
      currentOptions: { Size: "Queen" },
      activeVariants: [],
    }],
  });
  const mockSettings = {
    profileSlug: input.profileSlug,
    imageProfileSlug: input.imageProfileSlug,
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

export function createMockAmazonCrawlerJobLoader(): AmazonCrawlerJobLoader {
  return {
    async loadJob(jobId?: string): Promise<AmazonCrawlerHydratedJob | null> {
      return {
        jobId: jobId || "mock-job-001",
        status: "completed",
        products: [...amazonCrawlerMockOutput.products],
        output: structuredClone(amazonCrawlerMockOutput),
        settings: { ...amazonCrawlerMockOutput.settings },
      };
    },
    async listRecentJobs(): Promise<AmazonCrawlerJobSummary[]> {
      return [
        {
          id: "mock-job-001",
          status: "completed",
          createdAt: new Date().toISOString(),
          acceptedInputs: 1,
        },
      ];
    },
  };
}
