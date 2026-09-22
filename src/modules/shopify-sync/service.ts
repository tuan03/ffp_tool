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
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];

  let gateway: ShopifyGateway;

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
    };
  }

  try {
    // 1. Create Product & Media Gallery & Options/Variants
    const createdProduct = await gateway.createProduct({
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      vendor: product.vendor,
      productType: product.productType,
      tags: product.tags,
      media: product.media,
      variants: product.variants,
    });

    // 2. Create Variants (if not already bulk-created by createProduct)
    let variantsCount = createdProduct.createdVariantsCount ?? 0;
    if (variantsCount === 0 && product.variants && product.variants.length > 0) {
      try {
        const variantResult = await gateway.createVariants(
          createdProduct.productId,
          product.variants,
        );
        variantsCount = variantResult.createdCount;
      } catch (varErr: unknown) {
        // If variants were already established or failed standalone, report cleanly
        const varErrDetail = varErr instanceof Error ? varErr.message : String(varErr);
        warnings.push(`Variants creation note: ${varErrDetail}`);
      }
    }

    // 3. Process Customization if present
    let assetsUploadedCount = 0;
    let metafieldSet = false;

    if (product.customization && product.customization.hasCustomization) {
      const assets = product.customization.assets || [];
      const replacements = new Map<string, string>();

      for (const asset of assets) {
        if (asset.url) {
          try {
            const uploaded = await gateway.uploadFile({
              originalSource: asset.url,
              filename: asset.friendlyFileName || "amzcustom-asset.png",
              alt: asset.alt || "Customization Asset",
            });
            replacements.set(asset.url, uploaded.shopifyCdnUrl);
            assetsUploadedCount += 1;
          } catch (uploadError: unknown) {
            const errDetail =
              uploadError instanceof Error ? uploadError.message : String(uploadError);
            warnings.push(`Failed to upload customization asset ${asset.url}: ${errDetail}`);
          }
        }
      }

      // Reconstruct customizer config replacing old Amazon URLs with Shopify CDN URLs
      const baseConfig: Record<string, unknown> = {
        hasCustomization: true,
        assets: product.customization.assets,
        optionGroups: product.customization.optionGroups,
        pricing: product.customization.pricing,
        textInputs: product.customization.textInputs,
        formUrl: product.customization.formUrl,
        ...product.customization.rawConfig,
      };

      const finalConfig = replaceUrlsInObject(baseConfig, replacements) as Record<
        string,
        unknown
      >;

      // 4. Set Metafield custom.amazon_customizer
      try {
        const metaResult = await gateway.setProductMetafield({
          productId: createdProduct.productId,
          namespace: "custom",
          key: "amazon_customizer",
          type: "json",
          value: JSON.stringify(finalConfig),
        });
        metafieldSet = metaResult.success;
      } catch (metaError: unknown) {
        const errDetail =
          metaError instanceof Error ? metaError.message : String(metaError);
        warnings.push(`Failed to set custom.amazon_customizer metafield: ${errDetail}`);
      }
    }

    return {
      success: true,
      sourceId: product.id,
      productId: createdProduct.productId,
      productHandle: createdProduct.productHandle,
      title: product.title,
      variantsCount,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount,
      metafieldSet,
      dryRun,
      warnings,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      sourceId: product.id,
      title: product.title,
      variantsCount: 0,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount: 0,
      metafieldSet: false,
      dryRun,
      warnings,
      error: msg,
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
