import { GatewayError, mapUserErrorsToGatewayError, type MutationUserErrorItem } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { ProductSummary, ProductVariantSummary, StoreConfig } from "../types";
import { mapProductNode, type RawProductNode } from "./products";

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreate($product: ProductCreateInput!) {
    productCreate(product: $product) {
      product {
        id
        title
        handle
        descriptionHtml
        status
        vendor
        productType
        tags
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
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = `
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

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($product: ProductUpdateInput!) {
    productUpdate(product: $product) {
      product {
        id
        title
        handle
        descriptionHtml
        status
        vendor
        productType
        tags
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
      userErrors {
        field
        message
      }
    }
  }
`;

const PRODUCT_DELETE_MUTATION = `
  mutation ProductDelete($input: ProductDeleteInput!) {
    productDelete(input: $input) {
      deletedProductId
      userErrors {
        field
        message
      }
    }
  }
`;

export async function executeProductsCreate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ product: ProductSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const productInput = (p.product && typeof p.product === "object" ? p.product : undefined) as
    | Record<string, unknown>
    | undefined;

  if (!productInput) {
    throw new GatewayError("Product payload is required", "SHOPIFY_USER_ERROR", 400);
  }

  const title = typeof productInput.title === "string" ? productInput.title.trim() : "";
  if (!title) {
    throw new GatewayError("Product title is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const handle =
      typeof productInput.handle === "string" && productInput.handle.trim() !== ""
        ? productInput.handle.trim()
        : title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

    const previewProduct: ProductSummary = {
      id: "gid://shopify/Product/preview-new",
      title,
      handle,
      descriptionHtml:
        typeof productInput.descriptionHtml === "string" ? productInput.descriptionHtml : undefined,
      status:
        productInput.status === "ACTIVE" || productInput.status === "ARCHIVED" || productInput.status === "DRAFT"
          ? productInput.status
          : "DRAFT",
      vendor: typeof productInput.vendor === "string" ? productInput.vendor : undefined,
      productType: typeof productInput.productType === "string" ? productInput.productType : undefined,
      tags: Array.isArray(productInput.tags) ? (productInput.tags as string[]) : [],
      variants: [
        {
          id: "gid://shopify/ProductVariant/preview-var-1",
          productId: "gid://shopify/Product/preview-new",
          title: "Default Title",
          price: "0.00",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    return { product: previewProduct };
  }

  const input: Record<string, unknown> = { title };
  if (typeof productInput.handle === "string" && productInput.handle.trim() !== "") {
    input.handle = productInput.handle.trim();
  }
  if (typeof productInput.descriptionHtml === "string") {
    input.descriptionHtml = productInput.descriptionHtml;
  }
  if (typeof productInput.status === "string" && productInput.status.trim() !== "") {
    input.status = productInput.status.trim();
  }
  if (typeof productInput.vendor === "string") {
    input.vendor = productInput.vendor;
  }
  if (typeof productInput.productType === "string") {
    input.productType = productInput.productType;
  }
  if (Array.isArray(productInput.tags)) {
    input.tags = productInput.tags;
  }

  interface ProductCreateResponse {
    readonly productCreate: {
      readonly product: RawProductNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<ProductCreateResponse>(
    store,
    PRODUCT_CREATE_MUTATION,
    { product: input },
    { isWrite: true, requestId },
  );

  if (raw.productCreate.userErrors && raw.productCreate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productCreate.userErrors);
  }

  if (!raw.productCreate.product) {
    throw new GatewayError("Failed to create product; missing product data", "SHOPIFY_USER_ERROR", 400);
  }

  const product = mapProductNode(raw.productCreate.product);

  // If public input contains variants (>= 1), create variants via productVariantsBulkCreate
  // with strategy: REMOVE_STANDALONE_VARIANT so the initial default standalone variant is deleted
  if (Array.isArray(productInput.variants) && productInput.variants.length >= 1) {
    const allVariants = productInput.variants as readonly Record<string, unknown>[];
    const variantsInput = allVariants.map((v) => {
      const vInput: Record<string, unknown> = {};
      if (v.price !== undefined) vInput.price = v.price;
      if (v.compareAtPrice !== undefined) vInput.compareAtPrice = v.compareAtPrice;
      if (v.barcode !== undefined) vInput.barcode = v.barcode;
      if (v.sku !== undefined) vInput.inventoryItem = { sku: v.sku };
      if (Array.isArray(v.optionValues)) {
        vInput.optionValues = v.optionValues;
      } else if (typeof v.title === "string" && v.title.trim() !== "") {
        vInput.optionValues = [{ optionName: "Title", name: v.title.trim() }];
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

    try {
      const extraRaw = await client.query<ProductVariantsBulkCreateResponse>(
        store,
        PRODUCT_VARIANTS_BULK_CREATE_MUTATION,
        { productId: product.id, variants: variantsInput },
        { isWrite: true, requestId: requestId ? `${requestId}:variants` : undefined },
      );

      if (extraRaw.productVariantsBulkCreate.userErrors && extraRaw.productVariantsBulkCreate.userErrors.length > 0) {
        throw mapUserErrorsToGatewayError(extraRaw.productVariantsBulkCreate.userErrors);
      }

      if (extraRaw.productVariantsBulkCreate.productVariants) {
        const mappedVariants: ProductVariantSummary[] = extraRaw.productVariantsBulkCreate.productVariants.map((node) => ({
          id: node.id,
          productId: product.id,
          title: node.title,
          price: node.price,
          compareAtPrice: node.compareAtPrice ?? undefined,
          barcode: node.barcode ?? undefined,
          sku: node.inventoryItem?.sku ?? undefined,
          inventoryQuantity: node.inventoryQuantity ?? undefined,
        }));
        return {
          product: {
            ...product,
            variants: mappedVariants,
          },
        };
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      throw new GatewayError(
        `Product created (${product.id}) but failed to create variants: ${errMsg}`,
        "SHOPIFY_USER_ERROR",
        400,
        undefined,
        undefined,
        undefined,
        false,
        { createdProductId: product.id },
      );
    }
  }

  return { product };
}

export async function executeProductsUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ product: ProductSummary }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Product id is required", "SHOPIFY_USER_ERROR", 400);
  }

  const productPatch = (p.product && typeof p.product === "object" ? p.product : undefined) as
    | Record<string, unknown>
    | undefined;
  if (!productPatch) {
    throw new GatewayError("Product patch object is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    const now = new Date().toISOString();
    const previewProduct: ProductSummary = {
      id,
      title: typeof productPatch.title === "string" ? productPatch.title : "Preview Product",
      handle: typeof productPatch.handle === "string" ? productPatch.handle : "preview-product",
      descriptionHtml:
        typeof productPatch.descriptionHtml === "string" ? productPatch.descriptionHtml : undefined,
      status:
        productPatch.status === "ACTIVE" || productPatch.status === "ARCHIVED" || productPatch.status === "DRAFT"
          ? productPatch.status
          : "ACTIVE",
      vendor: typeof productPatch.vendor === "string" ? productPatch.vendor : undefined,
      productType: typeof productPatch.productType === "string" ? productPatch.productType : undefined,
      tags: Array.isArray(productPatch.tags) ? (productPatch.tags as string[]) : [],
      variants: [],
      createdAt: now,
      updatedAt: now,
    };
    return { product: previewProduct };
  }

  const input: Record<string, unknown> = { id };
  if (typeof productPatch.title === "string") {
    input.title = productPatch.title;
  }
  if (typeof productPatch.handle === "string") {
    input.handle = productPatch.handle;
  }
  if (typeof productPatch.descriptionHtml === "string") {
    input.descriptionHtml = productPatch.descriptionHtml;
  }
  if (typeof productPatch.status === "string") {
    input.status = productPatch.status;
  }
  if (typeof productPatch.vendor === "string") {
    input.vendor = productPatch.vendor;
  }
  if (typeof productPatch.productType === "string") {
    input.productType = productPatch.productType;
  }
  if (Array.isArray(productPatch.tags)) {
    input.tags = productPatch.tags;
  }

  interface ProductUpdateResponse {
    readonly productUpdate: {
      readonly product: RawProductNode | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<ProductUpdateResponse>(
    store,
    PRODUCT_UPDATE_MUTATION,
    { product: input },
    { isWrite: true, requestId },
  );

  if (raw.productUpdate.userErrors && raw.productUpdate.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productUpdate.userErrors);
  }

  if (!raw.productUpdate.product) {
    throw new GatewayError(`Failed to update product ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  return { product: mapProductNode(raw.productUpdate.product) };
}

export interface ProductBulkUpdateItemResult {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface ProductsBulkUpdateResult {
  readonly successCount: number;
  readonly failedCount: number;
  readonly updatedProductIds: readonly string[];
  readonly count: number;
  readonly items: readonly ProductBulkUpdateItemResult[];
}

async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const idx = currentIndex++;
      results[idx] = await fn(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function executeProductsBulkUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<ProductsBulkUpdateResult> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const products = p.products;
  if (!Array.isArray(products)) {
    throw new GatewayError("Products array is required", "SHOPIFY_USER_ERROR", 400);
  }

  for (const item of products) {
    if (!item || typeof item !== "object") {
      throw new GatewayError("Each product item must be an object", "SHOPIFY_USER_ERROR", 400);
    }
    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
      throw new GatewayError("Each product item must have a valid id", "SHOPIFY_USER_ERROR", 400);
    }
    if (!item.product || typeof item.product !== "object") {
      throw new GatewayError(`Product payload missing for item ${id}`, "SHOPIFY_USER_ERROR", 400);
    }
  }

  if (mode === "preview") {
    const items = products.map((item) => ({ id: String(item.id), ok: true }));
    return {
      successCount: items.length,
      failedCount: 0,
      updatedProductIds: items.map((i) => i.id),
      count: items.length,
      items,
    };
  }

  const results = await runWithConcurrency(
    products,
    3,
    async (item, index): Promise<ProductBulkUpdateItemResult & { readonly updatedId?: string }> => {
      const childRequestId = requestId ? `${requestId}:item-${index}` : undefined;
      try {
        const result = await executeProductsUpdate(store, client, item, "apply", childRequestId);
        return {
          id: result.product.id,
          ok: true,
          updatedId: result.product.id,
        };
      } catch (err: unknown) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        return {
          id: String(item.id),
          ok: false,
          error: errorMsg,
        };
      }
    },
  );

  const updatedProductIds: string[] = [];
  const items: ProductBulkUpdateItemResult[] = [];
  let successCount = 0;
  let failedCount = 0;

  for (const res of results) {
    items.push({ id: res.id, ok: res.ok, error: res.error });
    if (res.ok && res.updatedId) {
      updatedProductIds.push(res.updatedId);
      successCount += 1;
    } else {
      failedCount += 1;
    }
  }

  return {
    successCount,
    failedCount,
    updatedProductIds,
    count: updatedProductIds.length,
    items,
  };
}

export async function executeProductsDelete(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ deletedProductId: string }> {
  const p = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const id = typeof p.id === "string" ? p.id.trim() : "";
  if (!id) {
    throw new GatewayError("Product id is required", "SHOPIFY_USER_ERROR", 400);
  }

  if (mode === "preview") {
    return { deletedProductId: id };
  }

  interface ProductDeleteResponse {
    readonly productDelete: {
      readonly deletedProductId: string | null;
      readonly userErrors: readonly MutationUserErrorItem[];
    };
  }

  const raw = await client.query<ProductDeleteResponse>(
    store,
    PRODUCT_DELETE_MUTATION,
    { input: { id } },
    { isWrite: true, requestId },
  );

  if (raw.productDelete.userErrors && raw.productDelete.userErrors.length > 0) {
    throw mapUserErrorsToGatewayError(raw.productDelete.userErrors);
  }

  return {
    deletedProductId: raw.productDelete.deletedProductId ?? id,
  };
}
