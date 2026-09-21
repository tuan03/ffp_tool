import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type {
  ProductImageSummary,
  ProductListResult,
  ProductSummary,
  ProductVariantSummary,
  StoreConfig,
} from "../types";

const PRODUCTS_LIST_QUERY = `
  query ProductsList($first: Int, $after: String, $query: String) {
    products(first: $first, after: $after, query: $query) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        startCursor
        endCursor
      }
      edges {
        cursor
        node {
          id
          title
          handle
          status
          vendor
          productType
          tags
          onlineStoreUrl
          featuredImage {
            id
            url
            altText
            width
            height
          }
          seo {
            title
            description
          }
          createdAt
          updatedAt
          variants(first: 10) {
            edges {
              node {
                id
                title
                price
              }
            }
          }
        }
      }
    }
  }
`;

const PRODUCTS_GET_QUERY = `
  query ProductsGet($id: ID!) {
    product(id: $id) {
      id
      title
      handle
      description
      descriptionHtml
      status
      vendor
      productType
      tags
      onlineStoreUrl
      featuredImage {
        id
        url
        altText
        width
        height
      }
      images(first: 50) {
        edges {
          node {
            id
            url
            altText
            width
            height
          }
        }
      }
      seo {
        title
        description
      }
      createdAt
      updatedAt
      variants(first: 100) {
        edges {
          node {
            id
            title
            price
            sku
            barcode
            inventoryQuantity
          }
        }
      }
    }
  }
`;

export interface RawVariantNode {
  readonly id: string;
  readonly title: string;
  readonly price: string;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly inventoryQuantity?: number | null;
}

export interface RawImageNode {
  readonly id?: string | null;
  readonly url?: string | null;
  readonly altText?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
}

export interface RawProductNode {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string | null;
  readonly descriptionHtml?: string | null;
  readonly status: "ACTIVE" | "ARCHIVED" | "DRAFT";
  readonly vendor?: string | null;
  readonly productType?: string | null;
  readonly tags?: readonly string[] | null;
  readonly onlineStoreUrl?: string | null;
  readonly featuredImage?: RawImageNode | null;
  readonly images?: {
    readonly edges?: readonly { readonly node: RawImageNode }[];
  } | null;
  readonly seo?: { readonly title?: string | null; readonly description?: string | null } | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly variants?: {
    readonly edges?: readonly { readonly node: RawVariantNode }[];
  } | null;
}

function mapImageNode(node?: RawImageNode | null): ProductImageSummary | undefined {
  if (!node || typeof node.url !== "string" || node.url === "") {
    return undefined;
  }
  return {
    id: node.id ?? undefined,
    url: node.url,
    altText: node.altText ?? undefined,
    width: typeof node.width === "number" ? node.width : undefined,
    height: typeof node.height === "number" ? node.height : undefined,
  };
}

export function mapProductNode(node: RawProductNode): ProductSummary {
  const variants: ProductVariantSummary[] = (node.variants?.edges ?? []).map((vEdge) => ({
    id: vEdge.node.id,
    productId: node.id,
    title: vEdge.node.title,
    price: vEdge.node.price,
    sku: vEdge.node.sku ?? undefined,
    barcode: vEdge.node.barcode ?? undefined,
    inventoryQuantity: vEdge.node.inventoryQuantity ?? undefined,
  }));

  const featuredImage = mapImageNode(node.featuredImage);
  const images = node.images?.edges
    ? node.images.edges
        .map((edge) => mapImageNode(edge.node))
        .filter((img): img is ProductImageSummary => img !== undefined)
    : undefined;

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: node.description ?? undefined,
    descriptionHtml: node.descriptionHtml ?? undefined,
    status: node.status,
    vendor: node.vendor ?? undefined,
    productType: node.productType ?? undefined,
    tags: node.tags ?? [],
    onlineStoreUrl: node.onlineStoreUrl ?? undefined,
    featuredImage,
    images,
    variants,
    seo:
      node.seo && (node.seo.title != null || node.seo.description != null)
        ? {
            title: node.seo.title ?? undefined,
            description: node.seo.description ?? undefined,
          }
        : undefined,
    createdAt: node.createdAt,
    updatedAt: node.updatedAt,
  };
}

export async function executeProductsList(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<ProductListResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (p.limit !== undefined && (typeof p.limit !== "number" || p.limit <= 0)) {
    throw new GatewayError("Limit must be greater than 0", "SHOPIFY_USER_ERROR", 400);
  }
  const first = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 250) : 50;
  const after = typeof p.cursor === "string" && p.cursor.trim() !== "" ? p.cursor.trim() : undefined;

  let queryFilter = typeof p.query === "string" ? p.query.trim() : "";
  if (typeof p.status === "string" && p.status.trim() !== "") {
    const statusFilter = `status:${p.status.trim().toLowerCase()}`;
    queryFilter = queryFilter ? `${queryFilter} AND ${statusFilter}` : statusFilter;
  }

  interface ProductsListResponse {
    readonly products: {
      readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly hasPreviousPage: boolean;
        readonly startCursor?: string | null;
        readonly endCursor?: string | null;
      };
      readonly edges: readonly {
        readonly cursor: string;
        readonly node: RawProductNode;
      }[];
    };
  }

  const raw = await client.query<ProductsListResponse>(store, PRODUCTS_LIST_QUERY, {
    first,
    after,
    query: queryFilter || undefined,
  });

  return {
    products: raw.products.edges.map((e) => mapProductNode(e.node)),
    pageInfo: {
      hasNextPage: raw.products.pageInfo.hasNextPage,
      hasPreviousPage: raw.products.pageInfo.hasPreviousPage,
      startCursor: raw.products.pageInfo.startCursor ?? undefined,
      endCursor: raw.products.pageInfo.endCursor ?? undefined,
    },
  };
}

export async function executeProductsGet(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<{ product: ProductSummary | null }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Product id is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  interface ProductsGetResponse {
    readonly product: RawProductNode | null;
  }

  const raw = await client.query<ProductsGetResponse>(store, PRODUCTS_GET_QUERY, { id });
  return {
    product: raw.product ? mapProductNode(raw.product) : null,
  };
}
