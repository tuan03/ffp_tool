import assert from "node:assert/strict";
import test from "node:test";

import type { GptSeoJob } from "../../src/modules/custom-gpt-seo";
import { createWorkerSourceGuard } from "../seo-worker/source-guard";

test("source guard reads live Shopify and fails closed on changed, deleted or unversioned source", async () => {
  const job = { storeId: "demo", source: "auto_seo", sourceIdentity: "123", input: { productId: "123" }, original: { updatedAt: "v1" } } as GptSeoJob;
  let product: { updatedAt: string } | null = { updatedAt: "v1" };
  const guard = createWorkerSourceGuard({ dispatch: async request => {
    assert.equal(request.storeId, "demo"); assert.equal(request.operation, "products.get");
    assert.deepEqual(request.payload, { id: "gid://shopify/Product/123" });
    return { success: true, storeId: "demo", operation: "products.get", data: { product } };
  } });
  await guard(job);
  product = { updatedAt: "v2" }; await assert.rejects(guard(job), /STALE_SOURCE/);
  product = null; await assert.rejects(guard(job), /PRODUCT_DELETED/);
  await assert.rejects(guard({ ...job, original: {} }), /SOURCE_VERSION_REQUIRED/);
});
