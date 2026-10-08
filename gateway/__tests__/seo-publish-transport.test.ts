import assert from "node:assert/strict";
import test from "node:test";

import { createSeoPublishTransport } from "../seo-worker/publish-transport";
import { GatewayDispatcher, GatewayError, InMemoryStoreRegistry, InMemoryThrottleManager, ShopifyGraphqlClient, StaticAccessTokenProvider } from "../index";
import type { PublishOperation } from "../seo-worker/publish-repository";

test("publish uses apply mode through the real Gateway dispatcher and preserves idempotency", async () => {
  let writes = 0;
  const metafields = [
    { namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: "Summary" },
    { namespace: "custom", key: "aeo_faq", type: "json", value: "[]" },
    { namespace: "custom", key: "aeo_json_ld", type: "json", value: '{"@graph":[]}' },
    { namespace: "custom", key: "seo_version", type: "number_integer", value: "1" },
  ];
  const client = new ShopifyGraphqlClient({ tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { product?: { id: string; title: string; metafields?: unknown } } };
      const product = { id: "gid://shopify/Product/123", title: "Title", handle: "bag", updatedAt: "v1", tags: [], variants: { nodes: [] }, images: { nodes: [] } };
      if (body.query.includes("mutation")) {
        writes++;
        assert.equal(body.variables.product?.title, "Title");
        assert.deepEqual(body.variables.product?.metafields, metafields);
        return new Response(JSON.stringify({ data: { productUpdate: { product, userErrors: [] } } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: { product } }), { status: 200 });
    } });
  const dispatcher = new GatewayDispatcher({ graphqlClient: client, storeRegistry: new InMemoryStoreRegistry([
    { storeId: "demo", shopDomain: "demo.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "test-only" } },
  ]) });
  const transport = createSeoPublishTransport(dispatcher);
  const op: PublishOperation = { id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "WRITING", leaseId: "lease", seoVersion: null, errorCode: null,
    fields: { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" }, metafields } };
  await transport.write(op);
  await transport.write(op);
  assert.equal(writes, 1);
  await assert.rejects(dispatcher.dispatch({ storeId: "demo", operation: "products.update", mode: "apply", requestId: "invalid-metafield",
    payload: { id: "gid://shopify/Product/123", product: { title: "Title", metafields: [{ namespace: "custom", key: "seo_version", type: "number_integer", value: 2 }] } } }),
  error => error instanceof GatewayError && error.code === "SHOPIFY_INVALID_INPUT" && !error.reconciliationRequired);
  assert.equal(writes, 1);
});

test("publish distinguishes a definite input rejection from an unknown write outcome", async () => {
  const op: PublishOperation = { id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "WRITING", leaseId: "lease", seoVersion: null, errorCode: null,
    fields: { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" } } };
  const rejected = createSeoPublishTransport({ dispatch: async () => { throw new GatewayError("Input rejected", "SHOPIFY_INVALID_INPUT", 400); } });
  await assert.rejects(rejected.write(op), /PUBLISH_INPUT_REJECTED/);
  const uncertainError = new GatewayError("Unknown write", "SHOPIFY_UNKNOWN_WRITE_STATE", 409);
  const uncertain = createSeoPublishTransport({ dispatch: async () => { throw uncertainError; } });
  await assert.rejects(uncertain.write(op), error => error === uncertainError);
  const partialError = new GatewayError("Partial write", "SHOPIFY_INVALID_INPUT", 400, undefined, undefined, undefined, false, undefined, true);
  await assert.rejects(createSeoPublishTransport({ dispatch: async () => { throw partialError; } }).write(op), error => error === partialError);
});

test("publish refuses a media ID absent from the current product without writing", async () => {
  let writes = 0;
  const fields = { title: "Title", descriptionHtml: "Description", seo: { title: "SEO", description: "Meta" }, images: [{ id: "gid://shopify/MediaImage/1", altText: "Approved ALT" }] };
  const transport = createSeoPublishTransport({ dispatch: async request => {
    if (request.operation === "products.update") writes++;
    return { success: true, storeId: "demo", operation: request.operation, data: request.operation === "metafields.get"
      ? { value: null } : { product: { ...fields, updatedAt: "v1", images: [{ id: "gid://shopify/MediaImage/2", altText: "Other" }] } } };
  } });
  await assert.rejects(transport.read({ id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "CHECKING", leaseId: "lease", seoVersion: null, errorCode: null, fields }), /SOURCE_IMAGE_MISSING/);
  assert.equal(writes, 0);
});

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
      assert.equal(request.mode, "apply");
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
