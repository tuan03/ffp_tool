import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import { GatewayError } from "../errors";
import { executeProductMediaPage } from "../operations/product-media";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import {
  SeoVersionRepository,
  applySeoVersionMigrations,
  createSeoBaselineService,
} from "../seo-versioning";
import { SeoSnapshotReadError } from "../seo-versioning";
import type { WorkerDatabase } from "../seo-worker/database";
import type { GatewayRequest, GatewayResponse, StoreConfig } from "../types";

const store: StoreConfig = {
  storeId: "jeminise",
  shopDomain: "b6-theme-test.myshopify.com",
  apiVersion: "2026-07",
  auth: { type: "static", staticToken: "test" },
};

function mediaImage(index: number) {
  return {
    id: `gid://shopify/MediaImage/${String(index).padStart(3, "0")}`,
    url: `https://cdn.shopify.com/image-${index}.jpg`,
    altText: `Image ${index}`,
    width: 1200,
    height: 1200,
  };
}

test("read-only product media operation validates cursors and maps image pages", async () => {
  let variables: Record<string, unknown> | undefined;
  const client = {
    async query(_store: StoreConfig, _query: string, input?: Record<string, unknown>) {
      variables = input;
      return {
        product: {
          id: "gid://shopify/Product/123",
          media: {
            pageInfo: { hasNextPage: true, endCursor: "cursor-50" },
            nodes: [
              { id: "gid://shopify/MediaImage/1", alt: "Hero", mediaContentType: "IMAGE", image: { url: "https://cdn/1.jpg", width: 100, height: 200 } },
              { id: "gid://shopify/Video/2", alt: null, mediaContentType: "VIDEO" },
            ],
          },
        },
      };
    },
  } as unknown as ShopifyGraphqlClient;

  const page = await executeProductMediaPage(store, client, {
    id: "gid://shopify/Product/123",
    first: 50,
    after: "cursor-previous",
  });
  assert.deepEqual(variables, { id: "gid://shopify/Product/123", first: 50, after: "cursor-previous" });
  assert.deepEqual(page, {
    nodes: [{ id: "gid://shopify/MediaImage/1", url: "https://cdn/1.jpg", altText: "Hero", width: 100, height: 200 }],
    pageInfo: { hasNextPage: true, endCursor: "cursor-50" },
  });

  await assert.rejects(executeProductMediaPage(store, client, { id: "123" }), (error: unknown) => (
    error instanceof GatewayError && error.code === "SHOPIFY_INVALID_INPUT"
  ));
});

test("product media operation fails closed on malformed pages and propagates GraphQL failures", async () => {
  const malformedClient = {
    async query() {
      return {
        product: {
          id: "gid://shopify/Product/123",
          media: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } },
        },
      };
    },
  } as unknown as ShopifyGraphqlClient;
  await assert.rejects(
    executeProductMediaPage(store, malformedClient, { id: "gid://shopify/Product/123" }),
    (error: unknown) => error instanceof GatewayError && error.code === "SHOPIFY_NETWORK_ERROR",
  );

  const graphqlFailure = new GatewayError("GraphQL denied access", "SHOPIFY_PERMISSION_DENIED", 403);
  const failedClient = {
    async query() {
      throw graphqlFailure;
    },
  } as unknown as ShopifyGraphqlClient;
  await assert.rejects(
    executeProductMediaPage(store, failedClient, { id: "gid://shopify/Product/123" }),
    (error: unknown) => error === graphqlFailure,
  );
});

test("baseline service reads every media page, creates one v0, stays idempotent, and records drift", async () => {
  const pg = await PGlite.create();
  const database: WorkerDatabase = {
    transaction: operation => pg.transaction(tx => operation({
      query: async (sql, values) => ({ rows: (await tx.query<Record<string, unknown>>(sql, values)).rows }),
    })),
  };
  await applySeoVersionMigrations(database);
  let nextId = 0;
  const repository = new SeoVersionRepository(database, "public", () => `baseline-id-${++nextId}`);
  await repository.setStoreFlags({ storeId: "jeminise", readEnabled: true, writeEnabled: false }, 1);

  let title = "Original quilt";
  let onlineStoreUrl = "https://jeminise.test/products/original-quilt";
  let status: "ACTIVE" | "ARCHIVED" = "ACTIVE";
  let updatedAt = "2026-10-05T01:00:00.000Z";
  const operations: string[] = [];
  const cursors: (string | null)[] = [];
  const dispatcher = {
    async dispatch(request: GatewayRequest): Promise<GatewayResponse> {
      operations.push(request.operation);
      if (request.operation === "products.get") {
        return {
          storeId: "jeminise",
          operation: request.operation,
          success: true,
          data: {
            product: {
              id: "gid://shopify/Product/123",
              title,
              handle: "original-quilt",
              descriptionHtml: "<p>Quilt description</p>",
              status,
              vendor: "Jeminise",
              productType: "Quilt",
              tags: ["bedding"],
              onlineStoreUrl,
              images: Array.from({ length: 50 }, (_, index) => mediaImage(index + 1)),
              hasMoreImages: true,
              seo: { title: "Quilt SEO", description: "Quilt description" },
              updatedAt,
            },
          },
        };
      }
      if (request.operation === "products.mediaPage") {
        const after = (request.payload as { readonly after: string | null }).after;
        cursors.push(after);
        return {
          storeId: "jeminise",
          operation: request.operation,
          success: true,
          data: after === null
            ? {
                nodes: Array.from({ length: 50 }, (_, index) => mediaImage(index + 1)),
                pageInfo: { hasNextPage: true, endCursor: "cursor-50" },
              }
            : {
                nodes: [mediaImage(51)],
                pageInfo: { hasNextPage: false, endCursor: "cursor-51" },
              },
        };
      }
      if (request.operation === "metafields.get") {
        const key = (request.payload as { readonly key: string }).key;
        return {
          storeId: "jeminise",
          operation: request.operation,
          success: true,
          data: key === "aeo_json_ld"
            ? { value: null }
            : { value: key === "aeo_faq" ? "[]" : "Summary", type: key === "aeo_faq" ? "json" : "multi_line_text_field" },
        };
      }
      throw new Error(`Unexpected operation: ${request.operation}`);
    },
  };
  const service = createSeoBaselineService({ dispatcher, repository });

  try {
    const first = await service.observeProduct({ storeId: "jeminise", shopifyProductGid: "gid://shopify/Product/123", observedAt: 10 });
    assert.equal(first.outcome, "BASELINE_CREATED");
    assert.equal(first.versionNumber, 0);
    assert.deepEqual(cursors, [null, "cursor-50"]);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal(JSON.parse((await pg.query<{ images: string }>("SELECT images::text FROM seo_content_snapshots")).rows[0].images).length, 51);

    const repeated = await service.observeProduct({ storeId: "jeminise", shopifyProductGid: "gid://shopify/Product/123", observedAt: 20 });
    assert.equal(repeated.outcome, "UNCHANGED");
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_external_changes")).rows[0].count, 0);

    title = "Externally edited quilt";
    onlineStoreUrl = "https://jeminise.test/products/renamed-quilt";
    status = "ARCHIVED";
    updatedAt = "2026-10-05T02:00:00.000Z";
    const drift = await service.observeProduct({ storeId: "jeminise", shopifyProductGid: "gid://shopify/Product/123", observedAt: 30 });
    assert.equal(drift.outcome, "EXTERNAL_CHANGE");
    assert.equal(drift.versionNumber, 0);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_versions")).rows[0].count, 1);
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_external_changes")).rows[0].count, 1);
    assert.deepEqual((await pg.query<{ current_url: string; shopify_status: string; versioning_state: string }>(
      "SELECT current_url,shopify_status,versioning_state FROM seo_products",
    )).rows[0], {
      current_url: onlineStoreUrl,
      shopify_status: "ARCHIVED",
      versioning_state: "DIRTY",
    });
    assert.equal((await pg.query<{ count: number }>("SELECT count(*)::int AS count FROM seo_product_url_history")).rows[0].count, 2);
    assert.equal(operations.some(operation => operation === "products.update" || operation === "metafields.set"), false);
  } finally {
    await pg.close();
  }
});

test("baseline service fails closed when a dispatcher media page is malformed", async () => {
  const dispatcher = {
    async dispatch(request: GatewayRequest): Promise<GatewayResponse> {
      if (request.operation === "products.get") {
        return { storeId: "jeminise", operation: request.operation, success: true, data: { product: {
          id: "gid://shopify/Product/123", title: "Quilt", handle: "quilt", descriptionHtml: "", status: "ACTIVE",
          vendor: null, productType: null, tags: [], onlineStoreUrl: null, images: [], hasMoreImages: true,
          seo: null, updatedAt: "2026-10-05T01:00:00.000Z",
        } } };
      }
      if (request.operation === "products.mediaPage") {
        return { storeId: "jeminise", operation: request.operation, success: true, data: {
          nodes: [], pageInfo: { hasNextPage: true, endCursor: null },
        } };
      }
      throw new Error("Metafields must not be read after malformed media");
    },
  };
  const repository = {} as SeoVersionRepository;

  await assert.rejects(
    createSeoBaselineService({ dispatcher, repository }).observeProduct({
      storeId: "jeminise",
      shopifyProductGid: "gid://shopify/Product/123",
      observedAt: 10,
    }),
    (error: unknown) => error instanceof SeoSnapshotReadError && error.code === "MALFORMED_SHOPIFY_RECORD",
  );
});
