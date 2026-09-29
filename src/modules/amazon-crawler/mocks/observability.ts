import type { AmazonCrawlerMetrics } from "../types";

export const crawlerMockMetrics: AmazonCrawlerMetrics = {
  windowStartedAt: "2026-01-01T00:00:00Z", retainedSince: "2026-01-01T12:00:00Z", sampledAt: "2026-01-02T00:00:00Z", jobId: null,
  counts: { familyCacheHits: 3, familyCacheMisses: 7, httpAttempts: 20, httpSuccesses: 18, browserAttempts: 3,
    pageFetches: 20, playwrightFallbacks: 2, captchaAttempts: 1, familyAttempts: 10, partialFamilies: 1,
    parserFailures: 1, networkRetries: 2, taskRetries: 1, retryCount: 3 },
  rates: { cacheHit: 0.3, httpSuccess: 0.9, playwrightFallback: 0.1, captcha: 1 / 23 },
  averageCrawlDurationMs: 30000, queue: { crawl: 4, crawlActive: 2, pipeline: 3 },
  agents: [{ agentId: "mock-agent", displayName: "Mock crawler", cache: { hit: 3, miss: 7, corrupt: 0, evicted: 0 },
    resources: { rssBytes: 128 * 1024 * 1024, browserProcesses: 4, browserContexts: 2, browserPages: 2, processCount: 6, isComplete: true },
    backlog: 0, dropped: 0, sampledAt: "2026-01-02T00:00:00Z" }],
};
