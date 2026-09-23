import type {
  CreateProductInput,
  CreateProductOutput,
  CreateVariantItem,
  CreateVariantsOutput,
  SetMetafieldInput,
  SetMetafieldOutput,
  ShopifyGateway,
  ShopifySyncBatchInput,
  ShopifySyncBatchOutput,
  ShopifySyncOptions,
  ShopifySyncProductInput,
  ShopifySyncProductResult,
  UploadFileInput,
  UploadFileOutput,
  UpdateProductInput,
  UpdateProductOutput,
} from "./types";

export function createDryRunGateway(): ShopifyGateway {
  return {
    async createProduct(input: CreateProductInput): Promise<CreateProductOutput> {
      const slug = input.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
      return {
        productId: "gid://shopify/Product/dry-run-preview-id",
        productHandle: slug || "dry-run-preview-handle",
      };
    },

    async updateProduct(input: UpdateProductInput): Promise<UpdateProductOutput> {
      return {
        productId: input.productId,
        productHandle: "dry-run-preview-handle",
        createdVariantsCount: input.variants?.length ?? 0,
      };
    },

    async createVariants(
      _productId: string,
      variants: readonly CreateVariantItem[],
    ): Promise<CreateVariantsOutput> {
      return {
        createdCount: variants.length,
      };
    },

    async uploadFile(input: UploadFileInput): Promise<UploadFileOutput> {
      return {
        fileId: "gid://shopify/File/dry-run-id",
        shopifyCdnUrl: `https://cdn.shopify.com/s/files/dry-run/${input.filename}`,
      };
    },

    async setProductMetafield(_input: SetMetafieldInput): Promise<SetMetafieldOutput> {
      return {
        success: true,
        metafieldId: "gid://shopify/Metafield/dry-run-id",
      };
    },
  };
}

export function replaceUrlsInObject(
  target: unknown,
  replacements: ReadonlyMap<string, string>,
): unknown {
  if (typeof target === "string") {
    return replacements.get(target) || target;
  }
  if (Array.isArray(target)) {
    return target.map((item) => replaceUrlsInObject(item, replacements));
  }
  if (target && typeof target === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(target)) {
      output[key] = replaceUrlsInObject(value, replacements);
    }
    return output;
  }
  return target;
}

export async function syncSingleProduct(
  product: ShopifySyncProductInput,
  options: ShopifySyncOptions = {},
): Promise<ShopifySyncProductResult> {
  const syncStartedAt = Date.now();
  let productWriteMs = 0;
  let variantsMs = 0;
  let assetUploadMs = 0;
  let metafieldMs = 0;
  const getTimings = () => ({
    productWriteMs,
    variantsMs,
    assetUploadMs,
    metafieldMs,
    totalMs: Date.now() - syncStartedAt,
  });
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];

  let gateway: ShopifyGateway;
  let writtenProduct: CreateProductOutput | undefined;

  if (options.gateway) {
    gateway = options.gateway;
  } else if (dryRun) {
    gateway = createDryRunGateway();
  } else {
    return {
      success: false,
      sourceId: product.id,
      title: product.title,
      variantsCount: 0,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount: 0,
      metafieldSet: false,
      dryRun: false,
      warnings,
      error:
        "ShopifyGateway is required. Please provide a ShopifyGateway implementation via options.gateway.",
      timings: getTimings(),
    };
  }

  try {
    // 1. Create Product & Media Gallery & Options/Variants
    const productWriteInput = {
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      handle: product.handle,
      seo: product.seo,
      vendor: product.vendor,
      productType: product.productType,
      tags: [
        ...(product.tags ?? []),
        ...(product.sourceKey ? [`ffp-source:${product.sourceKey}`] : []),
      ],
      media: product.media,
      variants: product.variants,
    };
    const productWriteStartedAt = Date.now();
    try {
      if (options.existingProductId) {
        if (!gateway.updateProduct) {
          throw new Error("ShopifyGateway does not support updating an existing product.");
        }
        writtenProduct = await gateway.updateProduct({
          productId: options.existingProductId,
          previousManagedResources: options.existingManagedResources,
          ...productWriteInput,
        });
      } else {
        writtenProduct = await gateway.createProduct({
          ...productWriteInput,
          status: "ACTIVE",
        });
      }
    } finally {
      productWriteMs = Date.now() - productWriteStartedAt;
    }

    // 2. Create Variants (if not already bulk-created by createProduct)
    const variantsStartedAt = Date.now();
    let variantsCount = writtenProduct.createdVariantsCount ?? 0;
    if (!options.existingProductId && variantsCount === 0 && product.variants && product.variants.length > 0) {
      const variantResult = await gateway.createVariants(
        writtenProduct.productId,
        product.variants,
      );
      variantsCount = variantResult.createdCount;
    }
    const expectedVariantsCount = product.variants?.length ?? 0;
    if (expectedVariantsCount > 0 && variantsCount !== expectedVariantsCount) {
      throw new Error(
        `Shopify variants incomplete: synchronized ${variantsCount}/${expectedVariantsCount}.`,
      );
    }
    variantsMs = Date.now() - variantsStartedAt;

    // 3. Process Customization if present
    let assetsUploadedCount = 0;
    let metafieldSet = false;

    if (product.customization && product.customization.hasCustomization) {
      const assetUploadStartedAt = Date.now();
      const rawAssets = product.customization.assets || [];
      const replacements = new Map<string, string>();

      // Deduplicate assets by valid URL to avoid uploading duplicates
      const uniqueUrlMap = new Map<string, (typeof rawAssets)[0]>();
      for (const asset of rawAssets) {
        if (asset.url && typeof asset.url === "string" && asset.url.trim() !== "") {
          const trimmedUrl = asset.url.trim();
          if (!uniqueUrlMap.has(trimmedUrl)) {
            uniqueUrlMap.set(trimmedUrl, asset);
          }
        }
      }
      const uniqueAssets = Array.from(uniqueUrlMap.values());

      const targetProductId = writtenProduct?.productId ?? "";
      const buildAssetAlt = (customAlt?: string) => {
        const prefix = customAlt && customAlt.trim() !== "" ? customAlt.trim() : "Customization Asset";
        return targetProductId ? `${prefix} | product:${targetProductId}` : prefix;
      };

      if (gateway.uploadFilesBatch && uniqueAssets.length > 0) {
        const BATCH_SIZE = 100;
        for (let i = 0; i < uniqueAssets.length; i += BATCH_SIZE) {
          const chunk = uniqueAssets.slice(i, i + BATCH_SIZE);
          try {
            const batchOutputs = await gateway.uploadFilesBatch(
              chunk.map((a) => ({
                originalSource: a.url,
                filename: a.friendlyFileName || "amzcustom-asset.png",
                alt: buildAssetAlt(a.alt),
              })),
            );

            batchOutputs.forEach((item, idx) => {
              const orig = item.originalSource || chunk[idx]?.url;
              if (item.shopifyCdnUrl && orig) {
                replacements.set(orig, item.shopifyCdnUrl);
              }
            });

            const missingAssets = chunk.filter((asset) => !replacements.has(asset.url));
            for (const asset of missingAssets) {
              try {
                const uploaded = await gateway.uploadFile({
                  originalSource: asset.url,
                  filename: asset.friendlyFileName || "amzcustom-asset.png",
                  alt: buildAssetAlt(asset.alt),
                });
                replacements.set(asset.url, uploaded.shopifyCdnUrl);
              } catch (singleErr: unknown) {
                const singleDetail =
                  singleErr instanceof Error ? singleErr.message : String(singleErr);
                warnings.push(
                  `Failed to retry customization asset ${asset.url}: ${singleDetail}`,
                );
              }
            }
          } catch (batchErr: unknown) {
            const errDetail =
              batchErr instanceof Error ? batchErr.message : String(batchErr);
            warnings.push(
              `Batch upload chunk failed (${errDetail}); falling back to single file uploads`,
            );
            for (const asset of chunk) {
              try {
                const uploaded = await gateway.uploadFile({
                  originalSource: asset.url,
                  filename: asset.friendlyFileName || "amzcustom-asset.png",
                  alt: buildAssetAlt(asset.alt),
                });
                replacements.set(asset.url, uploaded.shopifyCdnUrl);
              } catch (singleErr: unknown) {
                const singleDetail =
                  singleErr instanceof Error ? singleErr.message : String(singleErr);
                warnings.push(
                  `Failed to upload customization asset ${asset.url}: ${singleDetail}`,
                );
              }
            }
          }
        }
      } else {
        // Fallback to sequential uploads when uploadFilesBatch is not available
        for (const asset of uniqueAssets) {
          try {
            const uploaded = await gateway.uploadFile({
              originalSource: asset.url,
              filename: asset.friendlyFileName || "amzcustom-asset.png",
              alt: buildAssetAlt(asset.alt),
            });
            replacements.set(asset.url, uploaded.shopifyCdnUrl);
          } catch (uploadError: unknown) {
            const errDetail =
              uploadError instanceof Error ? uploadError.message : String(uploadError);
            warnings.push(
              `Failed to upload customization asset ${asset.url}: ${errDetail}`,
            );
          }
        }
      }

      assetsUploadedCount = replacements.size;
      assetUploadMs = Date.now() - assetUploadStartedAt;

      if (assetsUploadedCount !== uniqueAssets.length) {
        throw new Error(
          `Customization assets incomplete: uploaded ${assetsUploadedCount}/${uniqueAssets.length}.`,
        );
      }

      // Reconstruct customizer config replacing old Amazon URLs with Shopify CDN URLs
      const baseConfig: Record<string, unknown> = {
        ...product.customization,
        hasCustomization: true,
        shopifyProductId: targetProductId,
        productId: targetProductId,
        assets: product.customization.assets,
        optionGroups: product.customization.optionGroups,
        pricing: product.customization.pricing,
        textInputs: product.customization.textInputs,
        surfaces: product.customization.surfaces,
        placements: product.customization.placements,
        product: product.customization.product,
        controlOrder: product.customization.controlOrder,
        formUrl: product.customization.formUrl,
        ...product.customization.rawConfig,
      };

      let finalConfig = replaceUrlsInObject(baseConfig, replacements) as Record<
        string,
        unknown
      >;

      let serializedValue = JSON.stringify(finalConfig);

      // Shopify Metafield JSON size limit is 131,072 bytes (128 KB).
      // If the serialized config exceeds 120,000 bytes, prune redundant duplicate `assets`
      // array because surfaces and optionGroups already contain direct Shopify CDN URLs.
      if (serializedValue.length > 120000 && finalConfig.assets) {
        const { assets: _discardedAssets, ...compactConfig } = finalConfig;
        finalConfig = compactConfig;
        serializedValue = JSON.stringify(finalConfig);
      }

      // 4. Set Metafield custom.amazon_customizer
      const customizationMetafieldStartedAt = Date.now();
      try {
        const metaResult = await gateway.setProductMetafield({
          productId: writtenProduct.productId,
          namespace: "custom",
          key: "amazon_customizer",
          type: "json",
          value: serializedValue,
        });
        metafieldSet = metaResult.success;
      } catch (metaError: unknown) {
        const errDetail =
          metaError instanceof Error ? metaError.message : String(metaError);
        warnings.push(`Failed to set custom.amazon_customizer metafield: ${errDetail}`);
      }
      if (!metafieldSet) {
        throw new Error("Failed to set required custom.amazon_customizer metafield.");
      }
      metafieldMs += Date.now() - customizationMetafieldStartedAt;
    }

    if (product.sourceKey) {
      const sourceMetafieldStartedAt = Date.now();
      const sourceMetafield = await gateway.setProductMetafield({
        productId: writtenProduct.productId,
        namespace: "custom",
        key: "ffp_source_key",
        type: "json",
        value: JSON.stringify({ sourceKey: product.sourceKey }),
      });
      if (!sourceMetafield.success) {
        throw new Error("Failed to set required custom.ffp_source_key metafield.");
      }
      metafieldMs += Date.now() - sourceMetafieldStartedAt;
    }

    return {
      success: true,
      sourceId: product.id,
      productId: writtenProduct.productId,
      productHandle: writtenProduct.productHandle,
      title: product.title,
      variantsCount,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount,
      metafieldSet,
      dryRun,
      warnings,
      managedResources: writtenProduct.managedResources,
      timings: getTimings(),
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sourceId: product.id,
      productId: writtenProduct?.productId,
      productHandle: writtenProduct?.productHandle,
      title: product.title,
      variantsCount: 0,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount: 0,
      metafieldSet: false,
      dryRun,
      warnings,
      error: msg,
      reconciliationRequired: writtenProduct !== undefined,
      timings: getTimings(),
    };
  }
}

export async function runShopifySync(
  input: ShopifySyncBatchInput | readonly ShopifySyncProductInput[],
  options: ShopifySyncOptions = {},
): Promise<ShopifySyncBatchOutput> {
  const products = Array.isArray(input)
    ? input
    : (input as ShopifySyncBatchInput).products;
  const jobId = Array.isArray(input)
    ? undefined
    : (input as ShopifySyncBatchInput).jobId;

  const results: ShopifySyncProductResult[] = [];
  let successfulProducts = 0;
  let failedProducts = 0;
  let totalAssetsUploaded = 0;

  for (const product of products) {
    const res = await syncSingleProduct(product, options);
    results.push(res);
    if (res.success) {
      successfulProducts += 1;
      totalAssetsUploaded += res.assetsUploadedCount;
    } else {
      failedProducts += 1;
    }
  }

  return {
    jobId,
    totalProducts: products.length,
    successfulProducts,
    failedProducts,
    totalAssetsUploaded,
    results,
  };
}
