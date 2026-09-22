import { runModuleApi } from "./service";
import type {
  ModuleApiRunner,
  ShopifyExecutionMode,
  ShopifyFilesCreateResponse,
  ShopifyMetafieldsSetResponse,
  ShopifyProductsCreateResponse,
  ShopifyVariantsBulkCreateResponse,
} from "./types";
import type {
  CreateProductInput,
  CreateProductOutput,
  CreateVariantItem,
  CreateVariantsOutput,
  SetMetafieldInput,
  SetMetafieldOutput,
  ShopifyGateway,
  UploadFileInput,
  UploadFileOutput,
} from "../shopify-sync";

export interface ShopifyGatewayAdapterOptions {
  readonly runner?: ModuleApiRunner;
  readonly mode?: ShopifyExecutionMode;
  readonly getRequestId?: (operation: string) => string;
}

/**
 * Creates a ShopifyGateway adapter that connects Rùa's shopify-sync workflow
 * to Hiệp's module-api and Shopify GraphQL Gateway.
 */
export function createShopifyGatewayAdapter(
  storeId: string,
  runner?: ModuleApiRunner,
): ShopifyGateway;
export function createShopifyGatewayAdapter(
  storeId: string,
  options?: ShopifyGatewayAdapterOptions,
): ShopifyGateway;
export function createShopifyGatewayAdapter(
  storeId: string,
  optionsOrRunner?: ShopifyGatewayAdapterOptions | ModuleApiRunner,
): ShopifyGateway {
  const cleanStoreId = typeof storeId === "string" ? storeId.trim() : "";
  if (!cleanStoreId) {
    throw new Error("storeId is required to create ShopifyGateway adapter");
  }

  const options: ShopifyGatewayAdapterOptions =
    typeof optionsOrRunner === "function"
      ? { runner: optionsOrRunner }
      : optionsOrRunner ?? {};
  const runner = options.runner ?? runModuleApi;
  const mode = options.mode ?? "apply";
  const defaultGetRequestId = (op: string) =>
    `sync-${op}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const getRequestId = options.getRequestId ?? defaultGetRequestId;

  return {
    async createProduct(input: CreateProductInput): Promise<CreateProductOutput> {
      const requestId = getRequestId("product-create");
      const response = (await runner({
        storeId: cleanStoreId,
        operation: "products.create",
        mode,
        requestId,
        payload: {
          product: {
            title: input.title,
            descriptionHtml: input.descriptionHtml,
            vendor: input.vendor,
            productType: input.productType,
            tags: input.tags,
            media: input.media?.map((m) => ({
              originalSource: m.originalSource,
              alt: m.alt,
              mediaContentType: m.mediaContentType ?? "IMAGE",
            })),
          },
        },
      })) as ShopifyProductsCreateResponse;

      if (!response?.data?.product?.id) {
        throw new Error("Failed to create product: missing product in response");
      }

      return {
        productId: response.data.product.id,
        productHandle: response.data.product.handle,
      };
    },

    async createVariants(
      productId: string,
      variants: readonly CreateVariantItem[],
    ): Promise<CreateVariantsOutput> {
      if (!variants || variants.length === 0) {
        return { createdCount: 0 };
      }

      const requestId = getRequestId("variants-bulk-create");
      const response = (await runner({
        storeId: cleanStoreId,
        operation: "variants.bulkCreate",
        mode,
        requestId,
        payload: {
          productId,
          variants: variants.map((v) => ({
            price: v.price,
            compareAtPrice: v.compareAtPrice,
            sku: v.sku,
            barcode: v.barcode,
            optionValues: v.optionValues?.map((ov) => ({
              name: ov.name,
              optionName: ov.optionName,
            })),
          })),
        },
      })) as ShopifyVariantsBulkCreateResponse;

      return {
        createdCount: response?.data?.createdCount ?? 0,
      };
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileOutput> {
      const requestId = getRequestId("files-create");
      const response = (await runner({
        storeId: cleanStoreId,
        operation: "files.create",
        mode,
        requestId,
        payload: {
          originalSource: input.originalSource,
          filename: input.filename,
          alt: input.alt,
          contentType: "IMAGE",
        },
      })) as ShopifyFilesCreateResponse;

      if (!response?.data?.shopifyCdnUrl) {
        throw new Error("Failed to upload file: missing shopifyCdnUrl in response");
      }

      return {
        fileId: response.data.fileId,
        shopifyCdnUrl: response.data.shopifyCdnUrl,
      };
    },

    async setProductMetafield(input: SetMetafieldInput): Promise<SetMetafieldOutput> {
      const requestId = getRequestId("metafields-set");
      const response = (await runner({
        storeId: cleanStoreId,
        operation: "metafields.set",
        mode,
        requestId,
        payload: {
          ownerId: input.productId,
          productId: input.productId,
          namespace: input.namespace,
          key: input.key,
          value: input.value,
          type: input.type,
        },
      })) as ShopifyMetafieldsSetResponse;

      return {
        success: response?.data?.success ?? false,
        metafieldId: response?.data?.metafieldId ?? response?.data?.metafields?.[0]?.id,
      };
    },
  };
}
