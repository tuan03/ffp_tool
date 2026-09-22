import type {
  ShopifySyncBatchInput,
  ShopifySyncBatchOutput,
  ShopifySyncOptions,
  ShopifySyncProductInput,
  ShopifySyncProductResult,
} from "../types";

export async function runMockShopifySync(
  input: ShopifySyncBatchInput | readonly ShopifySyncProductInput[],
  _options?: ShopifySyncOptions,
): Promise<ShopifySyncBatchOutput> {
  const products = Array.isArray(input)
    ? input
    : (input as ShopifySyncBatchInput).products;
  const jobId = Array.isArray(input)
    ? undefined
    : (input as ShopifySyncBatchInput).jobId;

  let totalAssetsUploaded = 0;
  const results: ShopifySyncProductResult[] = products.map((product, index) => {
    const hasCustom = Boolean(product.customization && product.customization.hasCustomization);
    const assetsCount = hasCustom ? product.customization?.assets?.length || 0 : 0;
    totalAssetsUploaded += assetsCount;

    const safeSlug = product.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return {
      success: true,
      sourceId: product.id || `mock-id-${index + 1}`,
      productId: `gid://shopify/Product/mock-${index + 1}`,
      productHandle: safeSlug || `mock-product-${index + 1}`,
      title: product.title,
      variantsCount: product.variants?.length || 1,
      mediaCount: product.media?.length || 0,
      assetsUploadedCount: assetsCount,
      metafieldSet: hasCustom,
      dryRun: true,
      warnings: [],
    };
  });

  return {
    jobId,
    totalProducts: products.length,
    successfulProducts: products.length,
    failedProducts: 0,
    totalAssetsUploaded,
    results,
  };
}
