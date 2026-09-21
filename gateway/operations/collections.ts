import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { CollectionListResult, CollectionSummary, StoreConfig } from "../types";

const COLLECTIONS_LIST_QUERY = `
  query CollectionsList($first: Int, $after: String, $query: String) {
    collections(first: $first, after: $after, query: $query) {
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
          description
          productsCount {
            count
          }
          updatedAt
        }
      }
    }
  }
`;

const COLLECTIONS_GET_QUERY = `
  query CollectionsGet($id: ID!) {
    collection(id: $id) {
      id
      title
      handle
      description
      seo {
        title
        description
      }
      productsCount {
        count
      }
      updatedAt
    }
  }
`;

export interface RawCollectionNode {
  readonly id: string;
  readonly title: string;
  readonly handle: string;
  readonly description?: string | null;
  readonly seo?: { readonly title?: string | null; readonly description?: string | null } | null;
  readonly productsCount?: { readonly count?: number } | number | null;
  readonly updatedAt: string;
}

export function mapCollectionNode(node: RawCollectionNode): CollectionSummary {
  let count = 0;
  if (typeof node.productsCount === "number") {
    count = node.productsCount;
  } else if (node.productsCount && typeof node.productsCount.count === "number") {
    count = node.productsCount.count;
  }

  return {
    id: node.id,
    title: node.title,
    handle: node.handle,
    description: node.description ?? undefined,
    productsCount: count,
    seo: node.seo
      ? {
          title: node.seo.title ?? undefined,
          description: node.seo.description ?? undefined,
        }
      : undefined,
    updatedAt: node.updatedAt,
  };
}

export async function executeCollectionsList(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<CollectionListResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (p.limit !== undefined && (typeof p.limit !== "number" || p.limit <= 0)) {
    throw new GatewayError("Limit must be greater than 0", "SHOPIFY_USER_ERROR", 400);
  }
  const first = typeof p.limit === "number" && p.limit > 0 ? Math.min(p.limit, 250) : 50;
  const after = typeof p.cursor === "string" && p.cursor.trim() !== "" ? p.cursor.trim() : undefined;
  const query = typeof p.query === "string" && p.query.trim() !== "" ? p.query.trim() : undefined;

  interface CollectionsListResponse {
    readonly collections: {
      readonly pageInfo: {
        readonly hasNextPage: boolean;
        readonly hasPreviousPage: boolean;
        readonly startCursor?: string | null;
        readonly endCursor?: string | null;
      };
      readonly edges: readonly {
        readonly cursor: string;
        readonly node: RawCollectionNode;
      }[];
    };
  }

  const raw = await client.query<CollectionsListResponse>(store, COLLECTIONS_LIST_QUERY, {
    first,
    after,
    query,
  });

  return {
    collections: raw.collections.edges.map((e) => mapCollectionNode(e.node)),
    pageInfo: {
      hasNextPage: raw.collections.pageInfo.hasNextPage,
      hasPreviousPage: raw.collections.pageInfo.hasPreviousPage,
      startCursor: raw.collections.pageInfo.startCursor ?? undefined,
      endCursor: raw.collections.pageInfo.endCursor ?? undefined,
    },
  };
}

export async function executeCollectionsGet(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
): Promise<{ collection: CollectionSummary | null }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Collection id is required", "SHOPIFY_INVALID_INPUT", 400);
  }

  interface CollectionsGetResponse {
    readonly collection: RawCollectionNode | null;
  }

  const raw = await client.query<CollectionsGetResponse>(store, COLLECTIONS_GET_QUERY, { id });
  return {
    collection: raw.collection ? mapCollectionNode(raw.collection) : null,
  };
}
