import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPublishTransport } from "../seo-worker/publish-transport";
import type { PublishOperation } from "../seo-worker/publish-repository";

test("publish refuses corrupt or incorrectly typed Shopify SEO versions", async () => {
  for (const metafield of [{ value: "-1", type: "number_integer" }, { value: "1.5", type: "number_integer" }, { value: "7", type: "single_line_text_field" }, { value: "9007199254740992", type: "number_integer" }]) {
    const fields = { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" } };
    const transport = createSeoPublishTransport({ dispatch: async request => ({ success: true, storeId: "demo", operation: request.operation,
      data: request.operation === "metafields.get" ? metafield : { product: { ...fields, updatedAt: "v1" } } }) });
    await assert.rejects(transport.read({ id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "CHECKING", leaseId: "lease", seoVersion: null, errorCode: null, fields }), /INVALID_SEO_VERSION/);
  }
});

test("publish transport sends only approved content with a live version guard", async () => {
  const op: PublishOperation = { id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "WRITING", leaseId: "lease", seoVersion: null, errorCode: null,
    fields: { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" }, images: [{ id: "gid://shopify/MediaImage/1", altText: "Verified image" }] } };
  let writes = 0;
  const transport = createSeoPublishTransport({ dispatch: async request => {
    assert.equal(request.storeId, "demo");
    if (request.operation === "metafields.get") return { success: true, storeId: "demo", operation: request.operation, data: { value: null } };
    if (request.operation === "products.update") {
      writes++;
      assert.deepEqual(request.payload, { id: "gid://shopify/Product/123", expectedUpdatedAt: "v1", product: op.fields });
      assert.equal(request.requestId, "seo-publish-receipt");
      return { success: true, storeId: "demo", operation: request.operation, data: {} };
    }
    return { success: true, storeId: "demo", operation: request.operation, data: { product: { updatedAt: "v1", ...op.fields } } };
  } });
  assert.deepEqual(await transport.read(op), { version: "v1", seoVersion: 0, fields: op.fields });
  await transport.write(op);
  assert.equal(writes, 1);
});

test("publish read-back uses the actual metafield type rather than assuming the intended type", async () => {
  const fields = { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" }, metafields: [{ namespace: "custom", key: "aeo_faq", type: "json", value: "[]" }] };
  const transport = createSeoPublishTransport({ dispatch: async request => ({ success: true, storeId: "demo", operation: request.operation,
    data: request.operation === "metafields.get" ? ((request.payload as { key: string }).key === "seo_version" ? { value: "7", type: "number_integer" } : { value: "[]", type: "multi_line_text_field" }) : { product: { ...fields, updatedAt: "v1" } },
  }) });
  const actual = await transport.read({ id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "UNCERTAIN", leaseId: "lease", seoVersion: null, errorCode: null, fields });
  assert.equal(actual.fields.metafields?.[0].type, "multi_line_text_field");
});
