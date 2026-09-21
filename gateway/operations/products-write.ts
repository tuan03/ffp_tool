import { GatewayError } from "../errors";
import type { ShopifyGraphqlClient } from "../shopify-graphql-client";
import type { ProductSummary, StoreConfig } from "../types";
import { mapProductNode, type RawProductNode } from "./products";

const PRODUCT_CREATE_MUTATION = `
  mutation ProductCreate($input: ProductInput!) {
    productCreate(input: $input) {
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

const PRODUCT_UPDATE_MUTATION = `
  mutation ProductUpdate($input: ProductInput!) {
    productUpdate(input: $input) {
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

interface MutationUserError {
  readonly field?: readonly string[];
  readonly message: string;
}

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
      readonly userErrors: readonly MutationUserError[];
    };
  }

  const raw = await client.query<ProductCreateResponse>(
    store,
    PRODUCT_CREATE_MUTATION,
    { input },
    { isWrite: true, requestId },
  );

  if (raw.productCreate.userErrors && raw.productCreate.userErrors.length > 0) {
    const errorMsg = raw.productCreate.userErrors.map((e) => e.message).join("; ");
    throw new GatewayError(errorMsg, "SHOPIFY_USER_ERROR", 400);
  }

  if (!raw.productCreate.product) {
    throw new GatewayError("Failed to create product; missing product data", "SHOPIFY_USER_ERROR", 400);
  }

  return { product: mapProductNode(raw.productCreate.product) };
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
      readonly userErrors: readonly MutationUserError[];
    };
  }

  const raw = await client.query<ProductUpdateResponse>(
    store,
    PRODUCT_UPDATE_MUTATION,
    { input },
    { isWrite: true, requestId },
  );

  if (raw.productUpdate.userErrors && raw.productUpdate.userErrors.length > 0) {
    const errorMsg = raw.productUpdate.userErrors.map((e) => e.message).join("; ");
    throw new GatewayError(errorMsg, "SHOPIFY_USER_ERROR", 400);
  }

  if (!raw.productUpdate.product) {
    throw new GatewayError(`Failed to update product ${id}`, "SHOPIFY_USER_ERROR", 400);
  }

  return { product: mapProductNode(raw.productUpdate.product) };
}

export async function executeProductsBulkUpdate(
  store: StoreConfig,
  client: ShopifyGraphqlClient,
  payload: unknown,
  mode: "preview" | "apply" = "apply",
  requestId?: string,
): Promise<{ updatedProductIds: readonly string[]; count: number }> {
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
    const updatedProductIds = products.map((item) => String(item.id));
    return {
      updatedProductIds,
      count: updatedProductIds.length,
    };
  }

  const updatedProductIds: string[] = [];
  for (const item of products) {
    const result = await executeProductsUpdate(store, client, item, "apply", requestId);
    updatedProductIds.push(result.product.id);
  }

  return {
    updatedProductIds,
    count: updatedProductIds.length,
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
      readonly userErrors: readonly MutationUserError[];
    };
  }

  const raw = await client.query<ProductDeleteResponse>(
    store,
    PRODUCT_DELETE_MUTATION,
    { input: { id } },
    { isWrite: true, requestId },
  );

  if (raw.productDelete.userErrors && raw.productDelete.userErrors.length > 0) {
    const errorMsg = raw.productDelete.userErrors.map((e) => e.message).join("; ");
    throw new GatewayError(errorMsg, "SHOPIFY_USER_ERROR", 400);
  }

  return {
    deletedProductId: raw.productDelete.deletedProductId ?? id,
  };
}
