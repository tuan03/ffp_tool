import { runModuleApi } from "./service";
import type {
  ModuleApiRunner,
  ShopifyExecutionMode,
  ShopifyFilesCreateResponse,
  ShopifyFilesBulkCreateResponse,
  ShopifyMetafieldsSetResponse,
  ShopifyProductsCreateResponse,
  ShopifyProductsGetResponse,
  ShopifyProductsListResponse,
  ShopifyProductsUpdateResponse,
  ShopifyProduct,
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
  UpdateProductInput,
  UpdateProductOutput,
} from "../shopify-sync";

export interface ShopifyGatewayAdapterOptions {
  readonly runner?: ModuleApiRunner;
  readonly mode?: ShopifyExecutionMode;
  readonly getRequestId?: (operation: string) => string;
}

export interface ResolveShopifyProductForSyncInput {
  readonly runner: ModuleApiRunner;
  readonly storeId: string;
  readonly sourceKey: string;
  readonly mappedProductId?: string;
}

export interface ResolvedShopifyProductForSync {
  readonly product?: ShopifyProduct;
  readonly match: "mapping" | "source_tag" | "none";
  readonly staleMappedProductId?: string;
}

function escapeShopifySearch(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function resolveShopifyProductForSync(
  input: ResolveShopifyProductForSyncInput,
): Promise<ResolvedShopifyProductForSync> {
  const storeId = input.storeId.trim();
  const sourceKey = input.sourceKey.trim();
  const mappedProductId = input.mappedProductId?.trim();
  if (!storeId || !sourceKey) {
    throw new Error("storeId and sourceKey are required to reconcile a Shopify product.");
  }

  if (mappedProductId) {
    const mappedResponse = await input.runner({
      storeId,
      operation: "products.get",
      payload: { id: mappedProductId },
    }) as ShopifyProductsGetResponse;
    if (mappedResponse.data.product) {
      return { product: mappedResponse.data.product, match: "mapping" };
    }
  }

  const sourceTag = `ffp-source:${sourceKey}`;
  const listed = await input.runner({
    storeId,
    operation: "products.list",
    payload: {
      limit: 10,
      query: `tag:"${escapeShopifySearch(sourceTag)}"`,
    },
  }) as ShopifyProductsListResponse;
  const candidate = listed.data.products.find((product) => product.tags.includes(sourceTag));
  if (!candidate) {
    return {
      match: "none",
      ...(mappedProductId ? { staleMappedProductId: mappedProductId } : {}),
    };
  }

  const detail = await input.runner({
    storeId,
    operation: "products.get",
    payload: { id: candidate.id },
  }) as ShopifyProductsGetResponse;
  return {
    product: detail.data.product ?? candidate,
    match: "source_tag",
    ...(mappedProductId ? { staleMappedProductId: mappedProductId } : {}),
  };
}

function stableRequestSuffix(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
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
      const requestId = getRequestId(
        `product-create-${stableRequestSuffix(JSON.stringify(input))}`,
      );
      const response = (await runner({
        storeId: cleanStoreId,
        operation: "products.create",
        mode,
        requestId,
        payload: {
          product: {
            title: input.title,
            handle: input.handle,
            seo: input.seo,
            status: input.status,
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

      if (!response?.data?.product?.id) {
        throw new Error("Failed to create product: missing product in response");
      }

      return {
        productId: response.data.product.id,
        productHandle: response.data.product.handle,
        createdVariantsCount: response.data.product.variants?.length,
        managedResources: {
          tags: input.tags,
          mediaIds: response.data.product.images?.flatMap((image) => image.id ? [image.id] : []) ?? [],
          variantIds: response.data.product.variants?.map((variant) => variant.id) ?? [],
        },
      };
    },

    async updateProduct(input: UpdateProductInput): Promise<UpdateProductOutput> {
      const current = (await runner({
        storeId,
        operation: "products.get",
        payload: { id: input.productId },
      })) as ShopifyProductsGetResponse;
      if (!current.data.product) {
        throw new Error(`Shopify product ${input.productId} was not found before update.`);
      }
      const previousManagedTags = new Set(input.previousManagedResources?.tags ?? []);
      const preservedTags = current.data.product.tags.filter((tag) => !previousManagedTags.has(tag));
      const nextTags = [...new Set([...preservedTags, ...(input.tags ?? [])])];
      const previousManagedMediaIds = input.previousManagedResources?.mediaIds ?? [];
      const unmanagedMediaIds = new Set(
        (current.data.product.images ?? []).flatMap((image) =>
          image.id && !previousManagedMediaIds.includes(image.id) ? [image.id] : []
        ),
      );
      const requestId = getRequestId(
        `product-update-${stableRequestSuffix(JSON.stringify({
          ...input,
          tags: nextTags,
        }))}`,
      );
      const response = (await runner({
        storeId,
        operation: "products.update",
        mode,
        requestId,
        payload: {
          id: input.productId,
          product: {
            title: input.title,
            handle: input.handle,
            seo: input.seo,
            descriptionHtml: input.descriptionHtml,
            vendor: input.vendor,
            productType: input.productType,
            tags: nextTags,
            media: input.media?.map((media) => ({
              originalSource: media.originalSource,
              alt: media.alt,
              mediaContentType: media.mediaContentType ?? "IMAGE",
            })),
            mediaIdsToDelete: previousManagedMediaIds,
            variantIdsToManage: input.previousManagedResources?.variantIds,
            variants: input.variants?.map((variant) => ({
              price: variant.price,
              compareAtPrice: variant.compareAtPrice,
              sku: variant.sku,
              barcode: variant.barcode,
              inventoryTracked: variant.inventoryTracked ?? false,
              optionValues: variant.optionValues?.map((option) => ({
                optionName: option.optionName,
                name: option.name,
              })),
            })),
          },
        },
      })) as ShopifyProductsUpdateResponse;
      const refreshed = (await runner({
        storeId,
        operation: "products.get",
        payload: { id: input.productId },
      })) as ShopifyProductsGetResponse;
      const refreshedProduct = refreshed.data.product ?? response.data.product;
      const synchronizedVariants = response.data.product.variants ?? [];
      return {
        productId: refreshedProduct.id,
        productHandle: refreshedProduct.handle,
        createdVariantsCount: synchronizedVariants.length,
        managedResources: {
          tags: input.tags,
          mediaIds: refreshedProduct.images?.flatMap((image) =>
            image.id && !unmanagedMediaIds.has(image.id) ? [image.id] : []
          ) ?? [],
          variantIds: synchronizedVariants.map((variant) => variant.id),
        },
      };
    },

    async createVariants(
      productId: string,
      variants: readonly CreateVariantItem[],
    ): Promise<CreateVariantsOutput> {
      if (!variants || variants.length === 0) {
        return { createdCount: 0 };
      }

      const requestId = getRequestId(
        `variants-bulk-create-${stableRequestSuffix(JSON.stringify({ productId, variants }))}`,
      );
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
            inventoryTracked: v.inventoryTracked ?? false,
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
      const requestId = getRequestId(
        `files-create-${stableRequestSuffix(input.originalSource)}`,
      );
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

    async uploadFilesBatch(
      inputs: readonly UploadFileInput[],
    ): Promise<readonly UploadFileOutput[]> {
      if (!inputs || inputs.length === 0) {
        return [];
      }
      const requestId = getRequestId(
        `files-bulk-create-${stableRequestSuffix(
          inputs.map((input) => input.originalSource).join("\n"),
        )}`,
      );
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
      const requestId = getRequestId(
        `metafields-set-${stableRequestSuffix(JSON.stringify(input))}`,
      );
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
