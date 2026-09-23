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
  ShopifyImage,
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
  ShopifyFilesCreateInput,
  ShopifyFilesCreateResponse,
  ShopifyFilesBulkCreateInput,
  ShopifyFilesBulkCreateResponse,
  ShopifyMetafieldsSetInput,
  ShopifyMetafieldsSetResponse,
  ShopifyVariantsBulkCreateInput,
  ShopifyVariantsBulkCreateResponse,
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
    hasMoreVariants: product.hasMoreVariants ?? false,
    hasMoreImages: product.hasMoreImages ?? false,
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
export async function runMockModuleApi(input: ShopifyVariantsBulkCreateInput): Promise<ShopifyVariantsBulkCreateResponse>;
export async function runMockModuleApi(input: ShopifyFilesCreateInput): Promise<ShopifyFilesCreateResponse>;
export async function runMockModuleApi(input: ShopifyFilesBulkCreateInput): Promise<ShopifyFilesBulkCreateResponse>;
export async function runMockModuleApi(input: ShopifyMetafieldsSetInput): Promise<ShopifyMetafieldsSetResponse>;
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

  if (effectiveStoreId === "simulate-user-error") {
    throw new ShopifyApiError("Simulated Shopify user error", "SHOPIFY_USER_ERROR");
  }

  if (effectiveStoreId === "simulate-auth-failure") {
    throw new ShopifyApiError("Simulated Shopify authentication failure", "SHOPIFY_AUTH_FAILED");
  }

  if (effectiveStoreId === "simulate-throttled") {
    throw new ShopifyApiError("Simulated Shopify rate limit throttling", "SHOPIFY_THROTTLED");
  }

  if (effectiveStoreId === "simulate-network-error") {
    throw new ShopifyApiError("Simulated network connection error", "SHOPIFY_NETWORK_ERROR");
  }

  if (effectiveStoreId === "simulate-unknown-state") {
    throw new ShopifyApiError("Simulated unknown write state", "SHOPIFY_UNKNOWN_WRITE_STATE");
  }

  if (effectiveStoreId === "simulate-partial-write") {
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        `https://quickstart-demo.myshopify.com/products/${input.payload.product.handle ?? input.payload.product.title.toLowerCase().replace(/\s+/g, "-")}`;
      const mediaItems: ShopifyImage[] = [];
      if (Array.isArray(input.payload.product.images)) {
        for (let idx = 0; idx < input.payload.product.images.length; idx++) {
          const img = input.payload.product.images[idx];
          mediaItems.push({
            id: img.id,
            url: img.url ?? `https://quickstart-demo.myshopify.com/cdn/shop/files/image-${idx + 1}.jpg`,
            altText: img.altText,
            width: img.width,
            height: img.height,
          });
        }
      }
      if (Array.isArray(input.payload.product.media)) {
        for (let idx = 0; idx < input.payload.product.media.length; idx++) {
          const m = input.payload.product.media[idx];
          if (m && typeof m === "object") {
            const mObj = m as Record<string, unknown>;
            const url =
              typeof mObj.originalSource === "string"
                ? mObj.originalSource
                : typeof mObj.url === "string"
                ? mObj.url
                : `https://quickstart-demo.myshopify.com/cdn/shop/files/media-${idx + 1}.jpg`;
            const altText =
              typeof mObj.alt === "string"
                ? mObj.alt
                : typeof mObj.altText === "string"
                ? mObj.altText
                : undefined;
            const id = typeof mObj.id === "string" ? mObj.id : undefined;
            mediaItems.push({ id, url, altText });
          }
        }
      }

      const featuredImage: ShopifyImage | undefined = input.payload.product.featuredImage
        ? {
            id: input.payload.product.featuredImage.id,
            url: input.payload.product.featuredImage.url ?? "https://quickstart-demo.myshopify.com/cdn/shop/files/placeholder.jpg",
            altText: input.payload.product.featuredImage.altText,
            width: input.payload.product.featuredImage.width,
            height: input.payload.product.featuredImage.height,
          }
        : mediaItems[0]
        ? { ...mediaItems[0] }
        : undefined;

      const images: readonly ShopifyImage[] | undefined =
        mediaItems.length > 0 ? mediaItems : featuredImage ? [featuredImage] : undefined;

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
        hasMoreVariants: false,
        hasMoreImages: false,
        createdAt: now,
        updatedAt: now,
      };

      return {
        storeId: effectiveStoreId,
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
      const onlineStoreUrl = existing?.onlineStoreUrl;
      const featuredImage: ShopifyImage | undefined = input.payload.product.featuredImage
        ? {
            id: input.payload.product.featuredImage.id ?? existing?.featuredImage?.id,
            url:
              input.payload.product.featuredImage.url ??
              existing?.featuredImage?.url ??
              "https://quickstart-demo.myshopify.com/cdn/shop/files/placeholder.jpg",
            altText:
              input.payload.product.featuredImage.altText !== undefined
                ? input.payload.product.featuredImage.altText
                : existing?.featuredImage?.altText,
            width: input.payload.product.featuredImage.width ?? existing?.featuredImage?.width,
            height: input.payload.product.featuredImage.height ?? existing?.featuredImage?.height,
          }
        : existing?.featuredImage
        ? { ...existing.featuredImage }
        : undefined;

      let images: ShopifyImage[] | undefined = existing?.images ? existing.images.map((img) => ({ ...img })) : undefined;
      if (input.payload.product.images) {
        if (!images) {
          images = input.payload.product.images.map((img, idx) => ({
            id: img.id,
            url: img.url ?? `https://quickstart-demo.myshopify.com/cdn/shop/files/image-${idx + 1}.jpg`,
            altText: img.altText,
            width: img.width,
            height: img.height,
          }));
        } else {
          for (let i = 0; i < input.payload.product.images.length; i++) {
            const incoming = input.payload.product.images[i];
            if (incoming.id) {
              const matchIdx = images.findIndex((im) => im.id === incoming.id);
              if (matchIdx >= 0) {
                const existingImg = images[matchIdx];
                images[matchIdx] = {
                  ...existingImg,
                  altText: incoming.altText !== undefined ? incoming.altText : existingImg.altText,
                  url: incoming.url ?? existingImg.url,
                };
              } else {
                images.push({
                  id: incoming.id,
                  url: incoming.url ?? `https://quickstart-demo.myshopify.com/cdn/shop/files/image-${images.length + 1}.jpg`,
                  altText: incoming.altText,
                  width: incoming.width,
                  height: incoming.height,
                });
              }
            } else {
              images.push({
                id: incoming.id,
                url: incoming.url ?? `https://quickstart-demo.myshopify.com/cdn/shop/files/image-${images.length + 1}.jpg`,
                altText: incoming.altText,
                width: incoming.width,
                height: incoming.height,
              });
            }
          }
        }
      }

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
        hasMoreVariants: false,
        hasMoreImages: false,
        createdAt: existing?.createdAt ?? new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return {
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
        operation: "variants.bulkUpdate",
        success: true,
        data: {
          updatedVariantIds: input.payload.variants.map((item) => item.id),
          count: input.payload.variants.length,
        },
      };
    }

    case "variants.bulkCreate": {
      if (!input.payload.productId || input.payload.productId.trim() === "") {
        throw new ShopifyApiError("Product id is required", "SHOPIFY_USER_ERROR");
      }
      if (!input.payload.variants || !Array.isArray(input.payload.variants)) {
        throw new ShopifyApiError("Variants array is required", "SHOPIFY_USER_ERROR");
      }
      for (const item of input.payload.variants) {
        if (!item || typeof item !== "object") {
          throw new ShopifyApiError("Each variant item must be an object", "SHOPIFY_USER_ERROR");
        }
      }
      if (input.payload.variants.length === 0) {
        return {
          storeId: effectiveStoreId,
          operation: "variants.bulkCreate",
          success: true,
          data: {
            createdCount: 0,
            variants: [],
          },
        };
      }
      const createdVariants: ShopifyProductVariant[] = input.payload.variants.map((v, idx) => {
        const title =
          typeof v.title === "string" && v.title.trim() !== ""
            ? v.title.trim()
            : Array.isArray(v.optionValues)
            ? (v.optionValues as readonly Record<string, unknown>[])
                .map((ov) => (typeof ov.name === "string" ? ov.name : typeof ov.value === "string" ? ov.value : ""))
                .filter(Boolean)
                .join(" / ") || "Default Title"
            : "Default Title";

        return {
          id: `gid://shopify/ProductVariant/mock-${Date.now()}-${idx + 1}`,
          productId: input.payload.productId,
          title,
          price: v.price ?? "19.99",
          compareAtPrice: v.compareAtPrice,
          sku: v.sku,
          barcode: v.barcode,
          inventoryQuantity: v.inventoryQuantity,
        };
      });

      return {
        storeId: effectiveStoreId,
        operation: "variants.bulkCreate",
        success: true,
        data: {
          createdCount: createdVariants.length,
          variants: createdVariants,
        },
      };
    }

    case "files.create": {
      if (!input.payload.originalSource || input.payload.originalSource.trim() === "") {
        throw new ShopifyApiError("originalSource is required", "SHOPIFY_USER_ERROR");
      }
      const filename = input.payload.filename || "mock-asset.jpg";
      return {
        storeId: effectiveStoreId,
        operation: "files.create",
        success: true,
        data: {
          fileId: `gid://shopify/MediaImage/mock-${Date.now()}`,
          shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${filename}`,
          fileStatus: "READY",
          alt: input.payload.alt,
        },
      };
    }

    case "files.bulkCreate": {
      if (!Array.isArray(input.payload.files) || input.payload.files.length === 0) {
        throw new ShopifyApiError("files array is required and must not be empty", "SHOPIFY_USER_ERROR");
      }
      const mockFiles = input.payload.files.map((f, idx) => {
        const filename = f.filename || `mock-asset-${idx + 1}.jpg`;
        return {
          originalSource: f.originalSource,
          fileId: `gid://shopify/MediaImage/mock-${Date.now()}-${idx + 1}`,
          shopifyCdnUrl: `https://cdn.shopify.com/s/files/1/0000/0000/files/${filename}`,
          fileStatus: "READY",
          alt: f.alt,
        };
      });
      return {
        storeId: effectiveStoreId,
        operation: "files.bulkCreate",
        success: true,
        data: {
          files: mockFiles,
          totalCount: mockFiles.length,
          successCount: mockFiles.length,
          failedCount: 0,
        },
      };
    }

    case "files.stageBinary": {
      return {
        storeId: input.storeId,
        operation: "files.stageBinary",
        success: true,
        data: {
          resourceUrl: `https://cdn.shopify.com/staged/${encodeURIComponent(input.payload.filename)}`,
        },
      };
    }

    case "metafields.set": {
      let rawItems: readonly Record<string, unknown>[];
      if (Array.isArray(input.payload.metafields)) {
        rawItems = input.payload.metafields as readonly Record<string, unknown>[];
      } else if (
        input.payload.namespace !== undefined ||
        input.payload.key !== undefined ||
        input.payload.value !== undefined
      ) {
        rawItems = [input.payload as Record<string, unknown>];
      } else {
        throw new ShopifyApiError("metafields array or metafield object is required", "SHOPIFY_USER_ERROR");
      }

      if (rawItems.length === 0) {
        throw new ShopifyApiError("metafields array cannot be empty", "SHOPIFY_USER_ERROR");
      }

      const fallbackOwnerId =
        typeof input.payload.ownerId === "string" && input.payload.ownerId.trim() !== ""
          ? input.payload.ownerId.trim()
          : typeof input.payload.productId === "string" && input.payload.productId.trim() !== ""
          ? input.payload.productId.trim()
          : "";

      const summaries = rawItems.map((item, idx) => {
        if (!item || typeof item !== "object") {
          throw new ShopifyApiError(`Metafield at index ${idx} must be an object`, "SHOPIFY_USER_ERROR");
        }
        const ownerId =
          typeof item.ownerId === "string" && item.ownerId.trim() !== ""
            ? item.ownerId.trim()
            : typeof item.productId === "string" && item.productId.trim() !== ""
            ? item.productId.trim()
            : fallbackOwnerId;
        if (!ownerId) {
          throw new ShopifyApiError(`ownerId (or productId) is required at index ${idx}`, "SHOPIFY_USER_ERROR");
        }
        const namespace = typeof item.namespace === "string" ? item.namespace.trim() : "";
        if (!namespace) {
          throw new ShopifyApiError(`namespace is required at index ${idx}`, "SHOPIFY_USER_ERROR");
        }
        const key = typeof item.key === "string" ? item.key.trim() : "";
        if (!key) {
          throw new ShopifyApiError(`key is required at index ${idx}`, "SHOPIFY_USER_ERROR");
        }
        let valStr: string;
        if (typeof item.value === "string") {
          valStr = item.value;
        } else if (typeof item.value === "object" && item.value !== null) {
          valStr = JSON.stringify(item.value);
        } else if (item.value !== undefined && item.value !== null) {
          valStr = String(item.value);
        } else {
          throw new ShopifyApiError(`value is required at index ${idx}`, "SHOPIFY_USER_ERROR");
        }
        const type = typeof item.type === "string" && item.type.trim() !== "" ? item.type.trim() : "json";

        return {
          id: `gid://shopify/Metafield/mock-${Date.now()}-${idx + 1}`,
          namespace,
          key,
          type,
          value: valStr,
          ownerType: "PRODUCT",
        };
      });

      return {
        storeId: effectiveStoreId,
        operation: "metafields.set",
        success: true,
        data: {
          success: true,
          metafieldId: summaries[0]?.id,
          metafields: summaries,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
        storeId: effectiveStoreId,
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
