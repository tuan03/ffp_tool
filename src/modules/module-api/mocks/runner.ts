import type {
  ShopifyApiInput,
  ShopifyApiResponse,
  ShopifyCollection,
  ShopifyCollectionsCreateInput,
  ShopifyCollectionsCreateResponse,
  ShopifyCollectionsDeleteInput,
  ShopifyCollectionsDeleteResponse,
  ShopifyCollectionsGetInput,
  ShopifyCollectionsGetResponse,
  ShopifyCollectionsListInput,
  ShopifyCollectionsListResponse,
  ShopifyCollectionsUpdateInput,
  ShopifyCollectionsUpdateMembershipInput,
  ShopifyCollectionsUpdateMembershipResponse,
  ShopifyCollectionsUpdateResponse,
  ShopifyConnectionTestInput,
  ShopifyConnectionTestResponse,
  ShopifyPageInfo,
  ShopifyProduct,
  ShopifyProductVariant,
  ShopifyProductsBulkUpdateInput,
  ShopifyProductsBulkUpdateResponse,
  ShopifyProductsCreateInput,
  ShopifyProductsCreateResponse,
  ShopifyProductsDeleteInput,
  ShopifyProductsDeleteResponse,
  ShopifyProductsGetInput,
  ShopifyProductsGetResponse,
  ShopifyProductsListInput,
  ShopifyProductsListResponse,
  ShopifyProductsUpdateInput,
  ShopifyProductsUpdateResponse,
  ShopifyStoreSummary,
  ShopifyStoresGetInput,
  ShopifyStoresGetResponse,
  ShopifyStoresListInput,
  ShopifyStoresListResponse,
  ShopifyVariantsBulkUpdateInput,
  ShopifyVariantsBulkUpdateResponse,
  ShopifyVariantsUpdateInput,
  ShopifyVariantsUpdateResponse,
} from "../types";
import { ShopifyApiError } from "../types";
import {
  shopifyMockCollections,
  shopifyMockConnection,
  shopifyMockProducts,
} from "./data";

const mockStores: ShopifyStoreSummary[] = [
  {
    storeId: "capozen",
    shopDomain: "capozen.myshopify.com",
    apiVersion: "2026-07",
    authType: "static",
    connected: true,
  },
];

function cloneVariant(variant: ShopifyProductVariant): ShopifyProductVariant {
  return { ...variant };
}

function cloneProduct(product: ShopifyProduct): ShopifyProduct {
  return {
    ...product,
    tags: [...product.tags],
    variants: product.variants.map(cloneVariant),
    seo: product.seo ? { ...product.seo } : undefined,
    featuredImage: product.featuredImage ? { ...product.featuredImage } : undefined,
    images: product.images ? product.images.map((img) => ({ ...img })) : undefined,
  };
}

function cloneCollection(collection: ShopifyCollection): ShopifyCollection {
  return {
    ...collection,
    seo: collection.seo ? { ...collection.seo } : undefined,
  };
}

function encodeCursor(index: number): string {
  if (typeof btoa === "function") {
    return btoa(`cursor:${index}`);
  }
  return `cursor-${index}`;
}

function decodeCursor(cursor?: string): number | null {
  if (!cursor) {
    return null;
  }
  if (cursor.startsWith("cursor-")) {
    const parsed = Number.parseInt(cursor.slice(7), 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof atob === "function") {
    try {
      const decoded = atob(cursor);
      if (decoded.startsWith("cursor:")) {
        const parsed = Number.parseInt(decoded.slice(7), 10);
        return Number.isNaN(parsed) ? null : parsed;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function paginateItems<T>(
  items: readonly T[],
  limitParam?: number,
  cursorParam?: string,
): { pageItems: T[]; pageInfo: ShopifyPageInfo } {
  const limit = limitParam ?? 50;
  if (limit <= 0) {
    throw new ShopifyApiError("Limit must be greater than 0", "SHOPIFY_USER_ERROR");
  }

  const decoded = decodeCursor(cursorParam);
  const startIndex = decoded !== null ? decoded + 1 : 0;
  const pageItems = items.slice(startIndex, startIndex + limit);
  const hasNextPage = startIndex + pageItems.length < items.length;
  const hasPreviousPage = startIndex > 0;

  return {
    pageItems,
    pageInfo: {
      hasNextPage,
      hasPreviousPage,
      startCursor: pageItems.length > 0 ? encodeCursor(startIndex) : undefined,
      endCursor: pageItems.length > 0 ? encodeCursor(startIndex + pageItems.length - 1) : undefined,
    },
  };
}

export async function runMockModuleApi(input: ShopifyConnectionTestInput): Promise<ShopifyConnectionTestResponse>;
export async function runMockModuleApi(input: ShopifyProductsListInput): Promise<ShopifyProductsListResponse>;
export async function runMockModuleApi(input: ShopifyProductsGetInput): Promise<ShopifyProductsGetResponse>;
export async function runMockModuleApi(input: ShopifyProductsCreateInput): Promise<ShopifyProductsCreateResponse>;
export async function runMockModuleApi(input: ShopifyProductsUpdateInput): Promise<ShopifyProductsUpdateResponse>;
export async function runMockModuleApi(input: ShopifyProductsBulkUpdateInput): Promise<ShopifyProductsBulkUpdateResponse>;
export async function runMockModuleApi(input: ShopifyProductsDeleteInput): Promise<ShopifyProductsDeleteResponse>;
export async function runMockModuleApi(input: ShopifyVariantsUpdateInput): Promise<ShopifyVariantsUpdateResponse>;
export async function runMockModuleApi(input: ShopifyVariantsBulkUpdateInput): Promise<ShopifyVariantsBulkUpdateResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsListInput): Promise<ShopifyCollectionsListResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsGetInput): Promise<ShopifyCollectionsGetResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsCreateInput): Promise<ShopifyCollectionsCreateResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsUpdateInput): Promise<ShopifyCollectionsUpdateResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsDeleteInput): Promise<ShopifyCollectionsDeleteResponse>;
export async function runMockModuleApi(input: ShopifyCollectionsUpdateMembershipInput): Promise<ShopifyCollectionsUpdateMembershipResponse>;
export async function runMockModuleApi(input: ShopifyStoresListInput): Promise<ShopifyStoresListResponse>;
export async function runMockModuleApi(input: ShopifyStoresGetInput): Promise<ShopifyStoresGetResponse>;
export async function runMockModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse>;
export async function runMockModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse> {
  if (!input || typeof input !== "object") {
    throw new ShopifyApiError("Input must be a valid object", "SHOPIFY_USER_ERROR");
  }

  const effectivePayload =
    input.payload !== undefined && input.payload !== null
      ? input.payload
      : input.operation === "stores.list"
      ? {}
      : undefined;

  if (!effectivePayload || typeof effectivePayload !== "object") {
    throw new ShopifyApiError("Payload is required", "SHOPIFY_USER_ERROR");
  }

  if (input.operation === "stores.get") {
    const p = effectivePayload as Record<string, unknown>;
    const targetId = typeof p.targetStoreId === "string" ? p.targetStoreId.trim() : "";
    if (!targetId) {
      throw new ShopifyApiError("targetStoreId is required", "SHOPIFY_USER_ERROR");
    }
  }

  const payloadTargetId =
    effectivePayload && typeof effectivePayload === "object" && "targetStoreId" in effectivePayload
      ? (effectivePayload as { targetStoreId?: string }).targetStoreId
      : undefined;

  const effectiveStoreId =
    typeof input.storeId === "string" && input.storeId.trim() !== ""
      ? input.storeId.trim()
      : typeof payloadTargetId === "string" && payloadTargetId.trim() !== ""
      ? payloadTargetId.trim()
      : input.operation === "stores.list"
      ? "system"
      : "";

  if (!effectiveStoreId) {
    throw new ShopifyApiError("Store ID is required", "SHOPIFY_USER_ERROR");
  }

  if (input.storeId === "simulate-user-error") {
    throw new ShopifyApiError("Simulated Shopify user error", "SHOPIFY_USER_ERROR");
  }

  if (input.storeId === "simulate-auth-failure") {
    throw new ShopifyApiError("Simulated Shopify authentication failure", "SHOPIFY_AUTH_FAILED");
  }

  if (input.storeId === "simulate-throttled") {
    throw new ShopifyApiError("Simulated Shopify rate limit throttling", "SHOPIFY_THROTTLED");
  }

  if (input.storeId === "simulate-network-error") {
    throw new ShopifyApiError("Simulated network connection error", "SHOPIFY_NETWORK_ERROR");
  }

  if (input.storeId === "simulate-unknown-state") {
    throw new ShopifyApiError("Simulated unknown write state", "SHOPIFY_UNKNOWN_WRITE_STATE");
  }

  if (input.storeId === "simulate-partial-write") {
    throw new ShopifyApiError(
      "Simulated partial write",
      "SHOPIFY_PARTIAL_WRITE",
      undefined,
      undefined,
      false,
      { createdProductId: "gid://shopify/Product/simulated-partial" },
      true,
    );
  }

  switch (input.operation) {
    case "connection.test": {
      return {
        storeId: input.storeId,
        operation: "connection.test",
        success: true,
        data: { ...shopifyMockConnection },
      };
    }

    case "products.list": {
      let filtered = shopifyMockProducts.map((p) => ({
        ...cloneProduct(p),
        variants: [],
      }));

      if (input.payload.status) {
        filtered = filtered.filter((product) => product.status === input.payload.status);
      }

      if (input.payload.query) {
        const queryLower = input.payload.query.toLowerCase();
        filtered = filtered.filter((product) =>
          product.title.toLowerCase().includes(queryLower) ||
          product.handle.toLowerCase().includes(queryLower),
        );
      }

      const { pageItems, pageInfo } = paginateItems(filtered, input.payload.limit, input.payload.cursor);

      return {
        storeId: input.storeId,
        operation: "products.list",
        success: true,
        data: {
          products: pageItems,
          pageInfo,
        },
      };
    }

    case "products.get": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Product ID is required", "SHOPIFY_USER_ERROR");
      }
      const found = shopifyMockProducts.find((p) => p.id === input.payload.id);
      return {
        storeId: input.storeId,
        operation: "products.get",
        success: true,
        data: {
          product: found ? cloneProduct(found) : null,
        },
      };
    }

    case "products.create": {
      if (!input.payload.product?.title || input.payload.product.title.trim() === "") {
        throw new ShopifyApiError("Product title is required", "SHOPIFY_USER_ERROR");
      }
      const now = new Date().toISOString();
      const variants: ShopifyProductVariant[] =
        Array.isArray(input.payload.product.variants) && input.payload.product.variants.length > 0
          ? input.payload.product.variants.map((v, idx) => ({
              id: `gid://shopify/ProductVariant/mock-var-${shopifyMockProducts.length + 1}-${idx + 1}`,
              productId: `gid://shopify/Product/mock-created-${shopifyMockProducts.length + 1}`,
              title:
                v.title ??
                (Array.isArray(v.optionValues)
                  ? v.optionValues
                      .map((ov: { readonly name?: string; readonly value?: string }) => ov.name ?? ov.value)
                      .filter(Boolean)
                      .join(" / ") || "Default Title"
                  : "Default Title"),
              price: v.price ?? "19.99",
              compareAtPrice: v.compareAtPrice,
              sku: v.sku,
              barcode: v.barcode,
            }))
          : [
              {
                id: `gid://shopify/ProductVariant/mock-var-${shopifyMockProducts.length + 1}`,
                productId: `gid://shopify/Product/mock-created-${shopifyMockProducts.length + 1}`,
                title: "Default Title",
                price: "19.99",
              },
            ];

      const description =
        input.payload.product.description ??
        (input.payload.product.descriptionHtml
          ? input.payload.product.descriptionHtml.replace(/<[^>]*>/g, "").trim()
          : undefined);
      const onlineStoreUrl =
        input.payload.product.onlineStoreUrl ??
        `https://quickstart-demo.myshopify.com/products/${input.payload.product.handle ?? input.payload.product.title.toLowerCase().replace(/\s+/g, "-")}`;
      const featuredImage = input.payload.product.featuredImage
        ? { ...input.payload.product.featuredImage }
        : input.payload.product.images?.[0]
        ? { ...input.payload.product.images[0] }
        : undefined;
      const images = input.payload.product.images
        ? input.payload.product.images.map((img) => ({ ...img }))
        : input.payload.product.featuredImage
        ? [{ ...input.payload.product.featuredImage }]
        : undefined;

      const newProduct: ShopifyProduct = {
        id: `gid://shopify/Product/mock-created-${shopifyMockProducts.length + 1}`,
        title: input.payload.product.title,
        handle: input.payload.product.handle ?? input.payload.product.title.toLowerCase().replace(/\s+/g, "-"),
        description,
        descriptionHtml: input.payload.product.descriptionHtml,
        status: input.payload.product.status ?? "DRAFT",
        vendor: input.payload.product.vendor,
        productType: input.payload.product.productType,
        tags: input.payload.product.tags ? [...input.payload.product.tags] : [],
        onlineStoreUrl,
        featuredImage,
        images,
        variants,
        seo: input.payload.product.seo ? { ...input.payload.product.seo } : undefined,
        createdAt: now,
        updatedAt: now,
      };

      return {
        storeId: input.storeId,
        operation: "products.create",
        success: true,
        data: { product: newProduct },
      };
    }

    case "products.update": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Product ID is required", "SHOPIFY_USER_ERROR");
      }
      const existing = shopifyMockProducts.find((p) => p.id === input.payload.id);
      const description =
        input.payload.product.description ??
        (input.payload.product.descriptionHtml !== undefined
          ? input.payload.product.descriptionHtml.replace(/<[^>]*>/g, "").trim()
          : existing?.description);
      const onlineStoreUrl = input.payload.product.onlineStoreUrl ?? existing?.onlineStoreUrl;
      const featuredImage = input.payload.product.featuredImage
        ? { ...input.payload.product.featuredImage }
        : existing?.featuredImage
        ? { ...existing.featuredImage }
        : undefined;
      const images = input.payload.product.images
        ? input.payload.product.images.map((img) => ({ ...img }))
        : existing?.images
        ? existing.images.map((img) => ({ ...img }))
        : undefined;

      const updatedProduct: ShopifyProduct = {
        id: input.payload.id,
        title: input.payload.product.title ?? existing?.title ?? "Updated Product",
        handle: input.payload.product.handle ?? existing?.handle ?? "updated-product",
        description,
        descriptionHtml: input.payload.product.descriptionHtml ?? existing?.descriptionHtml,
        status: input.payload.product.status ?? existing?.status ?? "ACTIVE",
        vendor: input.payload.product.vendor ?? existing?.vendor,
        productType: input.payload.product.productType ?? existing?.productType,
        tags: input.payload.product.tags ? [...input.payload.product.tags] : (existing?.tags ? [...existing.tags] : []),
        onlineStoreUrl,
        featuredImage,
        images,
        variants: existing ? existing.variants.map(cloneVariant) : [],
        seo: input.payload.product.seo ? { ...input.payload.product.seo } : existing?.seo,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        storeId: input.storeId,
        operation: "products.update",
        success: true,
        data: { product: updatedProduct },
      };
    }

    case "products.bulkUpdate": {
      if (!input.payload.products || !Array.isArray(input.payload.products)) {
        throw new ShopifyApiError("Products array is required", "SHOPIFY_USER_ERROR");
      }
      return {
        storeId: input.storeId,
        operation: "products.bulkUpdate",
        success: true,
        data: {
          updatedProductIds: input.payload.products.map((item) => item.id),
          count: input.payload.products.length,
          successCount: input.payload.products.length,
          failedCount: 0,
          items: input.payload.products.map((item) => ({ id: item.id, ok: true })),
        },
      };
    }

    case "products.delete": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Product ID is required", "SHOPIFY_USER_ERROR");
      }
      return {
        storeId: input.storeId,
        operation: "products.delete",
        success: true,
        data: {
          deletedProductId: input.payload.id,
        },
      };
    }

    case "variants.update": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Variant ID is required", "SHOPIFY_USER_ERROR");
      }

      const rawVariant = (input.payload.variant && typeof input.payload.variant === "object"
        ? input.payload.variant
        : {}) as Record<string, unknown>;

      if ("title" in rawVariant && rawVariant.title !== undefined) {
        throw new ShopifyApiError(
          "Updating variant title directly is not supported; variant titles are derived from optionValues",
          "SHOPIFY_INVALID_INPUT",
        );
      }

      if ("inventoryQuantity" in rawVariant && rawVariant.inventoryQuantity !== undefined) {
        throw new ShopifyApiError(
          "Updating inventoryQuantity via variants.update is not supported; use the Shopify Inventory API",
          "SHOPIFY_INVALID_INPUT",
        );
      }

      let existingVariant: ShopifyProductVariant | undefined;
      for (const prod of shopifyMockProducts) {
        const found = prod.variants.find((v) => v.id === input.payload.id);
        if (found) {
          existingVariant = found;
          break;
        }
      }

      const updatedVariant: ShopifyProductVariant = {
        id: input.payload.id,
        productId: existingVariant?.productId ?? "gid://shopify/Product/1001",
        title: existingVariant?.title ?? "Updated Variant Title",
        price: input.payload.variant.price ?? existingVariant?.price ?? "29.99",
        sku: input.payload.variant.sku ?? existingVariant?.sku,
        barcode: input.payload.variant.barcode ?? existingVariant?.barcode,
        inventoryQuantity: existingVariant?.inventoryQuantity,
      };

      return {
        storeId: input.storeId,
        operation: "variants.update",
        success: true,
        data: { variant: updatedVariant },
      };
    }

    case "variants.bulkUpdate": {
      if (!input.payload.variants || !Array.isArray(input.payload.variants)) {
        throw new ShopifyApiError("Variants array is required", "SHOPIFY_USER_ERROR");
      }

      for (const item of input.payload.variants) {
        const rawVariant = (item?.variant && typeof item.variant === "object"
          ? item.variant
          : {}) as Record<string, unknown>;

        if ("title" in rawVariant && rawVariant.title !== undefined) {
          throw new ShopifyApiError(
            "Updating variant title directly is not supported; variant titles are derived from optionValues",
            "SHOPIFY_INVALID_INPUT",
          );
        }

        if ("inventoryQuantity" in rawVariant && rawVariant.inventoryQuantity !== undefined) {
          throw new ShopifyApiError(
            "Updating inventoryQuantity via variants.update is not supported; use the Shopify Inventory API",
            "SHOPIFY_INVALID_INPUT",
          );
        }
      }
      return {
        storeId: input.storeId,
        operation: "variants.bulkUpdate",
        success: true,
        data: {
          updatedVariantIds: input.payload.variants.map((item) => item.id),
          count: input.payload.variants.length,
        },
      };
    }

    case "collections.list": {
      let filtered = shopifyMockCollections.map(cloneCollection);

      if (input.payload.query) {
        const queryLower = input.payload.query.toLowerCase();
        filtered = filtered.filter((collection) =>
          collection.title.toLowerCase().includes(queryLower) ||
          collection.handle.toLowerCase().includes(queryLower),
        );
      }

      const { pageItems, pageInfo } = paginateItems(filtered, input.payload.limit, input.payload.cursor);

      return {
        storeId: input.storeId,
        operation: "collections.list",
        success: true,
        data: {
          collections: pageItems,
          pageInfo,
        },
      };
    }

    case "collections.get": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Collection ID is required", "SHOPIFY_USER_ERROR");
      }
      const found = shopifyMockCollections.find((c) => c.id === input.payload.id);
      return {
        storeId: input.storeId,
        operation: "collections.get",
        success: true,
        data: {
          collection: found ? cloneCollection(found) : null,
        },
      };
    }

    case "collections.create": {
      if (!input.payload.collection?.title || input.payload.collection.title.trim() === "") {
        throw new ShopifyApiError("Collection title is required", "SHOPIFY_USER_ERROR");
      }
      const newCollection: ShopifyCollection = {
        id: `gid://shopify/Collection/mock-created-${shopifyMockCollections.length + 1}`,
        title: input.payload.collection.title,
        handle: input.payload.collection.handle ?? input.payload.collection.title.toLowerCase().replace(/\s+/g, "-"),
        description: input.payload.collection.description,
        seo: input.payload.collection.seo ? { ...input.payload.collection.seo } : undefined,
        productsCount: 0,
        updatedAt: new Date().toISOString(),
      };

      return {
        storeId: input.storeId,
        operation: "collections.create",
        success: true,
        data: { collection: newCollection },
      };
    }

    case "collections.update": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Collection ID is required", "SHOPIFY_USER_ERROR");
      }
      const existing = shopifyMockCollections.find((c) => c.id === input.payload.id);
      const updatedCollection: ShopifyCollection = {
        id: input.payload.id,
        title: input.payload.collection.title ?? existing?.title ?? "Updated Collection",
        handle: input.payload.collection.handle ?? existing?.handle ?? "updated-collection",
        description: input.payload.collection.description ?? existing?.description,
        seo: input.payload.collection.seo ? { ...input.payload.collection.seo } : existing?.seo,
        productsCount: existing?.productsCount ?? 0,
        updatedAt: new Date().toISOString(),
      };

      return {
        storeId: input.storeId,
        operation: "collections.update",
        success: true,
        data: { collection: updatedCollection },
      };
    }

    case "collections.delete": {
      if (!input.payload.id || input.payload.id.trim() === "") {
        throw new ShopifyApiError("Collection ID is required", "SHOPIFY_USER_ERROR");
      }
      return {
        storeId: input.storeId,
        operation: "collections.delete",
        success: true,
        data: {
          deletedCollectionId: input.payload.id,
        },
      };
    }

    case "collections.updateMembership": {
      if (!input.payload.collectionId || input.payload.collectionId.trim() === "") {
        throw new ShopifyApiError("Collection ID is required", "SHOPIFY_USER_ERROR");
      }
      return {
        storeId: input.storeId,
        operation: "collections.updateMembership",
        success: true,
        data: {
          collectionId: input.payload.collectionId,
          addedCount: input.payload.productIdsToAdd?.length ?? 0,
          removedCount: input.payload.productIdsToRemove?.length ?? 0,
        },
      };
    }

    case "stores.list": {
      const stores = [...mockStores];
      return {
        storeId: input.storeId ?? "system",
        operation: "stores.list",
        success: true,
        data: {
          stores,
          total: stores.length,
        },
      };
    }

    case "stores.get": {
      const targetId = input.payload.targetStoreId.trim();
      const found = mockStores.find((s) => s.storeId === targetId);
      return {
        storeId: input.storeId ?? targetId,
        operation: "stores.get",
        success: true,
        data: {
          store: found ? { ...found } : null,
        },
      };
    }

    default: {
      const exhaustiveCheck: never = input;
      throw new ShopifyApiError(
        `Unsupported Shopify operation: ${(exhaustiveCheck as ShopifyApiInput).operation}`,
        "SHOPIFY_USER_ERROR",
      );
    }
  }
}
