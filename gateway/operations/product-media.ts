import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type {
  ProductMediaImageSummary,
  ProductMediaPageResult,
  StoreConfig,
} from "../types";

export const PRODUCT_MEDIA_PAGE_QUERY = `
  query ProductMediaPage($id: ID!, $first: Int!, $after: String) {
    product(id: $id) {
      id
      media(first: $first, after: $after) {
        pageInfo {
          hasNextPage
          endCursor
        }
        nodes {
          id
          alt
          mediaContentType
          ... on MediaImage {
            image {
              url
              altText
              width
              height
            }
          }
        }
      }
    }
  }
`;

interface RawMediaNode {
  readonly id?: unknown;
  readonly alt?: unknown;
  readonly mediaContentType?: unknown;
  readonly image?: {
    readonly url?: unknown;
    readonly altText?: unknown;
    readonly width?: unknown;
    readonly height?: unknown;
  } | null;
}

interface ProductMediaResponse {
  readonly product?: {
    readonly id?: unknown;
    readonly media?: {
      readonly nodes?: readonly (RawMediaNode | null)[] | null;
      readonly pageInfo?: {
        readonly hasNextPage?: unknown;
        readonly endCursor?: unknown;
      } | null;
    } | null;
  } | null;
}

function malformed(message: string): never {
  throw new GatewayError(message, "SHOPIFY_NETWORK_ERROR", 502);
}

export async function executeProductMediaPage(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<ProductMediaPageResult> {
  const input = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const productGid = typeof input.id === "string" ? input.id.trim() : "";
  const first = input.first === undefined ? 50 : input.first;
  const after = input.after === null || input.after === undefined
    ? null
    : typeof input.after === "string" && input.after.trim() !== ""
    ? input.after
    : malformed("Product media cursor must be a non-empty string or null");

  if (!/^gid:\/\/shopify\/Product\/[^/]+$/.test(productGid)) {
    throw new GatewayError("A valid Shopify product GID is required", "SHOPIFY_INVALID_INPUT", 400);
  }
  if (!Number.isInteger(first) || Number(first) < 1 || Number(first) > 250) {
    throw new GatewayError("Product media page size must be an integer from 1 to 250", "SHOPIFY_INVALID_INPUT", 400);
  }

  const raw = await client.query<ProductMediaResponse>(store, PRODUCT_MEDIA_PAGE_QUERY, {
    id: productGid,
    first,
    after,
  });
  if (raw.product === null) {
    throw new GatewayError("Shopify product was not found", "SHOPIFY_NOT_FOUND", 404);
  }
  if (!raw.product || raw.product.id !== productGid || !raw.product.media) {
    return malformed("Shopify returned a malformed product media record");
  }
  const pageInfo = raw.product.media.pageInfo;
  if (!pageInfo || typeof pageInfo.hasNextPage !== "boolean") {
    return malformed("Shopify returned malformed product media page information");
  }
  const endCursor = pageInfo.endCursor;
  if (endCursor !== null && typeof endCursor !== "string") {
    return malformed("Shopify returned a malformed product media cursor");
  }
  if (pageInfo.hasNextPage && (typeof endCursor !== "string" || endCursor.length === 0)) {
    return malformed("Shopify omitted the next product media cursor");
  }
  if (!Array.isArray(raw.product.media.nodes)) {
    return malformed("Shopify returned malformed product media nodes");
  }

  const nodes: ProductMediaImageSummary[] = [];
  for (const node of raw.product.media.nodes) {
    if (!node || typeof node !== "object" || typeof node.id !== "string" || node.id.trim() === "") {
      return malformed("Shopify returned a malformed product media node");
    }
    if (node.mediaContentType !== "IMAGE") continue;
    if (!node.image || typeof node.image.url !== "string" || node.image.url.trim() === "") {
      return malformed("Shopify returned a malformed product image node");
    }
    if (node.alt !== null && node.alt !== undefined && typeof node.alt !== "string") {
      return malformed("Shopify returned a malformed product image alt");
    }
    if (node.image.altText !== null && node.image.altText !== undefined && typeof node.image.altText !== "string") {
      return malformed("Shopify returned a malformed product image alt text");
    }
    for (const dimension of [node.image.width, node.image.height]) {
      if (dimension !== null && dimension !== undefined && (!Number.isInteger(dimension) || Number(dimension) < 0)) {
        return malformed("Shopify returned malformed product image dimensions");
      }
    }
    nodes.push({
      id: node.id.trim(),
      url: node.image.url.trim(),
      altText: typeof node.alt === "string"
        ? node.alt
        : typeof node.image.altText === "string"
        ? node.image.altText
        : null,
      width: typeof node.image.width === "number" ? node.image.width : null,
      height: typeof node.image.height === "number" ? node.image.height : null,
    });
  }

  return {
    nodes,
    pageInfo: {
      hasNextPage: pageInfo.hasNextPage,
      endCursor: typeof endCursor === "string" ? endCursor : null,
    },
  };
}
