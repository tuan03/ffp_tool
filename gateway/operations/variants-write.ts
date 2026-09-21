import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { ProductVariantSummary, StoreConfig } from "../types";

const PRODUCT_VARIANTS_BULK_UPDATE_MUTATION = `
  mutation ProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants {
        id
        title
        price
        compareAtPrice
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

const RESOLVE_VARIANT_PRODUCT_QUERY = `
  query ResolveVariantProduct($id: ID!) {
    node(id: $id) {
      ... on ProductVariant {
        id
        product {
          id
        }
      }
    }
  }
`;

interface RawVariantBulkNode {
  readonly id: string;
  readonly title: string;
  readonly price: string;
  readonly compareAtPrice?: string | null;
  readonly barcode?: string | null;
  readonly inventoryQuantity?: number | null;
  readonly inventoryItem?: { readonly sku?: string | null } | null;
  readonly product?: { readonly id?: string | null } | null;
}

interface ProductVariantsBulkUpdateResponse {
  readonly productVariantsBulkUpdate: {
    readonly productVariants: readonly RawVariantBulkNode[] | null;
    readonly userErrors: readonly MutationUserErrorItem[];
  };
}

async function resolveParentProductId(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  variantId: string,
  explicitProductId?: string,
): Promise<string> {
  if (explicitProductId && explicitProductId.trim() !== "") {
    return explicitProductId.trim();
  }

  interface NodeQueryResponse {
    readonly node: {
      readonly id: string;
      readonly product?: {
        readonly id?: string | null;
      } | null;
    } | null;
  }

  const res = await client.query<NodeQueryResponse>(
    store,
    RESOLVE_VARIANT_PRODUCT_QUERY,
    { id: variantId },
    { isWrite: false },
  );

  const prodId = res?.node?.product?.id;
  if (!prodId) {
    throw new GatewayError(
      `Could not resolve parent product ID for variant ${variantId}`,
      "SHOPIFY_USER_ERROR",
      400,
    );
  }

  return prodId;
}

function buildVariantBulkInput(
  variantId: string,
  variantPatch: Record<string, unknown>,
): Record<string, unknown> {
  const input: Record<string, unknown> = { id: variantId };
  if (variantPatch.price !== undefined) {
    input.price = variantPatch.price;
  }
  if (variantPatch.compareAtPrice !== undefined) {
    input.compareAtPrice = variantPatch.compareAtPrice;
  }
  if (variantPatch.barcode !== undefined) {
    input.barcode = variantPatch.barcode;
  }
  if (variantPatch.sku !== undefined) {
    input.inventoryItem = { sku: variantPatch.sku };
  }
  if (Array.isArray(variantPatch.optionValues)) {
    input.optionValues = variantPatch.optionValues.map((ov: Record<string, unknown>) => {
      const optVal: Record<string, unknown> = {};
      if (typeof ov.optionName === "string") optVal.optionName = ov.optionName;
      if (typeof ov.name === "string") {
        optVal.name = ov.name;
      } else if (typeof ov.value === "string") {
        optVal.name = ov.value;
      }
      if (typeof ov.optionId === "string") optVal.optionId = ov.optionId;
      if (typeof ov.id === "string") optVal.id = ov.id;
      return optVal;
    });
  }
  return input;
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
      productId:
        typeof variantPatch.productId === "string" && variantPatch.productId.trim() !== ""
          ? variantPatch.productId.trim()
          : "gid://shopify/Product/preview-1",
      title: typeof variantPatch.title === "string" ? variantPatch.title : "Preview Variant",
      price: typeof variantPatch.price === "string" ? variantPatch.price : "0.00",
      compareAtPrice:
        typeof variantPatch.compareAtPrice === "string" ? variantPatch.compareAtPrice : undefined,
      sku: typeof variantPatch.sku === "string" ? variantPatch.sku : undefined,
      barcode: typeof variantPatch.barcode === "string" ? variantPatch.barcode : undefined,
      inventoryQuantity:
        typeof variantPatch.inventoryQuantity === "number" ? variantPatch.inventoryQuantity : undefined,
    };
    return { variant: previewVariant };
  }

  const explicitProdId =
    typeof variantPatch.productId === "string" && variantPatch.productId.trim() !== ""
      ? variantPatch.productId.trim()
      : typeof p.productId === "string" && (p.productId as string).trim() !== ""
      ? (p.productId as string).trim()
      : undefined;

  const productId = await resolveParentProductId(store, client, id, explicitProdId);
  const variantInput = buildVariantBulkInput(id, variantPatch);

  const raw = await client.query<ProductVariantsBulkUpdateResponse>(
    store,
    PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
    { productId, variants: [variantInput] },
    { isWrite: true, requestId },
  );

  if (raw.productVariantsBulkUpdate.userErrors && raw.productVariantsBulkUpdate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productVariantsBulkUpdate.userErrors);
  }

  const node = raw.productVariantsBulkUpdate.productVariants?.[0];
  if (!node) {
    throw new GatewayError(`Failed to update variant ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  const variant: ProductVariantSummary = {
    id: node.id,
    productId: node.product?.id ?? productId,
    title: node.title,
    price: node.price,
    compareAtPrice: node.compareAtPrice ?? undefined,
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
  for (let i = 0; i < variants.length; i++) {
    const item = variants[i];
    const childRequestId = requestId ? `${requestId}:var-${i}` : undefined;
    const result = await executeVariantsUpdate(store, client, item, "apply", childRequestId);
    updatedVariantIds.push(result.variant.id);
  }

  return {
    updatedVariantIds,
    count: updatedVariantIds.length,
  };
}
