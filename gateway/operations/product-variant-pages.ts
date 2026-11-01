import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export interface ProductVariantState {
  readonly id: string;
  readonly title: string;
  readonly price: string;
  readonly compareAtPrice?: string | null;
  readonly sku?: string | null;
  readonly barcode?: string | null;
  readonly inventoryQuantity?: number | null;
  readonly selectedOptions?: readonly { readonly name: string; readonly value: string }[];
  readonly etsyProductId?: { readonly value: string } | null;
}

export async function readAllProductVariants(store: StoreConfig, client: Pick<ShopifyGraphqlClient, "query">, productId: string): Promise<ProductVariantState[]> {
  const variants: ProductVariantState[] = [];
  const seen = new Set<string>();
  const cursors = new Set<string>();
  let after: string | undefined;
  for (;;) {
    const response = await client.query<{ product?: { variants?: {
      nodes: ProductVariantState[]; pageInfo: { hasNextPage: boolean; endCursor?: string | null };
    } } | null }>(store, `query ProductVariantPage($id: ID!, $after: String) {
      product(id: $id) { variants(first: 250, after: $after) {
        nodes { id title price compareAtPrice sku barcode inventoryQuantity selectedOptions { name value }
          etsyProductId: metafield(namespace: "custom", key: "etsy_product_id") { value } }
        pageInfo { hasNextPage endCursor }
      } }
    }`, { id: productId, after }, { isWrite: false });
    const connection = response.product?.variants;
    if (!connection?.nodes || typeof connection.pageInfo?.hasNextPage !== "boolean") {
      throw new GatewayError("Incomplete product variant pagination; no complete snapshot available.", "SHOPIFY_INVALID_INPUT", 400);
    }
    for (const variant of connection.nodes) {
      if (!variant.id || seen.has(variant.id)) throw new GatewayError("Duplicate variant in pagination.", "SHOPIFY_INVALID_INPUT", 400);
      seen.add(variant.id);
      variants.push(variant);
    }
    if (!connection.pageInfo.hasNextPage) return variants;
    const cursor = connection.pageInfo.endCursor;
    if (!cursor || cursors.has(cursor) || !connection.nodes.length) {
      throw new GatewayError("Broken product variant pagination cursor.", "SHOPIFY_INVALID_INPUT", 400);
    }
    cursors.add(cursor);
    after = cursor;
  }
}
