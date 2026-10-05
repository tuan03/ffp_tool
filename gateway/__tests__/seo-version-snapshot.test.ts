import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalSeoSnapshot } from "../seo-versioning/canonical-snapshot";
import { createShopifySeoSnapshotReader } from "../seo-versioning/shopify-snapshot-reader";
import type { ShopifyMediaPageSource } from "../seo-versioning/shopify-snapshot-reader";
import { SeoSnapshotReadError } from "../seo-versioning/snapshot-types";
import type { SeoSnapshotInput } from "../seo-versioning/snapshot-types";
import type { GatewayDispatcher } from "../dispatcher";
import type { GatewayRequest, GatewayResponse } from "../types";

function createSnapshotInput(overrides: Partial<SeoSnapshotInput> = {}): SeoSnapshotInput {
  return {
    storeId: "jeminise",
    shopifyProductGid: "gid://shopify/Product/123",
    capturedAtUtc: "2026-10-05T03:00:00.000Z",
    source: "BASELINE",
    title: "Viking Quilt\r\nSet",
    descriptionHtml: "<p>Soft\rdescription</p>",
    seoTitle: "Viking Quilt",
    seoDescription: "Bedding\r\nfor every season",
    images: [
      { mediaGid: "gid://shopify/MediaImage/2", imageUrl: "https://cdn/2.jpg", alt: null, width: 200, height: 100 },
      { mediaGid: "gid://shopify/MediaImage/1", imageUrl: "https://cdn/1.jpg", alt: "Front\r\nview", width: 100, height: 200 },
    ],
    aeoMetafields: [
      { namespace: "custom", key: "aeo_json_ld", type: "json", value: "{\r\n  \"@type\": \"Product\"\r\n}" },
      { namespace: "custom", key: "aeo_faq", type: "json", value: "[]" },
      { namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: "Quick\rsummary" },
    ],
    handle: "viking-quilt",
    onlineStoreUrl: "https://example.test/products/viking-quilt",
    shopifyStatus: "ACTIVE",
    vendor: "Jeminise",
    productType: "Quilt",
    tags: ["bedding"],
    shopifyUpdatedAt: "2026-10-05T02:00:00.000Z",
    ...overrides,
  };
}

test("canonical SEO snapshots normalize LF and ignore context and source ordering", () => {
  const first = createCanonicalSeoSnapshot(createSnapshotInput());
  const second = createCanonicalSeoSnapshot(createSnapshotInput({
    capturedAtUtc: "2026-10-05T04:00:00.000Z",
    source: "EXTERNAL_OBSERVATION",
    handle: "new-handle",
    onlineStoreUrl: null,
    vendor: "Different vendor",
    productType: "Different context",
    tags: ["changed"],
    shopifyUpdatedAt: "2026-10-05T04:00:00.000Z",
    images: [...createSnapshotInput().images].reverse().map((image) => ({
      ...image,
      imageUrl: `${image.imageUrl}?changed=context`,
      width: image.width === null ? null : image.width + 10,
    })),
    aeoMetafields: [...createSnapshotInput().aeoMetafields].reverse(),
  }));

  assert.equal(first.contentHash, second.contentHash);
  assert.equal(first.canonicalContentJson, second.canonicalContentJson);
  assert.match(first.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(first.title, "Viking Quilt\nSet");
  assert.equal(first.images[0]?.mediaGid, "gid://shopify/MediaImage/1");
  assert.equal(first.images[0]?.alt, "Front\nview");
  assert.deepEqual(JSON.parse(first.canonicalContentJson), {
    snapshotSchemaVersion: "seo-content-snapshot-v1",
    fieldSetVersion: "seo-fields-v1",
    title: "Viking Quilt\nSet",
    descriptionHtml: "<p>Soft\ndescription</p>",
    seo: { title: "Viking Quilt", description: "Bedding\nfor every season" },
    images: [
      { mediaGid: "gid://shopify/MediaImage/1", alt: "Front\nview" },
      { mediaGid: "gid://shopify/MediaImage/2", alt: null },
    ],
    aeoMetafields: [
      { namespace: "custom", key: "aeo_faq", type: "json", value: "[]" },
      { namespace: "custom", key: "aeo_json_ld", type: "json", value: "{\n  \"@type\": \"Product\"\n}" },
      { namespace: "custom", key: "aeo_quick_summary", type: "multi_line_text_field", value: "Quick\nsummary" },
    ],
  });
});

test("canonical SEO hashes distinguish null, empty, alt, and published AEO changes", () => {
  const original = createCanonicalSeoSnapshot(createSnapshotInput());
  const emptyDescription = createCanonicalSeoSnapshot(createSnapshotInput({ descriptionHtml: "" }));
  const nullDescription = createCanonicalSeoSnapshot(createSnapshotInput({ descriptionHtml: null }));
  const changedAlt = createCanonicalSeoSnapshot(createSnapshotInput({
    images: createSnapshotInput().images.map((image) => image.mediaGid.endsWith("/1") ? { ...image, alt: "Back view" } : image),
  }));
  const changedAeo = createCanonicalSeoSnapshot(createSnapshotInput({
    aeoMetafields: createSnapshotInput().aeoMetafields.map((field) => field.key === "aeo_faq" ? { ...field, value: "[{\"question\":\"What?\"}]" } : field),
  }));

  assert.notEqual(emptyDescription.contentHash, nullDescription.contentHash);
  assert.notEqual(original.contentHash, changedAlt.contentHash);
  assert.notEqual(original.contentHash, changedAeo.contentHash);
});

test("canonical SEO snapshots reject duplicate media and metafield identities", () => {
  const image = createSnapshotInput().images[0];
  const metafield = createSnapshotInput().aeoMetafields[0];
  assert.ok(image);
  assert.ok(metafield);
  assert.throws(() => createCanonicalSeoSnapshot(createSnapshotInput({ images: [image, image] })), /unique non-empty Media GIDs/);
  assert.throws(() => createCanonicalSeoSnapshot(createSnapshotInput({ aeoMetafields: [metafield, metafield] })), /unique namespace\/key/);
});

function productData(hasMoreImages: boolean): Record<string, unknown> {
  return {
    id: "gid://shopify/Product/123",
    title: "Viking Quilt",
    handle: "viking-quilt",
    descriptionHtml: "<p>Description</p>",
    status: "ACTIVE",
    vendor: "Jeminise",
    productType: "Quilt",
    tags: ["bedding"],
    onlineStoreUrl: "https://example.test/products/viking-quilt",
    images: [{ id: "gid://shopify/MediaImage/initial", url: "https://cdn/initial.jpg", altText: "Initial", width: 10, height: 10 }],
    hasMoreImages,
    seo: { title: "SEO title", description: "SEO description" },
    updatedAt: "2026-10-05T02:00:00.000Z",
  };
}

function createDispatcher(options: {
  readonly hasMoreImages?: boolean;
  readonly productResponse?: GatewayResponse;
  readonly calls?: GatewayRequest[];
} = {}): Pick<GatewayDispatcher, "dispatch"> {
  return {
    async dispatch(request: GatewayRequest): Promise<GatewayResponse> {
      options.calls?.push(request);
      if (request.operation === "products.get") {
        return options.productResponse ?? {
          storeId: "jeminise",
          operation: request.operation,
          success: true,
          data: { product: productData(options.hasMoreImages ?? false) },
        };
      }
      const key = (request.payload as { readonly key: string }).key;
      return {
        storeId: "jeminise",
        operation: request.operation,
        success: true,
        data: key === "aeo_quick_summary"
          ? { value: "A quilt summary", type: "multi_line_text_field" }
          : key === "aeo_faq"
          ? { value: "[]", type: "json" }
          : { value: null },
      };
    },
  };
}

const readRequest = {
  storeId: "jeminise",
  shopifyProductGid: "gid://shopify/Product/123",
  capturedAtUtc: "2026-10-05T03:00:00.000Z",
  source: "BASELINE" as const,
};

test("Shopify snapshot reader captures the complete product and published AEO metafields", async () => {
  const calls: GatewayRequest[] = [];
  const snapshot = await createShopifySeoSnapshotReader(createDispatcher({ calls })).readSnapshot(readRequest);

  assert.equal(snapshot.images.length, 1);
  assert.equal(snapshot.aeoMetafields.length, 3);
  assert.equal(snapshot.aeoMetafields.find((field) => field.key === "aeo_json_ld")?.value, null);
  assert.deepEqual(calls.map((call) => call.operation), ["products.get", "metafields.get", "metafields.get", "metafields.get"]);
  assert.ok(snapshot.canonicalContentJson.includes("aeo_quick_summary"));
});

test("Shopify snapshot reader replaces a truncated initial image list with all paginated media", async () => {
  const afterValues: (string | null)[] = [];
  const mediaPageSource: ShopifyMediaPageSource = {
    async readMediaPage(request) {
      afterValues.push(request.after);
      return request.after === null
        ? {
            nodes: [{ id: "gid://shopify/MediaImage/2", url: "https://cdn/2.jpg", altText: "Second" }],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          }
        : {
            nodes: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn/1.jpg", altText: "First" }],
            pageInfo: { hasNextPage: false, endCursor: "cursor-2" },
          };
    },
  };

  const snapshot = await createShopifySeoSnapshotReader(
    createDispatcher({ hasMoreImages: true }),
    mediaPageSource,
  ).readSnapshot(readRequest);

  assert.deepEqual(afterValues, [null, "cursor-1"]);
  assert.deepEqual(snapshot.images.map((image) => image.mediaGid), [
    "gid://shopify/MediaImage/1",
    "gid://shopify/MediaImage/2",
  ]);
});

test("Shopify snapshot reader fails closed for incomplete media and failed or malformed records", async () => {
  await assert.rejects(
    createShopifySeoSnapshotReader(createDispatcher({ hasMoreImages: true })).readSnapshot(readRequest),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "INCOMPLETE_MEDIA",
  );

  const failedResponse: GatewayResponse = {
    storeId: "jeminise",
    operation: "products.get",
    success: false,
    error: { code: "SHOPIFY_NETWORK_ERROR", message: "timeout" },
  };
  await assert.rejects(
    createShopifySeoSnapshotReader(createDispatcher({ productResponse: failedResponse })).readSnapshot(readRequest),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "SHOPIFY_READ_FAILED",
  );

  const malformedResponse: GatewayResponse = {
    storeId: "jeminise",
    operation: "products.get",
    success: true,
    data: { product: { id: "gid://shopify/Product/123", title: "Missing required fields" } },
  };
  await assert.rejects(
    createShopifySeoSnapshotReader(createDispatcher({ productResponse: malformedResponse })).readSnapshot(readRequest),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "MALFORMED_SHOPIFY_RECORD",
  );
});

test("Shopify snapshot reader rejects GraphQL errors and non-advancing pagination", async () => {
  await assert.rejects(
    createShopifySeoSnapshotReader(createDispatcher({ hasMoreImages: true }), {
      readMediaPage: async () => ({ errors: [{ message: "access denied" }] }),
    }).readSnapshot(readRequest),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "GRAPHQL_ERROR",
  );

  let calls = 0;
  await assert.rejects(
    createShopifySeoSnapshotReader(createDispatcher({ hasMoreImages: true }), {
      readMediaPage: async () => {
        calls += 1;
        return { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } };
      },
    }).readSnapshot(readRequest),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "MALFORMED_SHOPIFY_RECORD",
  );
  assert.equal(calls, 2);
});
