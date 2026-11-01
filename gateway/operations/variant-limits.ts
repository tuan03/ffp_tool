import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { StoreConfig } from "../types";

export async function executeProductVariantLimits(store: StoreConfig, client: Pick<ShopifyGraphqlClient, "query">): Promise<{
  readonly maxProductOptions: number; readonly maxProductVariants: number;
}> {
  const response = await client.query<{ shop?: { resourceLimits?: { maxProductOptions?: number; maxProductVariants?: number } } }>(
    store, "query ProductVariantLimits { shop { resourceLimits { maxProductOptions maxProductVariants } } }",
  );
  const options = response.shop?.resourceLimits?.maxProductOptions;
  const variants = response.shop?.resourceLimits?.maxProductVariants;
  if (typeof options !== "number" || !Number.isSafeInteger(options) || options < 1 ||
      typeof variants !== "number" || !Number.isSafeInteger(variants) || variants < 1) {
    throw new GatewayError("Không đọc được giới hạn biến thể Shopify của store; chưa gửi thay đổi.", "SHOPIFY_INVALID_INPUT", 400);
  }
  return { maxProductOptions: options, maxProductVariants: variants };
}
