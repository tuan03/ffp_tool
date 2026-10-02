import assert from "node:assert/strict";
import test from "node:test";

import { createPerformanceRevision } from "../seo-performance-revision";
import type { GptSeoEnqueue } from "../../custom-gpt-seo";

const recommendation = { requestId: "r1", url: "https://demo.example/products/blanket", snapshotId: "snapshot", rulesVersion: "v1", issue: "Title lacks specific motif", evidence: ["source title"], proposed: "Use grounded motif", rationale: "Align with intent", risk: "CTR may vary", priority: "medium" as const, confidence: "medium" as const, startDate: "2026-01-01", endDate: "2026-01-28" };
const product = { id: "gid://shopify/Product/123", title: "Blanket", handle: "blanket", updatedAt: "2026-01-01T00:00:00Z", images: [], variants: [] };
test("Performance revision checks live source and creates a new fenced Codex job without publishing", async () => {
  const enqueued: GptSeoEnqueue[] = [];
  const result = await createPerformanceRevision({ storeId: "demo", recommendationId: "rec1", recommendation, source: product }, {
    loadProduct: async () => product,
    prepareInput: () => ({ title: "Blanket", handle: "blanket", description: "Grounded facts", niche: "Blankets", productId: "123", images: [] }),
    settings: async () => ({ provider: "gemini", version: 2, batchSize: 5, language: "en-US", instructions: "Grounded facts only" }),
    enqueue: async input => { enqueued.push(input); return { id: "new-job" }; },
  });
  assert.equal(result.jobId, "new-job");
  assert.equal(enqueued[0].sourceRevision, "performance:rec1");
  assert.equal(enqueued[0].performanceRecommendationId, "rec1");
  assert.equal(enqueued[0].settings?.provider, "codex_mcp");
  assert.match(enqueued[0].settings?.instructions ?? "", /untrusted evidence/);
});
test("Performance revision rejects stale Shopify content before queueing", async () => {
  await assert.rejects(createPerformanceRevision({ storeId: "demo", recommendationId: "rec1", recommendation, source: product }, {
    loadProduct: async () => ({ ...product, updatedAt: "2026-02-01" }),
    prepareInput: () => { throw new Error("must not map stale source"); },
    settings: async () => { throw new Error("must not reach settings"); }, enqueue: async () => { throw new Error("must not enqueue"); },
  }), /STALE_SHOPIFY_SOURCE/);
});
