import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { createWorkerSourceGuard } from "../seo-worker/source-guard";

test("source guard reads live Shopify and fails closed on changed, deleted or unversioned source", async () => {
  const original = { updatedAt: "v1" };
  const job = { storeId: "demo", source: "auto_seo", sourceIdentity: "123", original,
    execution: { storeId: "demo", source: "auto_seo", sourceIdentity: "123", productId: "123", providerId: "codex_mcp", pipelineVersion: "v2", originalSnapshot: original },
    input: { images: [{ id: "image-1", url: "https://cdn.shopify.com/image.webp" }], niche: "bedding",
      storeProfile: { profileId: "demo", profileVersion: "2", storeId: "demo", storeName: "Demo", locale: "en-US", language: "English", niche: "bedding", brandVoice: [], contentRules: [], prohibitedClaims: [], seoConstraints: { maxTitleCharacters: 70, maxDescriptionCharacters: 160, maxAltCharacters: 125 } } },
    id: "job", inputHash: "hash", settings: { provider: "codex_mcp", batchSize: 1, version: 1, language: "en", instructions: "" }, status: "PENDING", checkpoints: {}, createdAt: 1, updatedAt: 1 } as GptSeoJob;
  let product: { updatedAt: string } | null = { updatedAt: "v1" };
  const guard = createWorkerSourceGuard({ dispatch: async request => {
    assert.equal(request.storeId, "demo"); assert.equal(request.operation, "products.get");
    assert.deepEqual(request.payload, { id: "gid://shopify/Product/123" });
    return { success: true, storeId: "demo", operation: "products.get", data: { product } };
  } });
  await guard(job);
  product = { updatedAt: "v2" }; await assert.rejects(guard(job), /STALE_SOURCE/);
  product = null; await assert.rejects(guard(job), /PRODUCT_DELETED/);
  await assert.rejects(guard({ ...job, execution: { ...job.execution, originalSnapshot: {} } }), /SOURCE_VERSION_REQUIRED/);
});
