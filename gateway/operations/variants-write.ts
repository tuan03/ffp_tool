import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { ProductVariantSummary, StoreConfig } from "../types";

const PRODUCT_VARIANT_UPDATE_MUTATION = `
  mutation ProductVariantUpdate($input: ProductVariantInput!) {
    productVariantUpdate(input: $input) {
      productVariant {
        id
        title
        price
        barcode
        inventoryQuantity
        inventoryItem {
          sku
        }
        product {
          id
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

interface MutationUserError {
  readonly field?: readonly string[];
  readonly message: string;
}

interface RawVariantUpdateNode {
  readonly id: string;
  readonly title: string;
  readonly price: string;
  readonly barcode?: string | null;
  readonly inventoryQuantity?: number | null;
  readonly inventoryItem?: { readonly sku?: string | null } | null;
  readonly product?: { readonly id?: string | null } | null;
}

export async function executeVariantsUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ variant: ProductVariantSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Variant id is required", "SHOPIFY_USER_ERROR", 400);
  }

  const variantPatch = (p.variant && typeof p.variant === "object" ? p.variant : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!variantPatch) {
    throw new GatewayError("Variant patch object is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const previewVariant: ProductVariantSummary = {
      id,
      productId: "gid://shopify/Product/preview-1",
      title: typeof variantPatch.title === "string" ? variantPatch.title : "Preview Variant",
      price: typeof variantPatch.price === "string" ? variantPatch.price : "0.00",
      sku: typeof variantPatch.sku === "string" ? variantPatch.sku : undefined,
      barcode: typeof variantPatch.barcode === "string" ? variantPatch.barcode : undefined,
      inventoryQuantity:
        typeof variantPatch.inventoryQuantity === "number" ? variantPatch.inventoryQuantity : undefined,
    };
    return { variant: previewVariant };
  }

  const input: Record<string, unknown> = { id };
  if (typeof variantPatch.price === "string") {
    input.price = variantPatch.price;
  }
  if (typeof variantPatch.barcode === "string") {
    input.barcode = variantPatch.barcode;
  }
  // Mapping top-level sku to inventoryItem { sku }
  if (typeof variantPatch.sku === "string") {
    input.inventoryItem = { sku: variantPatch.sku };
  }

  interface VariantUpdateResponse {
    readonly productVariantUpdate: {
      readonly productVariant: RawVariantUpdateNode | null;
      readonly userErrors: readonly MutationUserError[];
    };
  }

  const raw = await client.query<VariantUpdateResponse>(
    store,
    PRODUCT_VARIANT_UPDATE_MUTATION,
    { input },
    { isWrite: true, requestId },
  );

  if (raw.productVariantUpdate.userErrors && raw.productVariantUpdate.userErrors.length > 0) {
    const errorMsg = raw.productVariantUpdate.userErrors.map((e) => e.message).join("; ");
    throw new GatewayError(errorMsg, "SHOPIFY_USER_ERROR", 400);
  }

  const node = raw.productVariantUpdate.productVariant;
  if (!node) {
    throw new GatewayError(`Failed to update variant ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  const variant: ProductVariantSummary = {
    id: node.id,
    productId: node.product?.id ?? "",
    title: node.title,
    price: node.price,
    sku: node.inventoryItem?.sku ?? undefined,
    barcode: node.barcode ?? undefined,
    inventoryQuantity: node.inventoryQuantity ?? undefined,
  };

  return { variant };
}

export async function executeVariantsBulkUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ updatedVariantIds: readonly string[]; count: number }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const variants = p.variants;
  if (!Array.isArray(variants)) {
    throw new GatewayError("Variants array is required", "SHOPIFY_USER_ERROR", 400);
  }

  for (const item of variants) {
    if (!item || typeof item !== "object") {
      throw new GatewayError("Each variant item must be an object", "SHOPIFY_USER_ERROR", 400);
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      throw new GatewayError("Each variant item must have a valid id", "SHOPIFY_USER_ERROR", 400);
    }
    if (!item.variant || typeof item.variant !== "object") {
      throw new GatewayError(`Variant payload missing for item ${id}`, "SHOPIFY_USER_ERROR", 400);
    }
  }

  if (mode === "preview") {
    const updatedVariantIds = variants.map((item) => String(item.id));
    return {
      updatedVariantIds,
      count: updatedVariantIds.length,
    };
  }

  const updatedVariantIds: string[] = [];
  for (const item of variants) {
    const result = await executeVariantsUpdate(store, client, item, "apply", requestId);
    updatedVariantIds.push(result.variant.id);
  }

  return {
    updatedVariantIds,
    count: updatedVariantIds.length,
  };
}
