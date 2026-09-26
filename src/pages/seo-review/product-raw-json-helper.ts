import type { SeoProductUiViewModel } from "./types";

/**
 * Builds the canonical raw JSON object representing a product in the SEO Review workflow.
 * Includes all essential SEO fields, images, variants, and isolated AEO Suite fields (aeo_*).
 */
export function buildProductRawJson(product: SeoProductUiViewModel): Record<string, unknown> {
  const result: Record<string, unknown> = {
    productId: product.productId || product.id,
    asin: product.asin,
    storeId: product.storeId,
    reviewStatus: product.reviewDecision,
    productTitle: product.productTitle.value,
    productDescription: product.productDescription.value,
    productSeoTitle: product.seoTitle.value,
    productSeoDescription: product.seoDescription.value,
    productHandle: product.handle.value,
    images: product.images.map((img) => ({
      sourceUrl: img.previewUrl.value,
      alt: img.alt.value,
      webp: {
        filename: img.webpFilename.value,
        url: img.webpUrl.value,
      },
    })),
    aeo_quick_summary: product.aeoQuickSummary?.value ?? "",
    aeo_faq: product.aeoFaq?.value ?? [],
    aeo_json_ld: product.aeoJsonLd?.value ?? "",
  };

  if (Array.isArray(product.sourceCrawlProduct?.variants) && product.sourceCrawlProduct.variants.length > 0) {
    result.variants = product.sourceCrawlProduct.variants;
  }

  if (product.sourceCrawlProduct?.customization) {
    result.customization = product.sourceCrawlProduct.customization;
  }

  return result;
}

/**
 * Serializes the canonical raw JSON object to a pretty-printed JSON string (2 spaces indent).
 */
export function serializeProductRawJson(product: SeoProductUiViewModel): string {
  return JSON.stringify(buildProductRawJson(product), null, 2);
}
