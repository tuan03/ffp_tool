import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPublishTransport } from "../seo-worker/publish-transport";
import type { PublishOperation } from "../seo-worker/publish-repository";

test("publish transport sends only approved content with a live version guard", async () => {
  const op: PublishOperation = { id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "WRITING", leaseId: "lease", seoVersion: null, errorCode: null,
    fields: { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" }, images: [{ id: "gid://shopify/MediaImage/1", altText: "Verified image" }] } };
  let writes = 0;
  const transport = createSeoPublishTransport({ dispatch: async request => {
    assert.equal(request.storeId, "demo");
    if (request.operation === "products.update") {
      writes++;
      assert.deepEqual(request.payload, { id: "gid://shopify/Product/123", expectedUpdatedAt: "v1", product: op.fields });
      assert.equal(request.requestId, "seo-publish-receipt");
      return { success: true, storeId: "demo", operation: request.operation, data: {} };
    }
    return { success: true, storeId: "demo", operation: request.operation, data: { product: { updatedAt: "v1", ...op.fields } } };
  } });
  assert.deepEqual(await transport.read(op), { version: "v1", fields: op.fields });
  await transport.write(op);
  assert.equal(writes, 1);
});
