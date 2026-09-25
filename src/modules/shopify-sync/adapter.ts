import type {
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerOutput,
  ProductMediaItem,
} from "../customization-normalizer";
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

function normalizeAsin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : undefined;
}

function formatPrice(value: unknown, defaultVal = "0.00"): string {
  if (value == null) return defaultVal;
  if (typeof value === "number") return Number.isFinite(value) ? value.toFixed(2) : defaultVal;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^0-9.]/g, "");
    return cleaned ? Number(cleaned).toFixed(2) : defaultVal;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.amount === "number") {
      return Number.isFinite(obj.amount) ? obj.amount.toFixed(2) : defaultVal;
    }
    if (typeof obj.amount === "string") {
      const cleaned = obj.amount.replace(/[^0-9.]/g, "");
      if (cleaned) return Number(cleaned).toFixed(2);
    }
    if (typeof obj.raw === "string") {
      const cleaned = obj.raw.replace(/[^0-9.]/g, "");
      if (cleaned) return Number(cleaned).toFixed(2);
    }
  }
  return defaultVal;
}

function formatOptionalPrice(value: unknown): string | undefined {
  if (value == null) return undefined;
  const price = formatPrice(value, "");
  return price && price !== "0.00" ? price : undefined;
}

export function fromCustomizationNormalizerProduct(
  product: CrawlProduct,
  options?: {
    readonly vendor?: string;
    readonly productType?: string;
    readonly amazonParentAsin?: string;
  },
): ShopifySyncProductInput {
  const title = product.title || product.sourceTitle || "Custom Product";
  const descriptionHtml = typeof product.descriptionHtml === "string"
    ? product.descriptionHtml
    : buildProductDescriptionHtml(product);
  const seo = product.seo && typeof product.seo === "object"
    ? product.seo as { readonly title?: unknown; readonly description?: unknown }
    : undefined;

  const media: ShopifyMediaInput[] = (product.media || [])
    .filter((item: ProductMediaItem) => String(item.kind ?? "image").toLowerCase() !== "video")
    .map((item: ProductMediaItem) => ({
      originalSource: typeof item.processedUrl === "string" && item.processedUrl
        ? item.processedUrl
        : item.url,
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
  let amazonAsin: string | undefined;
  let amazonParentAsin: string | undefined;

  if (rawCustomization && typeof rawCustomization === "object") {
    tags.add("has-customizer");
    amazonAsin = normalizeAsin(rawCustomization.source?.asin);
    amazonParentAsin = normalizeAsin(options?.amazonParentAsin ?? product.parentAsin);

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
      ...(rawCustomization as Record<string, unknown>),
      hasCustomization: true,
      assets,
      optionGroups: rawCustomization.optionGroups as readonly Record<string, unknown>[] | undefined,
      pricing: rawCustomization.pricing as Record<string, unknown> | undefined,
      textInputs: rawCustomization.textInputs as readonly Record<string, unknown>[] | undefined,
      surfaces: rawCustomization.surfaces as readonly Record<string, unknown>[] | undefined,
      placements: rawCustomization.placements as readonly Record<string, unknown>[] | undefined,
      product: rawCustomization.product as Record<string, unknown> | undefined,
      controlOrder: rawCustomization.controlOrder as readonly Record<string, unknown>[] | undefined,
      formUrl: rawCustomization.formUrl,
    };
  }

  const variants: ShopifyVariantInput[] = (product.variants || [])
    .filter(isRecord)
    .flatMap((v) => {
      const priceStr = formatPrice(v.price, "");
      if (!priceStr) return [];
      const compareAtPriceStr = formatOptionalPrice(v.compareAtPrice);
      const optionValues: Array<{ name: string; optionName: string }> = [];

      if (isRecord(v.options)) {
        for (const [optName, optVal] of Object.entries(v.options)) {
          optionValues.push({
            optionName: optName,
            name: String(optVal),
          });
        }
      }

      return [{
        title: typeof v.title === "string" ? v.title : undefined,
        price: priceStr,
        compareAtPrice: compareAtPriceStr,
        sku: typeof v.sku === "string" ? v.sku : undefined,
        barcode: typeof v.barcode === "string" ? v.barcode : undefined,
        inventoryTracked: false, // Default to Inventory not tracked
        optionValues: optionValues.length > 0 ? optionValues : undefined,
        mediaUrl: typeof v.mediaUrl === "string" ? v.mediaUrl : undefined,
      }];
    });

  const productType =
    typeof options?.productType === "string" && options.productType.trim() !== ""
      ? options.productType.trim()
      : product.categories && product.categories.length > 0
      ? String(product.categories[product.categories.length - 1])
      : "Custom Product";

  return {
    id: product.id,
    sourceKey: typeof product.sourceKey === "string" ? product.sourceKey : product.id,
    amazonAsin,
    amazonParentAsin,
    title,
    descriptionHtml,
    handle: typeof product.handle === "string" ? product.handle : undefined,
    seo: typeof seo?.title === "string" && typeof seo.description === "string"
      ? { title: seo.title, description: seo.description }
      : undefined,
    vendor: options?.vendor ?? "FFP Store",
    productType,
    tags: Array.from(tags),
    media,
    variants: variants.length > 0 ? variants : undefined,
    customization: customizerInput,
    sourceUrl: product.canonicalUrl,
  };
}

export function fromCustomizationNormalizerBatch(
  batch: CustomizationNormalizerOutput,
  options?: {
    readonly vendor?: string;
    readonly productType?: string;
    readonly amazonParentAsin?: string;
  },
): ShopifySyncBatchInput {
  return {
    jobId: batch.jobId,
    products: batch.products.map((product) => fromCustomizationNormalizerProduct(product, options)),
  };
}
