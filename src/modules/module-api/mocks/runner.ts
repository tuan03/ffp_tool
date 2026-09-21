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

function cloneVariant(variant: ShopifyProductVariant): ShopifyProductVariant {
  return { ...variant };
}

function cloneProduct(product: ShopifyProduct): ShopifyProduct {
  return {
    ...product,
    tags: [...product.tags],
    variants: product.variants.map(cloneVariant),
  };
}

function cloneCollection(collection: ShopifyCollection): ShopifyCollection {
  return { ...collection };
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
export async function runMockModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse>;
export async function runMockModuleApi(input: ShopifyApiInput): Promise<ShopifyApiResponse> {
  if (!input.storeId || input.storeId.trim() === "") {
    throw new ShopifyApiError("Store ID is required", "SHOPIFY_USER_ERROR");
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
      let filtered = shopifyMockProducts.map(cloneProduct);

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

      const limit = input.payload.limit ?? 50;
      const products = filtered.slice(0, limit);

      return {
        storeId: input.storeId,
        operation: "products.list",
        success: true,
        data: {
          products,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: products.length > 0 ? "mock-start-cursor" : undefined,
            endCursor: products.length > 0 ? "mock-end-cursor" : undefined,
          },
        },
      };
    }

    case "products.get": {
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
      const now = new Date().toISOString();
      const newProduct: ShopifyProduct = {
        id: `gid://shopify/Product/mock-created-${shopifyMockProducts.length + 1}`,
        title: input.payload.product.title,
        handle: input.payload.product.handle ?? input.payload.product.title.toLowerCase().replace(/\s+/g, "-"),
        descriptionHtml: input.payload.product.descriptionHtml,
        status: input.payload.product.status ?? "DRAFT",
        vendor: input.payload.product.vendor,
        productType: input.payload.product.productType,
        tags: input.payload.product.tags ? [...input.payload.product.tags] : [],
        variants: [
          {
            id: `gid://shopify/ProductVariant/mock-var-${shopifyMockProducts.length + 1}`,
            productId: `gid://shopify/Product/mock-created-${shopifyMockProducts.length + 1}`,
            title: "Default Title",
            price: "19.99",
          },
        ],
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
      const existing = shopifyMockProducts.find((p) => p.id === input.payload.id);
      const updatedProduct: ShopifyProduct = {
        id: input.payload.id,
        title: input.payload.product.title ?? existing?.title ?? "Updated Product",
        handle: input.payload.product.handle ?? existing?.handle ?? "updated-product",
        descriptionHtml: input.payload.product.descriptionHtml ?? existing?.descriptionHtml,
        status: input.payload.product.status ?? existing?.status ?? "ACTIVE",
        vendor: input.payload.product.vendor ?? existing?.vendor,
        productType: input.payload.product.productType ?? existing?.productType,
        tags: input.payload.product.tags ? [...input.payload.product.tags] : (existing?.tags ? [...existing.tags] : []),
        variants: existing ? existing.variants.map(cloneVariant) : [],
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
      return {
        storeId: input.storeId,
        operation: "products.bulkUpdate",
        success: true,
        data: {
          updatedProductIds: input.payload.products.map((item) => item.id),
          count: input.payload.products.length,
        },
      };
    }

    case "products.delete": {
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
      const updatedVariant: ShopifyProductVariant = {
        id: input.payload.id,
        productId: "gid://shopify/Product/1001",
        title: input.payload.variant.title ?? "Updated Variant Title",
        price: input.payload.variant.price ?? "29.99",
        sku: input.payload.variant.sku,
        barcode: input.payload.variant.barcode,
        inventoryQuantity: input.payload.variant.inventoryQuantity,
      };

      return {
        storeId: input.storeId,
        operation: "variants.update",
        success: true,
        data: { variant: updatedVariant },
      };
    }

    case "variants.bulkUpdate": {
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

      const limit = input.payload.limit ?? 50;
      const collections = filtered.slice(0, limit);

      return {
        storeId: input.storeId,
        operation: "collections.list",
        success: true,
        data: {
          collections,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: collections.length > 0 ? "mock-col-start" : undefined,
            endCursor: collections.length > 0 ? "mock-col-end" : undefined,
          },
        },
      };
    }

    case "collections.get": {
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
      const newCollection: ShopifyCollection = {
        id: `gid://shopify/Collection/mock-created-${shopifyMockCollections.length + 1}`,
        title: input.payload.collection.title,
        handle: input.payload.collection.handle ?? input.payload.collection.title.toLowerCase().replace(/\s+/g, "-"),
        description: input.payload.collection.description,
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
      const existing = shopifyMockCollections.find((c) => c.id === input.payload.id);
      const updatedCollection: ShopifyCollection = {
        id: input.payload.id,
        title: input.payload.collection.title ?? existing?.title ?? "Updated Collection",
        handle: input.payload.collection.handle ?? existing?.handle ?? "updated-collection",
        description: input.payload.collection.description ?? existing?.description,
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

    default: {
      const exhaustiveCheck: never = input;
      throw new ShopifyApiError(
        `Unsupported Shopify operation: ${(exhaustiveCheck as ShopifyApiInput).operation}`,
        "SHOPIFY_USER_ERROR",
      );
    }
  }
}
