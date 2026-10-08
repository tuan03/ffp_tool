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
    { namespace: "custom", key: "aeo_suite_html", type: "multi_line_text_field", value: "<section>Summary</section>" },
    { namespace: "custom", key: "aeo_json_ld", type: "json", value: '{"@graph":[]}' },
    { namespace: "custom", key: "seo_version", type: "number_integer", value: "1" },
  ];
  const client = new ShopifyGraphqlClient({ tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { product?: { id: string; title: string; metafields?: unknown }; identifier?: { key: string } } };
      if (body.query.includes("query MetafieldDefinition")) {
        return new Response(JSON.stringify({ data: { metafieldDefinition: { id: "gid://shopify/MetafieldDefinition/1", namespace: "custom", key: body.variables.identifier?.key,
          type: { name: body.variables.identifier?.key === "aeo_suite_html" ? "multi_line_text_field" : "json" } } } }));
      }
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

test("Auto SEO ensures AEO definitions in a new store and does not repeat creation or product writes", async () => {
  const definitions = new Map<string, { id: string; namespace: string; key: string; type: { name: string } }>();
  let creations = 0;
  let productWrites = 0;
  const client = new ShopifyGraphqlClient({ tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string; variables: { identifier?: { key: string }; definition?: { key: string; namespace: string; type: string; ownerType: string; pin: boolean }; product?: { metafields: { key: string }[] } } };
      if (body.query.includes("query MetafieldDefinition")) {
        return new Response(JSON.stringify({ data: { metafieldDefinition: definitions.get(body.variables.identifier?.key ?? "") ?? null } }));
      }
      if (body.query.includes("mutation MetafieldDefinitionCreate")) {
        const input = body.variables.definition;
        assert.ok(input);
        assert.equal(input.ownerType, "PRODUCT");
        assert.equal(input.pin, true);
        const created = { id: `gid://shopify/MetafieldDefinition/${++creations}`, namespace: input.namespace, key: input.key, type: { name: input.type } };
        definitions.set(input.key, created);
        return new Response(JSON.stringify({ data: { metafieldDefinitionCreate: { createdDefinition: created, userErrors: [] } } }));
      }
      const product = { id: "gid://shopify/Product/123", title: "Title", handle: "bag", updatedAt: "v1", tags: [], variants: { nodes: [] }, images: { nodes: [] } };
      if (body.query.includes("mutation ProductUpdate")) {
        productWrites++;
        assert.equal(definitions.size, 2);
        assert.equal(body.variables.product?.metafields.length, 2);
        return new Response(JSON.stringify({ data: { productUpdate: { product, userErrors: [] } } }));
      }
      return new Response(JSON.stringify({ data: { product } }));
    } });
  const dispatcher = new GatewayDispatcher({ graphqlClient: client, storeRegistry: new InMemoryStoreRegistry([
    { storeId: "aeo-new", shopDomain: "aeo-new.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "test-only" } },
  ]) });
  const metafields = [
    { namespace: "custom", key: "aeo_suite_html", type: "multi_line_text_field", value: "<section>Summary</section>" },
    { namespace: "custom", key: "aeo_json_ld", type: "json", value: '{"@graph":[]}' },
  ];
  const payload = { id: "gid://shopify/Product/123", expectedUpdatedAt: "v1", product: { title: "Title", metafields } };
  await dispatcher.dispatch({ storeId: "aeo-new", operation: "products.update", mode: "preview", payload });
  assert.equal(creations, 0);
  await assert.rejects(dispatcher.dispatch({ storeId: "aeo-new", operation: "products.update", mode: "apply",
    requestId: "stale-aeo", payload: { ...payload, expectedUpdatedAt: "older-version" } }),
  error => error instanceof GatewayError && error.code === "SHOPIFY_VERSION_CONFLICT");
  assert.equal(creations, 0);
  assert.equal(productWrites, 0);
  const request = { storeId: "aeo-new", operation: "products.update" as const, mode: "apply" as const, payload, requestId: "new-store-aeo" };
  await dispatcher.dispatch(request);
  await dispatcher.dispatch(request);
  assert.equal(creations, 2);
  assert.equal(productWrites, 1);
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

test("an incompatible AEO definition blocks product writes and is never overwritten", async () => {
  let mutations = 0;
  const client = new ShopifyGraphqlClient({ tokenProvider: new StaticAccessTokenProvider(), throttleManager: new InMemoryThrottleManager(),
    baseTransport: async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { query: string };
      if (body.query.includes("mutation")) mutations++;
      if (body.query.includes("query MetafieldDefinition")) return Response.json({ data: { metafieldDefinition: {
        id: "gid://shopify/MetafieldDefinition/99", namespace: "custom", key: "aeo_suite_html", type: { name: "json" },
      } } });
      return Response.json({ data: { product: { id: "gid://shopify/Product/123", title: "Title", handle: "bag", updatedAt: "v1", tags: [], variants: { nodes: [] }, images: { nodes: [] } } } });
    } });
  const dispatcher = new GatewayDispatcher({ graphqlClient: client, storeRegistry: new InMemoryStoreRegistry([
    { storeId: "aeo-conflict", shopDomain: "aeo-conflict.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "test-only" } },
  ]) });
  await assert.rejects(dispatcher.dispatch({ storeId: "aeo-conflict", operation: "products.update", mode: "apply", requestId: "conflict",
    payload: { id: "gid://shopify/Product/123", expectedUpdatedAt: "v1", product: { metafields: [
      { namespace: "custom", key: "aeo_suite_html", type: "multi_line_text_field", value: "<section>Summary</section>" },
    ] } } }), /uses type json; expected multi_line_text_field/);
  assert.equal(mutations, 0);
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

test("accepts Shopify's default SEO title only when the approved title equals the live product title", async () => {
  const transport = createSeoPublishTransport({ dispatch: async request => ({ success: true, storeId: "demo", operation: request.operation,
    data: request.operation === "metafields.get" ? { value: null } : { product: { title: "Bag", descriptionHtml: "", updatedAt: "v2", seo: { description: "Meta" } } } }) });
  for (const title of ["Bag", "Different SEO title", ""]) {
    const result = await transport.read({ id: "receipt", jobId: "job", storeId: "demo", productId: "123", sourceVersion: "v1", state: "UNCERTAIN", leaseId: "lease", seoVersion: null, errorCode: null,
      fields: { title: "Bag", descriptionHtml: "", seo: { title, description: "Meta" } } });
    assert.equal(result.fields.seo.title, title === "Bag" ? "Bag" : "");
  }
});
