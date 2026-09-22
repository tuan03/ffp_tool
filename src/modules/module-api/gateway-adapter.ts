import { runModuleApi } from "./service";
import type {
  ModuleApiRunner,
  ShopifyExecutionMode,
  ShopifyFilesCreateResponse,
  ShopifyFilesBulkCreateResponse,
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
        storeId,
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
            variants: input.variants?.map((v) => ({
              price: v.price,
              compareAtPrice: v.compareAtPrice,
              sku: v.sku,
              barcode: v.barcode,
              inventoryTracked: v.inventoryTracked ?? false,
              optionValues: v.optionValues?.map((ov) => ({
                optionName: ov.optionName,
                name: ov.name,
              })),
            })),
          },
        },
      })) as ShopifyProductsCreateResponse;

      return {
        productId: response.data.product.id,
        productHandle: response.data.product.handle,
        createdVariantsCount: response.data.product.variants?.length,
      };
    },

    async createVariants(
      productId: string,
      variants: readonly CreateVariantItem[],
    ): Promise<CreateVariantsOutput> {
      const requestId = getRequestId("variants-bulk-create");
      const response = (await runner({
        storeId,
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
            inventoryTracked: v.inventoryTracked ?? false,
            optionValues: v.optionValues?.map((ov) => ({
              name: ov.name,
              optionName: ov.optionName,
            })),
          })),
        },
      })) as ShopifyVariantsBulkCreateResponse;

      return {
        createdCount: response.data.createdCount,
      };
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileOutput> {
      const requestId = getRequestId("files-create");
      const response = (await runner({
        storeId,
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

      return {
        fileId: response.data.fileId,
        shopifyCdnUrl: response.data.shopifyCdnUrl,
      };
    },

    async uploadFilesBatch(
      inputs: readonly UploadFileInput[],
    ): Promise<readonly UploadFileOutput[]> {
      if (!inputs || inputs.length === 0) {
        return [];
      }
      const requestId = getRequestId("files-bulk-create");
      const response = (await runner({
        storeId,
        operation: "files.bulkCreate",
        mode,
        requestId,
        payload: {
          files: inputs.map((item) => ({
            originalSource: item.originalSource,
            filename: item.filename,
            alt: item.alt,
            contentType: "IMAGE" as const,
          })),
        },
      })) as ShopifyFilesBulkCreateResponse;

      return response.data.files.map((f) => ({
        fileId: f.fileId || "",
        shopifyCdnUrl: f.shopifyCdnUrl || "",
        originalSource: f.originalSource,
      }));
    },

    async setProductMetafield(input: SetMetafieldInput): Promise<SetMetafieldOutput> {
      const requestId = getRequestId("metafields-set");
      const response = (await runner({
        storeId,
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
        success: response.data.success,
        metafieldId: response.data.metafieldId,
      };
    },
  };
}
