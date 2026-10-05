import { z } from "zod";

import type { GatewayDispatcher } from "../dispatcher";

import { createCanonicalSeoSnapshot } from "./canonical-snapshot";
import {
  PUBLISHED_AEO_METAFIELDS,
  SeoSnapshotReadError,
} from "./snapshot-types";
import type {
  SeoContentSnapshot,
  SeoSnapshotImage,
  SeoSnapshotMetafield,
  SeoSnapshotSource,
} from "./snapshot-types";

const imageSchema = z.object({
  id: z.string().min(1),
  url: z.string().min(1),
  altText: z.string().nullable().optional(),
  width: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().nonnegative().nullable().optional(),
}).strict();

const productSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  handle: z.string(),
  descriptionHtml: z.string().nullable().optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "DRAFT"]),
  vendor: z.string().nullable().optional(),
  productType: z.string().nullable().optional(),
  tags: z.array(z.string()),
  onlineStoreUrl: z.string().nullable().optional(),
  images: z.array(imageSchema),
  hasMoreImages: z.boolean(),
  seo: z.object({
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
  }).strict().nullable().optional(),
  updatedAt: z.string().min(1),
}).passthrough();

const productResponseSchema = z.object({ product: productSchema.nullable() }).strict();
const metafieldResponseSchema = z.object({
  value: z.string().nullable(),
  type: z.string().min(1).optional(),
}).passthrough();
const mediaPageSchema = z.object({
  nodes: z.array(imageSchema),
  pageInfo: z.object({
    hasNextPage: z.boolean(),
    endCursor: z.string().min(1).nullable(),
  }).strict(),
}).strict();

export interface ShopifyMediaPageRequest {
  readonly storeId: string;
  readonly productGid: string;
  readonly after: string | null;
}

export interface ShopifyMediaPageSource {
  readonly readMediaPage: (request: ShopifyMediaPageRequest) => Promise<unknown>;
}

export interface ReadShopifySeoSnapshotRequest {
  readonly storeId: string;
  readonly shopifyProductGid: string;
  readonly capturedAtUtc: string;
  readonly source: SeoSnapshotSource;
}

export interface ShopifySeoSnapshotReader {
  readonly readSnapshot: (request: ReadShopifySeoSnapshotRequest) => Promise<SeoContentSnapshot>;
}

function assertNoGraphqlErrors(value: unknown): void {
  if (!value || typeof value !== "object" || !("errors" in value)) return;
  const errors = (value as { readonly errors?: unknown }).errors;
  if (Array.isArray(errors) && errors.length > 0) {
    throw new SeoSnapshotReadError("GRAPHQL_ERROR", "Shopify returned GraphQL errors while reading a snapshot");
  }
}

function toSnapshotImage(image: z.infer<typeof imageSchema>): SeoSnapshotImage {
  return {
    mediaGid: image.id,
    imageUrl: image.url,
    alt: image.altText ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
  };
}

function parseMediaPage(value: unknown): z.infer<typeof mediaPageSchema> {
  assertNoGraphqlErrors(value);
  const parsed = mediaPageSchema.safeParse(value);
  if (!parsed.success) {
    throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify returned a malformed media page", {
      cause: parsed.error,
    });
  }
  if (parsed.data.pageInfo.hasNextPage && parsed.data.pageInfo.endCursor === null) {
    throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify media pagination omitted the next cursor");
  }
  return parsed.data;
}

async function readCompleteMedia(
  source: ShopifyMediaPageSource,
  request: ReadShopifySeoSnapshotRequest,
): Promise<readonly SeoSnapshotImage[]> {
  const images: SeoSnapshotImage[] = [];
  const cursors = new Set<string>();
  let after: string | null = null;

  for (let pageNumber = 0; pageNumber < 1_000; pageNumber += 1) {
    const page = parseMediaPage(await source.readMediaPage({
      storeId: request.storeId,
      productGid: request.shopifyProductGid,
      after,
    }));
    images.push(...page.nodes.map(toSnapshotImage));
    if (!page.pageInfo.hasNextPage) return images;

    const nextCursor = page.pageInfo.endCursor;
    if (nextCursor === null || cursors.has(nextCursor)) {
      throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify media pagination did not advance");
    }
    cursors.add(nextCursor);
    after = nextCursor;
  }

  throw new SeoSnapshotReadError("INCOMPLETE_MEDIA", "Shopify media pagination exceeded the safety limit");
}

async function readAeoMetafields(
  dispatcher: Pick<GatewayDispatcher, "dispatch">,
  request: ReadShopifySeoSnapshotRequest,
): Promise<readonly SeoSnapshotMetafield[]> {
  return Promise.all(PUBLISHED_AEO_METAFIELDS.map(async (identity) => {
    const response = await dispatcher.dispatch({
      storeId: request.storeId,
      operation: "metafields.get",
      payload: {
        ownerId: request.shopifyProductGid,
        namespace: identity.namespace,
        key: identity.key,
      },
    });
    if (!response.success) {
      throw new SeoSnapshotReadError("SHOPIFY_READ_FAILED", `Failed to read ${identity.namespace}.${identity.key}`);
    }
    assertNoGraphqlErrors(response.data);
    const parsed = metafieldResponseSchema.safeParse(response.data);
    if (!parsed.success || (parsed.data.value !== null && parsed.data.type === undefined)) {
      throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", `Shopify returned a malformed ${identity.namespace}.${identity.key} metafield`, {
        cause: parsed.success ? undefined : parsed.error,
      });
    }
    return {
      ...identity,
      type: parsed.data.type ?? null,
      value: parsed.data.value,
    };
  }));
}

export function createShopifySeoSnapshotReader(
  dispatcher: Pick<GatewayDispatcher, "dispatch">,
  mediaPageSource?: ShopifyMediaPageSource,
): ShopifySeoSnapshotReader {
  return {
    async readSnapshot(request) {
      const productResponse = await dispatcher.dispatch({
        storeId: request.storeId,
        operation: "products.get",
        payload: { id: request.shopifyProductGid },
      });
      if (!productResponse.success) {
        throw new SeoSnapshotReadError("SHOPIFY_READ_FAILED", "Failed to read the Shopify product");
      }
      assertNoGraphqlErrors(productResponse.data);
      const parsedProduct = productResponseSchema.safeParse(productResponse.data);
      if (!parsedProduct.success) {
        throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify returned a malformed product record", {
          cause: parsedProduct.error,
        });
      }
      const product = parsedProduct.data.product;
      if (!product) {
        throw new SeoSnapshotReadError("PRODUCT_NOT_FOUND", "The Shopify product no longer exists");
      }
      if (product.id !== request.shopifyProductGid) {
        throw new SeoSnapshotReadError("MALFORMED_SHOPIFY_RECORD", "Shopify returned a different product identity");
      }

      let images = product.images.map(toSnapshotImage);
      if (product.hasMoreImages) {
        if (!mediaPageSource) {
          throw new SeoSnapshotReadError("INCOMPLETE_MEDIA", "A complete media page source is required for this product");
        }
        images = [...await readCompleteMedia(mediaPageSource, request)];
      }
      const aeoMetafields = await readAeoMetafields(dispatcher, request);

      return createCanonicalSeoSnapshot({
        storeId: request.storeId,
        shopifyProductGid: product.id,
        capturedAtUtc: request.capturedAtUtc,
        source: request.source,
        title: product.title,
        descriptionHtml: product.descriptionHtml ?? null,
        seoTitle: product.seo?.title ?? null,
        seoDescription: product.seo?.description ?? null,
        images,
        aeoMetafields,
        handle: product.handle,
        onlineStoreUrl: product.onlineStoreUrl ?? null,
        shopifyStatus: product.status,
        vendor: product.vendor ?? null,
        productType: product.productType ?? null,
        tags: product.tags,
        shopifyUpdatedAt: product.updatedAt,
      });
    },
  };
}
