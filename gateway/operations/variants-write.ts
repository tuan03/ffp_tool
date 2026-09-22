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
  if (variantPatch.sku !== undefined || variantPatch.inventoryTracked !== undefined) {
    const inv: Record<string, unknown> = {};
    if (variantPatch.sku !== undefined) {
      inv.sku = typeof variantPatch.sku === "string" ? variantPatch.sku : undefined;
    }
    if (variantPatch.inventoryTracked !== undefined) {
      const isTracked = variantPatch.inventoryTracked === true;
      inv.tracked = isTracked;
      input.inventoryPolicy = isTracked ? "DENY" : "CONTINUE";
    }
    input.inventoryItem = inv;
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

  if ("title" in variantPatch && variantPatch.title !== undefined) {
    throw new GatewayError(
      "Updating variant title directly is not supported; variant titles are derived from optionValues",
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  if ("inventoryQuantity" in variantPatch && variantPatch.inventoryQuantity !== undefined) {
    throw new GatewayError(
      "Updating inventoryQuantity via variants.update is not supported; use the Shopify Inventory API",
      "SHOPIFY_INVALID_INPUT",
      400,
    );
  }

  if (mode === "preview") {
    const previewVariant: ProductVariantSummary = {
      id,
      productId:
        typeof variantPatch.productId === "string" && variantPatch.productId.trim() !== ""
          ? variantPatch.productId.trim()
          : "gid://shopify/Product/preview-1",
      title: "Preview Variant",
      price: typeof variantPatch.price === "string" ? variantPatch.price : "0.00",
      compareAtPrice:
        typeof variantPatch.compareAtPrice === "string" ? variantPatch.compareAtPrice : undefined,
      sku: typeof variantPatch.sku === "string" ? variantPatch.sku : undefined,
      barcode: typeof variantPatch.barcode === "string" ? variantPatch.barcode : undefined,
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
    const rawVariant = item.variant as Record<string, unknown>;
    if ("title" in rawVariant && rawVariant.title !== undefined) {
      throw new GatewayError(
        "Updating variant title directly is not supported; variant titles are derived from optionValues",
        "SHOPIFY_INVALID_INPUT",
        400,
      );
    }
    if ("inventoryQuantity" in rawVariant && rawVariant.inventoryQuantity !== undefined) {
      throw new GatewayError(
        "Updating inventoryQuantity via variants.update is not supported; use the Shopify Inventory API",
        "SHOPIFY_INVALID_INPUT",
        400,
      );
    }
  }

  if (mode === "preview") {
    const updatedVariantIds = variants.map((item) => String(item.id));
    return {
      updatedVariantIds,
      count: updatedVariantIds.length,
    };
  }

  interface VariantBulkTask {
    readonly id: string;
    readonly productId: string;
    readonly variantInput: Record<string, unknown>;
  }

  const tasks: VariantBulkTask[] = [];
  const resolvedCache = new Map<string, string>();
  for (const item of variants) {
    const id = String(item.id).trim();
    const rawVariant = item.variant as Record<string, unknown>;
    const explicitProdId =
      typeof rawVariant.productId === "string" && rawVariant.productId.trim() !== ""
        ? rawVariant.productId.trim()
        : typeof item.productId === "string" && (item.productId as string).trim() !== ""
        ? (item.productId as string).trim()
        : undefined;

    let productId: string;
    if (explicitProdId) {
      productId = explicitProdId;
    } else if (resolvedCache.has(id)) {
      productId = resolvedCache.get(id)!;
    } else {
      productId = await resolveParentProductId(store, client, id, undefined);
      resolvedCache.set(id, productId);
    }
    const variantInput = buildVariantBulkInput(id, rawVariant);
    tasks.push({ id, productId, variantInput });
  }

  // Group by productId to execute productVariantsBulkUpdate per product
  const productGroups = new Map<string, VariantBulkTask[]>();
  for (const task of tasks) {
    let group = productGroups.get(task.productId);
    if (!group) {
      group = [];
      productGroups.set(task.productId, group);
    }
    group.push(task);
  }

  const updatedVariantIds: string[] = [];
  let groupIndex = 0;
  for (const [productId, group] of productGroups.entries()) {
    const childRequestId = requestId ? `${requestId}:prod-${groupIndex}` : undefined;
    groupIndex++;

    try {
      const raw = await client.query<ProductVariantsBulkUpdateResponse>(
        store,
        PRODUCT_VARIANTS_BULK_UPDATE_MUTATION,
        {
          productId,
          variants: group.map((g) => g.variantInput),
        },
        { isWrite: true, requestId: childRequestId },
      );

      if (!raw || !raw.productVariantsBulkUpdate) {
        throw new GatewayError(
          `Failed to update variants for product ${productId}: productVariantsBulkUpdate returned no data`,
          "SHOPIFY_USER_ERROR",
          400,
        );
      }

      if (raw.productVariantsBulkUpdate.userErrors && raw.productVariantsBulkUpdate.userErrors.length > 0) {
        throw mapUserErrorsToGatewayError(raw.productVariantsBulkUpdate.userErrors);
      }

      if (raw.productVariantsBulkUpdate.productVariants && raw.productVariantsBulkUpdate.productVariants.length > 0) {
        for (const v of raw.productVariantsBulkUpdate.productVariants) {
          updatedVariantIds.push(v.id);
        }
      } else {
        for (const g of group) {
          updatedVariantIds.push(g.id);
        }
      }
    } catch (err: unknown) {
      if (updatedVariantIds.length > 0) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const fields = err instanceof GatewayError ? err.fields : undefined;
        throw new GatewayError(
          `Variants partially updated (${updatedVariantIds.length} succeeded), but failed for product ${productId}: ${errMsg}`,
          "SHOPIFY_PARTIAL_WRITE",
          409,
          undefined,
          err,
          fields,
          false,
          { updatedVariantIds: [...updatedVariantIds], failedProductId: productId, reconciliationRequired: true },
          true,
        );
      }
      throw err;
    }
  }

  return {
    updatedVariantIds,
    count: updatedVariantIds.length,
  };
}

export const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `
  mutation ProductVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkCreate(productId: $productId, variants: $variants, strategy: REMOVE_STANDALONE_VARIANT) {
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
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function executeVariantsBulkCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ createdCount: number; variants: readonly ProductVariantSummary[] }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const productId = typeof p.productId === "string" ? p.productId.trim() : "";
  if (!productId) {
    throw new GatewayError("Product id is required", "SHOPIFY_USER_ERROR", 400);
  }

  const variants = p.variants;
  if (!Array.isArray(variants)) {
    throw new GatewayError("Variants array is required", "SHOPIFY_USER_ERROR", 400);
  }

  for (const item of variants) {
    if (!item || typeof item !== "object") {
      throw new GatewayError("Each variant item must be an object", "SHOPIFY_USER_ERROR", 400);
    }
  }

  if (variants.length === 0) {
    return {
      createdCount: 0,
      variants: [],
    };
  }

  if (mode === "preview") {
    const previewVariants: ProductVariantSummary[] = variants.map((item, index) => {
      const raw = item as Record<string, unknown>;
      const title =
        typeof raw.title === "string" && raw.title.trim() !== ""
          ? raw.title.trim()
          : Array.isArray(raw.optionValues)
          ? (raw.optionValues as readonly Record<string, unknown>[])
              .map((ov) => (typeof ov.name === "string" ? ov.name : typeof ov.value === "string" ? ov.value : ""))
              .filter(Boolean)
              .join(" / ") || "Default Title"
          : "Default Title";

      return {
        id: `gid://shopify/ProductVariant/preview-created-${index + 1}`,
        productId,
        title,
        price: typeof raw.price === "string" ? raw.price : "0.00",
        compareAtPrice: typeof raw.compareAtPrice === "string" ? raw.compareAtPrice : undefined,
        sku: typeof raw.sku === "string" ? raw.sku : undefined,
        barcode: typeof raw.barcode === "string" ? raw.barcode : undefined,
      };
    });

    return {
      createdCount: previewVariants.length,
      variants: previewVariants,
    };
  }

  const variantsInput = variants.map((item) => {
    const raw = item as Record<string, unknown>;
    const vInput: Record<string, unknown> = {};
    if (raw.price !== undefined) vInput.price = raw.price;
    if (raw.compareAtPrice !== undefined) vInput.compareAtPrice = raw.compareAtPrice;
    if (raw.barcode !== undefined) vInput.barcode = raw.barcode;
    const isTracked = raw.inventoryTracked === true;
    vInput.inventoryItem = {
      sku: typeof raw.sku === "string" ? raw.sku : undefined,
      tracked: isTracked,
    };
    vInput.inventoryPolicy = isTracked ? "DENY" : "CONTINUE";
    if (Array.isArray(raw.optionValues)) {
      vInput.optionValues = (raw.optionValues as readonly Record<string, unknown>[]).map((ov) => {
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
    } else if (typeof raw.title === "string" && raw.title.trim() !== "") {
      vInput.optionValues = [{ optionName: "Title", name: raw.title.trim() }];
    } else {
      vInput.optionValues = [{ optionName: "Title", name: "Default Title" }];
    }
    return vInput;
  });

  interface ProductVariantsBulkCreateResponse {
    readonly productVariantsBulkCreate: {
      readonly productVariants: readonly {
        readonly id: string;
        readonly title: string;
        readonly price: string;
        readonly compareAtPrice?: string | null;
        readonly barcode?: string | null;
        readonly inventoryQuantity?: number | null;
        readonly inventoryItem?: { readonly sku?: string | null } | null;
      }[] | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<ProductVariantsBulkCreateResponse>(
    store,
    PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
    { productId, variants: variantsInput },
    { isWrite: true, requestId },
  );

  if (raw.productVariantsBulkCreate.userErrors && raw.productVariantsBulkCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productVariantsBulkCreate.userErrors);
  }

  const mappedVariants: ProductVariantSummary[] = (raw.productVariantsBulkCreate.productVariants ?? []).map((node) => ({
    id: node.id,
    productId,
    title: node.title,
    price: node.price,
    compareAtPrice: node.compareAtPrice ?? undefined,
    barcode: node.barcode ?? undefined,
    sku: node.inventoryItem?.sku ?? undefined,
    inventoryQuantity: node.inventoryQuantity ?? undefined,
  }));

  return {
    createdCount: mappedVariants.length,
    variants: mappedVariants,
  };
}

