import assert from "node:assert/strict";
import test from "node:test";

import type { AmazonCrawlerProduct, ProductPipelineMetadata } from "../types";
import {
  crawlerSeoHandoffLabel,
  crawlerSeoHandoffState,
  resolveCrawlerSeoHandoffSummary,
  summarizeCrawlerSeoHandoffs,
} from "../ui/pipeline-status";

function pipeline(overrides: Partial<ProductPipelineMetadata> = {}): ProductPipelineMetadata {
  return {
    status: "retry_wait",
    normalization: { status: "completed", assetsNormalized: 1 },
    seo: { status: "pending", engine: "codex_mcp" },
    imageProcessing: { status: "pending" },
    shopify: { attempts: 0 },
    ...overrides,
  };
}

test("crawler treats a durable external SEO job as the end of its responsibility", () => {
  const handedOver = pipeline();
  assert.equal(crawlerSeoHandoffState(handedOver), "handed_over");
  assert.equal(crawlerSeoHandoffLabel(handedOver), "Đã bàn giao SEO Queue");
});

test("crawler keeps the handoff complete while SEO, images, review, and Shopify continue", () => {
  const downstreamStatuses: readonly ProductPipelineMetadata["status"][] = [
    "image_processing", "waiting_review", "sync_queued", "syncing", "shopify_writing", "completed",
  ];

  for (const status of downstreamStatuses) {
    assert.equal(crawlerSeoHandoffState(pipeline({
      status,
      seo: { status: "completed", engine: "codex_mcp" },
      imageProcessing: { status: status === "image_processing" ? "running" : "completed" },
    })), "handed_over");
  }
});

test("crawler summary reports only SEO Queue handoff progress", () => {
  const products = [
    { pipeline: pipeline() },
    { pipeline: pipeline({ status: "received", seo: { status: "pending" } }) },
    { pipeline: pipeline({ status: "seo", seo: { status: "running" } }) },
    { pipeline: pipeline({ status: "failed", seo: { status: "failed" } }) },
  ] as AmazonCrawlerProduct[];
  assert.deepEqual(summarizeCrawlerSeoHandoffs(products), {
    handedOver: 1,
    pending: 2,
    notHandedOver: 1,
  });
});

test("crawler does not reclassify a downstream failure after queue handoff", () => {
  const downstreamFailure = pipeline({ status: "failed", seo: { status: "completed", engine: "codex_mcp" } });
  assert.equal(crawlerSeoHandoffState(downstreamFailure), "handed_over");
  assert.equal(crawlerSeoHandoffLabel(downstreamFailure), "Đã bàn giao SEO Queue");
});

test("crawler prefers the durable coordinator handoff count when product details are not loaded", () => {
  assert.deepEqual(resolveCrawlerSeoHandoffSummary([], {
    totalProducts: 3,
    handedOver: 3,
    pending: 0,
    notHandedOver: 0,
  }), {
    totalProducts: 3,
    handedOver: 3,
    pending: 0,
    notHandedOver: 0,
  });
});
