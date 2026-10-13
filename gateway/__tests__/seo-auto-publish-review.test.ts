import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { buildAutomaticSeoReview } from "../seo-worker/auto-publish-review";

import { createTestEnqueue } from "./seo-v2-fixtures";

function job(original: unknown): GptSeoJob {
  const enqueue = createTestEnqueue({ storeId: "demo", productId: "123", original, autoPublishAfterSeo: true });
  return {
    ...enqueue,
    id: "job",
    storeId: "demo",
    source: "auto_seo",
    sourceIdentity: "123",
    original,
    inputHash: "hash",
    settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "en-US", instructions: "" },
    status: "VALIDATING",
    checkpoints: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

const output = {
  output: {
    productTitle: "Automatic title",
    productDescription: "<p>Automatic description</p>",
    productSeoTitle: "Automatic SEO title",
    productSeoDescription: "Automatic SEO description",
    images: [{
      sourceUrl: "https://cdn.shopify.com/image.jpg?width=1200",
      alt: "Automatic alt",
    }],
    aeo_quick_summary: "Automatic summary",
    aeo_faq: [{ question: "What is it?", answer: "A test product." }],
    aeo_json_ld: "{\"@context\":\"https://schema.org\",\"@graph\":[]}",
  },
};

test("automatic Review maps finalized SEO, AEO and Shopify media identity", () => {
  const review = buildAutomaticSeoReview(job({
    updatedAt: "v1",
    images: [{ id: "gid://shopify/MediaImage/456", url: "https://cdn.shopify.com/image.jpg" }],
  }), output, 1234);

  assert.equal(review.reviewDecision, "approved");
  assert.equal(review.approvalSource, "automatic_policy");
  assert.equal(review.updatedAt, 1234);
  assert.deepEqual(review.images, [{ id: "gid://shopify/MediaImage/456", alt: { value: "Automatic alt" } }]);
  assert.equal(review.aeoQuickSummary?.value, "Automatic summary");
});

test("automatic Review fails closed when an SEO image cannot be matched to Shopify media", () => {
  assert.throws(() => buildAutomaticSeoReview(job({ updatedAt: "v1", images: [] }), output, 1234),
    /REVIEW_IMAGE_MAPPING_REQUIRED/);
});
