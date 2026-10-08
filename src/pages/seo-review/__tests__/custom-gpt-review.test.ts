import assert from "node:assert/strict";
import test from "node:test";

import { adaptCustomGptReview, loadAllCustomGptReviewRecords } from "../custom-gpt-review";
import type { GptSeoJob } from "../../../modules/custom-gpt-seo";

test("reload repairs saved legacy image IDs without replacing approval, ALT or revision", () => {
  const original = { title: "Bag", images: [{ id: "gid://shopify/MediaImage/12", url: "https://cdn.shopify.com/bag.jpg" }] };
  const job: GptSeoJob = {
    id: "job-1", storeId: "demo", source: "auto_seo", sourceIdentity: "123", original,
    inputHash: "hash", status: "REVIEW_READY", checkpoints: {}, createdAt: 1, updatedAt: 2,
    settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "en", instructions: "" },
    input: { images: original.images, niche: "Bags", storeProfile: {
      profileId: "demo", profileVersion: "1", storeId: "demo", storeName: "Demo", locale: "en-US", language: "en",
      niche: "Bags", brandVoice: [], contentRules: [], prohibitedClaims: [],
      seoConstraints: { maxTitleCharacters: 70, maxDescriptionCharacters: 160, maxAltCharacters: 125 },
    } },
    execution: { storeId: "demo", source: "auto_seo", sourceIdentity: "123", productId: "123", providerId: "codex_mcp", pipelineVersion: "v2", originalSnapshot: original },
    result: { output: { productTitle: "Bag", images: [{ sourceUrl: original.images[0]?.url, alt: "Generated ALT" }] } },
  };
  const generated = adaptCustomGptReview(job);
  assert.equal(generated.images[0]?.id, "gid://shopify/MediaImage/12");
  const saved = { ...generated, reviewDecision: "approved", updatedAt: 42, images: generated.images.map(image => ({ ...image, id: "img-0-old", alt: { value: "Edited ALT", source: "real" } })) };
  const restored = adaptCustomGptReview(job, saved);
  assert.equal(restored.images[0]?.id, "gid://shopify/MediaImage/12");
  assert.equal(restored.images[0]?.alt.value, "Edited ALT");
  assert.equal(restored.reviewDecision, "approved");
  assert.equal(restored.updatedAt, 42);
});

test("loads every custom GPT review page instead of stopping at 50 records", async () => {
  const requestedOffsets: number[] = [];
  const reviews = await loadAllCustomGptReviewRecords({
    async reviews(storeId: string, offset: number) {
      assert.equal(storeId, "jeminise-real");
      requestedOffsets.push(offset);
      return offset === 0
        ? { reviews: Array.from({ length: 50 }, (_, index) => index), nextOffset: 50 }
        : { reviews: Array.from({ length: 50 }, (_, index) => index + 50), nextOffset: null };
    },
  }, "jeminise-real");

  assert.deepEqual(requestedOffsets, [0, 50]);
  assert.equal(reviews.length, 100);
  assert.equal(reviews[99], 99);
});
