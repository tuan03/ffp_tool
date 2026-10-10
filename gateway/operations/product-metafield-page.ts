import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

const PRODUCT_METAFIELD_PAGE_QUERY = `query ProductMetafieldPage($first: Int!, $after: String, $namespace: String!, $key: String!) {
  products(first: $first, after: $after, sortKey: ID) {
    nodes { id title status metafield(namespace: $namespace, key: $key) { value } }
    pageInfo { hasNextPage endCursor }
  }
}`;

interface ProductMetafieldPage {
  readonly shopDomain: string;
  readonly namespace: string;
  readonly key: string;
  readonly products: readonly { readonly id: string; readonly title: string; readonly status: string; readonly value: string | null }[];
  readonly pageInfo: { readonly hasNextPage: boolean; readonly endCursor: string | null };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): never {
  throw new GatewayError("Shopify returned an incomplete product metafield page.", "SHOPIFY_NETWORK_ERROR", 502);
}

export async function executeProductMetafieldPage(
  store: StoreConfig,
  client: Pick<ShopifyGraphqlClient, "query">,
  payload: unknown,
): Promise<ProductMetafieldPage> {
  const input = isRecord(payload) ? payload : {};
  const namespace = input.namespace;
  const key = input.key;
  const first = input.first ?? 200;
  const after = input.after ?? null;
  if (typeof namespace !== "string" || !/^[a-zA-Z0-9_-]{3,255}$/.test(namespace) ||
    typeof key !== "string" || !/^[a-zA-Z0-9_-]{3,64}$/.test(key) ||
    typeof first !== "number" || !Number.isInteger(first) || first < 1 || first > 250 ||
    (after !== null && (typeof after !== "string" || after.trim() === "" || after.length > 4096))) {
    throw new GatewayError("A valid metafield namespace, key, page size and cursor are required.", "SHOPIFY_INVALID_INPUT", 400);
  }

  // No search index or status filter: callers compare actual values, including draft/archived products.
  const response = await client.query<unknown>(store, PRODUCT_METAFIELD_PAGE_QUERY, { namespace, key, first, after });
  if (!isRecord(response) || !isRecord(response.products) || !Array.isArray(response.products.nodes) || !isRecord(response.products.pageInfo)) invalidResponse();
  const pageInfo = response.products.pageInfo;
  if (typeof pageInfo.hasNextPage !== "boolean" || (pageInfo.endCursor !== null && typeof pageInfo.endCursor !== "string") ||
    (pageInfo.hasNextPage && (!pageInfo.endCursor || pageInfo.endCursor === after || response.products.nodes.length === 0))) invalidResponse();
  const products = response.products.nodes.map((product: unknown) => {
    if (!isRecord(product) || typeof product.id !== "string" || !/^gid:\/\/shopify\/Product\/\d+$/.test(product.id) ||
      typeof product.title !== "string" || typeof product.status !== "string" || !["ACTIVE", "DRAFT", "ARCHIVED"].includes(product.status) ||
      (product.metafield !== null && (!isRecord(product.metafield) || typeof product.metafield.value !== "string"))) invalidResponse();
    return { id: product.id, title: product.title, status: product.status, value: product.metafield === null ? null : String(product.metafield.value) };
  });
  return { shopDomain: store.shopDomain, namespace, key, products, pageInfo: { hasNextPage: pageInfo.hasNextPage, endCursor: pageInfo.endCursor } };
}
