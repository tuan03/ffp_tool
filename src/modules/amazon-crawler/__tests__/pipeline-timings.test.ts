import assert from "node:assert/strict";
import test from "node:test";

import { formatPipelineTimings } from "../ui/pipeline-timings";

test("SEO performance remains visible before Shopify sync and supports older records", () => {
  assert.deepEqual(formatPipelineTimings(), []);
  const labels = formatPipelineTimings(undefined, {
    stageDurationsMs: { b1: 2100, b4: 100 }, providerQueueMs: 400,
    requestCount: 5, cacheHits: 3, revisionRetries: 2, commitQueueMs: 20,
  });
  assert.ok(labels.includes("SEO B1: 2.10s"));
  assert.ok(labels.includes("Chờ slot AI/Suggest: 400ms"));
  assert.ok(labels.includes("Cache hit: 3"));
  assert.ok(labels.includes("Tính lại B4: 2"));
});

test("formatPipelineTimings shows SEO queue, SEO execution and Shopify sub-step durations", () => {
  const labels = formatPipelineTimings({
    pipeline: {
      normalizationMs: 2,
      shopifyResolveMs: 150,
      seoInitialMs: 1_200,
      seoQueueWaitMs: 300,
      seoRebaseMs: 800,
      shopifySyncMs: 900,
      totalMs: 3_352,
    },
    shopify: {
      productWriteMs: 400,
      variantsMs: 20,
      assetUploadMs: 350,
      metafieldMs: 100,
      totalMs: 870,
    },
  });

  assert.ok(labels.includes("SEO lần đầu: 1.20s"));
  assert.ok(labels.includes("Chờ SEO corpus: 300ms"));
  assert.ok(labels.includes("SEO chạy lại: 800ms"));
  assert.ok(labels.includes("Shopify ghi product: 400ms"));
  assert.ok(labels.includes("Tổng pipeline: 3.35s"));
});
