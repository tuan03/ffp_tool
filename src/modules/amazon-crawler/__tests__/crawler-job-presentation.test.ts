import assert from "node:assert/strict";
import test from "node:test";

import type { AmazonCrawlerJobSnapshot } from "../types";
import { resolveCrawlerJobPresentation } from "../ui/crawler-job-presentation";

function job(overrides: Partial<AmazonCrawlerJobSnapshot> = {}): AmazonCrawlerJobSnapshot {
  return {
    jobId: "job-1",
    status: "running",
    executionState: "active",
    progress: { phase: "product", completed: 0, total: 1, message: "" },
    result: null,
    error: null,
    inputs: ["B012345678"],
    settings: {} as AmazonCrawlerJobSnapshot["settings"],
    createdAt: "2026-10-08T00:00:00Z",
    startedAt: null,
    completedAt: null,
    replacementOfJobId: null,
    cancellation: {
      id: null, requestedAt: null, pendingAgents: [], pendingPipeline: [], pendingPipelineItems: 0,
      pendingCleanupAgents: [], cacheGeneration: null, isExecutionConfirmed: false,
    },
    ...overrides,
  };
}

test("finished family containing only existing Shopify products is not reported as handed over", () => {
  const presentation = resolveCrawlerJobPresentation(job({ status: "completed",
    seoQueueHandoff: { totalProducts: 0, handedOver: 0, pending: 0, notHandedOver: 0,
      skippedExistingShopify: 10, totalDetected: 10 } }));
  assert.equal(presentation.label, "Đã kiểm tra · bỏ qua 10 sản phẩm đã có trên Shopify");
  assert.equal(presentation.hasReachedSeoQueue, false);
});

test("completed crawl with pending queue work is no longer presented as crawling", () => {
  const presentation = resolveCrawlerJobPresentation(job({
    progress: { phase: "seo", completed: 1, total: 1, message: "" },
    seoQueueHandoff: { totalProducts: 1, handedOver: 0, pending: 1, notHandedOver: 0 },
  }));
  assert.equal(presentation.label, "Đang bàn giao SEO Queue · 0/1 sản phẩm");
  assert.equal(presentation.canPause, false);
  assert.equal(presentation.canCancel, true);
});

test("durable queue handoff hides crawler pause and cancel controls", () => {
  const presentation = resolveCrawlerJobPresentation(job({
    status: "review_pending",
    progress: { phase: "seo", completed: 1, total: 1, message: "" },
    seoQueueHandoff: { totalProducts: 1, handedOver: 1, pending: 0, notHandedOver: 0 },
  }));
  assert.equal(presentation.label, "Đã bàn giao SEO Queue · 1/1 sản phẩm");
  assert.equal(presentation.hasReachedSeoQueue, true);
  assert.equal(presentation.canPause, false);
  assert.equal(presentation.canCancel, false);
});

test("mixed handoff outcome is presented as partial", () => {
  const presentation = resolveCrawlerJobPresentation(job({
    status: "review_pending",
    seoQueueHandoff: { totalProducts: 3, handedOver: 2, pending: 0, notHandedOver: 1 },
  }));
  assert.equal(presentation.label, "Bàn giao một phần · 2/3 sản phẩm");
  assert.equal(presentation.tone, "warning");
});
