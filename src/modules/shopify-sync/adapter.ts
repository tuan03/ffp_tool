import { projectShopifyVariantOptions } from "./variant-options";
import { assignAmazonVariantSkus } from "./variant-sku";
import type {
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerOutput,
  ProductMediaItem,
} from "../customization-normalizer";
import type {
  ShopifyCustomizationAssetInput,
  ShopifyAeoFaqItem,
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

const JEMINISE_BEDDING_PRESETS = new Set(["jeminise_bedding_v2", "jeminise_bedding_v3"]);
const JEMINISE_BEDDING_OPTION_ORDER = ["Bedding Type", "Size", "Set Options"] as const;
const LEGACY_COMFORTER_SIZES: Readonly<Record<string, string>> = {
  'Twin (68" x 86")': "Twin (173 x 218 cm)",
  'Full (79" x 90")': "Full (200 x 230 cm)",
  'Queen (90" x 90")': "Queen (228 x 228 cm)",
  'King (90" x 104")': "King (228 x 264 cm)",
};

function orderedVariantOptions(
  product: CrawlProduct,
  variantOptions: Readonly<Record<string, unknown>>,
): readonly (readonly [string, unknown])[] {
  const entries = Object.entries(variantOptions);
  if (typeof product.preset !== "string" || !JEMINISE_BEDDING_PRESETS.has(product.preset)) {
    return entries;
  }

  const orderedNames = new Set<string>(JEMINISE_BEDDING_OPTION_ORDER);
  return [
    ...JEMINISE_BEDDING_OPTION_ORDER.flatMap((optionName) =>
      Object.prototype.hasOwnProperty.call(variantOptions, optionName)
        ? [[optionName, variantOptions[optionName]] as const]
        : [],
    ),
    ...entries.filter(([optionName]) => !orderedNames.has(optionName)),
  ];
}

function normalizeJeminiseBeddingOptionValue(
  product: CrawlProduct,
  variantOptions: Readonly<Record<string, unknown>>,
  optionName: string,
  optionValue: unknown,
): string {
  const value = String(optionValue);
  if (
    product.preset === "jeminise_bedding_v2" &&
    variantOptions["Bedding Type"] === "Comforter" &&
    optionName === "Size"
  ) {
    return LEGACY_COMFORTER_SIZES[value] ?? value;
  }
  return value;
}

function parseAeoFaq(value: unknown): readonly ShopifyAeoFaqItem[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const faq: ShopifyAeoFaqItem[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.question !== "string" || typeof entry.answer !== "string") {
      return undefined;
    }
    faq.push({ question: entry.question, answer: entry.answer });
  }
  return faq;
}

function normalizeAsin(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9]{10}$/.test(normalized) ? normalized : undefined;
}

function firstSourceVariantAsin(product: CrawlProduct): string | undefined {
  for (const sourceVariant of product.sourceVariants ?? []) {
    if (isRecord(sourceVariant)) {
      const asin = normalizeAsin(sourceVariant.asin);
      if (asin) return asin;
    }
  }
  return undefined;
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
    ? product.seo as {
        readonly title?: unknown;
        readonly description?: unknown;
        readonly aeo_quick_summary?: unknown;
        readonly aeo_faq?: unknown;
        readonly aeo_json_ld?: unknown;
      }
    : undefined;
  const aeoFaq = parseAeoFaq(seo?.aeo_faq);
  const hasAeo = seo?.aeo_quick_summary !== undefined ||
    seo?.aeo_faq !== undefined ||
    seo?.aeo_json_ld !== undefined;
  if (hasAeo && (typeof seo?.aeo_quick_summary !== "string" ||
      aeoFaq === undefined ||
      typeof seo.aeo_json_ld !== "string")) {
    throw new Error("AEO output requires a quick summary, FAQ items, and Schema.org JSON-LD.");
  }
  const aeo = hasAeo && typeof seo?.aeo_quick_summary === "string" &&
      aeoFaq !== undefined && typeof seo.aeo_json_ld === "string"
    ? {
        quickSummary: seo.aeo_quick_summary,
        faq: aeoFaq,
        jsonLd: seo.aeo_json_ld,
      }
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
  const amazonAsin = normalizeAsin(product.asin)
    ?? normalizeAsin(rawCustomization?.source?.asin)
    ?? firstSourceVariantAsin(product);
  const amazonParentAsin = normalizeAsin(
    options?.amazonParentAsin ?? product.parentAsin ?? product.asin,
  );

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

  const variantSources = (product.variants || [])
    .filter(isRecord)
    .flatMap((v) => {
      const priceStr = formatPrice(v.price, "");
      if (!priceStr) return [];
      const compareAtPriceStr = formatOptionalPrice(v.compareAtPrice);
      // The family ID is not a SKU source. Options distinguish generated variants sharing an ASIN.
      const variantAsin = normalizeAsin(v.sourceAsin) ?? normalizeAsin(v.asin) ?? amazonAsin;
      const optionValues: Array<{ name: string; optionName: string }> = [];

      if (isRecord(v.options)) {
        for (const [optName, optVal] of orderedVariantOptions(product, v.options)) {
          optionValues.push({
            optionName: optName,
            name: normalizeJeminiseBeddingOptionValue(product, v.options, optName, optVal),
          });
        }
      }

      const variant: ShopifyVariantInput = {
        title: typeof v.title === "string" ? v.title : undefined,
        price: priceStr,
        compareAtPrice: compareAtPriceStr,
        sku: typeof v.sku === "string" ? v.sku : undefined,
        barcode: typeof v.barcode === "string" ? v.barcode : undefined,
        inventoryTracked: false, // Default to Inventory not tracked
        optionValues: optionValues.length > 0 ? optionValues : undefined,
        mediaUrl: typeof v.mediaUrl === "string" ? v.mediaUrl : undefined,
      };
      return [{ asin: variantAsin, variant }];
    });
  const variants = assignAmazonVariantSkus(variantSources);

  const productType =
    typeof options?.productType === "string" && options.productType.trim() !== ""
      ? options.productType.trim()
      : product.categories && product.categories.length > 0
      ? String(product.categories[product.categories.length - 1])
      : "Custom Product";

  return projectShopifyVariantOptions({
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
    aeo,
    vendor: options?.vendor ?? "FFP Store",
    productType,
    tags: Array.from(tags),
    media,
    variants: variants.length > 0 ? variants : undefined,
    customization: customizerInput,
    sourceUrl: product.canonicalUrl,
  });
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
