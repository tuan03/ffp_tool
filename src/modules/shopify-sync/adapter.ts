import type {
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerOutput,
  ProductMediaItem,
} from "../customization-normalizer/types";
import type {
  ShopifyCustomizationAssetInput,
  ShopifyMediaInput,
  ShopifyProductCustomizerInput,
  ShopifySyncBatchInput,
  ShopifySyncProductInput,
  ShopifyVariantInput,
} from "./types";

export function buildProductDescriptionHtml(product: Partial<CrawlProduct>): string {
  const parts: string[] = [];

  if (product.description) {
    parts.push(`<div class="product-description"><p>${escapeHtml(product.description)}</p></div>`);
  }

  if (product.bulletPoints && product.bulletPoints.length > 0) {
    const listItems = product.bulletPoints
      .filter((bp) => bp.trim().length > 0)
      .map((bp) => `<li>${escapeHtml(bp)}</li>`)
      .join("\n");
    parts.push(`<div class="product-highlights"><h3>Highlights</h3><ul>\n${listItems}\n</ul></div>`);
  }

  if (product.productDetails && Object.keys(product.productDetails).length > 0) {
    const rows = Object.entries(product.productDetails)
      .map(
        ([key, val]) =>
          `<tr><td style="font-weight:600;padding:4px 8px;">${escapeHtml(key)}</td><td style="padding:4px 8px;">${escapeHtml(String(val))}</td></tr>`,
      )
      .join("\n");
    parts.push(
      `<div class="product-specs"><h3>Specifications</h3><table style="width:100%;border-collapse:collapse;"><tbody>\n${rows}\n</tbody></table></div>`,
    );
  }

  return parts.join("\n<br/>\n");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function fromCustomizationNormalizerProduct(
  product: CrawlProduct,
): ShopifySyncProductInput {
  const title = product.title || product.sourceTitle || "Custom Product";
  const descriptionHtml = buildProductDescriptionHtml(product);

  const media: ShopifyMediaInput[] = (product.media || []).map((item: ProductMediaItem) => ({
    originalSource: item.url,
    alt: item.alt || title,
    mediaContentType: "IMAGE",
    friendlyFileName: item.friendlyFileName,
  }));

  const tags = new Set<string>();
  if (product.parentAsin) tags.add(`asin:${product.parentAsin}`);
  if (product.categories) {
    for (const cat of product.categories) {
      if (typeof cat === "string" && cat.trim().length > 0) {
        tags.add(cat.trim());
      }
    }
  }

  let customizerInput: ShopifyProductCustomizerInput | null = null;
  const rawCustomization = product.customization;

  if (rawCustomization && typeof rawCustomization === "object") {
    tags.add("has-customizer");

    const assets: ShopifyCustomizationAssetInput[] = (rawCustomization.assets || []).map(
      (asset: CustomizationAsset) => ({
        url: asset.url,
        alt: asset.alt,
        friendlyFileName: asset.friendlyFileName,
        roles: asset.roles,
        width: asset.width,
        height: asset.height,
      }),
    );

    customizerInput = {
      hasCustomization: true,
      assets,
      optionGroups: rawCustomization.optionGroups as readonly Record<string, unknown>[] | undefined,
      pricing: rawCustomization.pricing as Record<string, unknown> | undefined,
      textInputs: rawCustomization.textInputs as readonly Record<string, unknown>[] | undefined,
      formUrl: rawCustomization.formUrl,
    };
  }

  const variants: ShopifyVariantInput[] = (product.variants || [])
    .filter(isRecord)
    .map((v) => {
      const priceStr = v.price != null ? String(v.price) : "0.00";
      const optionValues: Array<{ name: string; optionName: string }> = [];

      if (isRecord(v.options)) {
        for (const [optName, optVal] of Object.entries(v.options)) {
          optionValues.push({
            optionName: optName,
            name: String(optVal),
          });
        }
      }

      return {
        title: typeof v.title === "string" ? v.title : undefined,
        price: priceStr,
        compareAtPrice: v.compareAtPrice != null ? String(v.compareAtPrice) : undefined,
        sku: typeof v.sku === "string" ? v.sku : undefined,
        barcode: typeof v.barcode === "string" ? v.barcode : undefined,
        optionValues: optionValues.length > 0 ? optionValues : undefined,
      };
    });

  return {
    id: product.id,
    title,
    descriptionHtml,
    vendor: "FFP Store",
    productType: "Custom Handbag",
    tags: Array.from(tags),
    media,
    variants: variants.length > 0 ? variants : undefined,
    customization: customizerInput,
    sourceUrl: product.canonicalUrl,
  };
}

export function fromCustomizationNormalizerBatch(
  batch: CustomizationNormalizerOutput,
): ShopifySyncBatchInput {
  return {
    jobId: batch.jobId,
    products: batch.products.map(fromCustomizationNormalizerProduct),
  };
}
