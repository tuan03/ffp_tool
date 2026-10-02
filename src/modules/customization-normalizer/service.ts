import type {
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerInput,
  CustomizationNormalizerOutput,
  CustomizationOption,
  CustomizationOptionGroup,
  ImageResource,
  PayloadValidationResult,
  PinterestPodDeliverableItemInput,
  ProductMediaItem,
  ShopifyProductInputForNormalization,
} from "./types";

export function hasCustomization(product: CrawlProduct): boolean {
  const customization = product.customization;
  if (!customization || typeof customization !== "object") {
    return false;
  }

  if (customization.hasCustomization === true) {
    return true;
  }

  const hasOptionGroups = Boolean(customization.optionGroups && customization.optionGroups.length > 0);
  const hasPaidGroups = Boolean(
    customization.pricing &&
      customization.pricing.paidOptionGroups &&
      customization.pricing.paidOptionGroups.length > 0,
  );
  const hasTextInputs = Boolean(customization.textInputs && customization.textInputs.length > 0);
  const hasAssets = Boolean(customization.assets && customization.assets.length > 0);
  const hasFormUrl = typeof customization.formUrl === "string" && customization.formUrl.trim().length > 0;

  return hasOptionGroups || hasPaidGroups || hasTextInputs || hasAssets || hasFormUrl;
}

export function slugify(text: string, maxLength = 48): string {
  const normalized = text
    .replace(/[đĐ]/g, "d")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return normalized.slice(0, maxLength).replace(/-+$/g, "");
}

export function computeShortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = (hash * 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0").slice(0, 6);
}

export function extractFileExtension(url: string, fallback = ".png"): string {
  try {
    const parsed = new URL(url);
    const lastDotIndex = parsed.pathname.lastIndexOf(".");
    if (lastDotIndex !== -1) {
      const extension = parsed.pathname.slice(lastDotIndex).toLowerCase();
      if (/^\.(png|jpe?g|webp|gif|svg|woff2?|ttf|otf)$/.test(extension)) {
        return extension;
      }
    }
  } catch {
    // If URL parsing fails, continue to fallback.
  }
  return fallback;
}

export function generateFriendlyFileName(url: string, label: string, prefix = "amzcustom"): string {
  const cleanLabel = slugify(label);
  const hash = computeShortHash(url);
  const extension = extractFileExtension(url);

  if (cleanLabel) {
    return `${prefix}-${cleanLabel}-${hash}${extension}`;
  }
  return `${prefix}-${hash}${extension}`;
}

export function cleanImageUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return trimmed;
  }
  // Remove trailing resize tokens like ._AC_US40_ if present before file extension
  return trimmed.replace(/\._[A-Z0-9_,]+(\.[a-zA-Z0-9]+)$/i, "$1");
}

function normalizeImageResource(
  imageResource: ImageResource | null | undefined,
  groupLabel: string,
  optionLabel: string,
  role: "Thumbnail" | "Overlay",
): { resource: ImageResource | null; count: number } {
  if (!imageResource || !imageResource.url) {
    return { resource: imageResource ?? null, count: 0 };
  }

  const cleanedUrl = cleanImageUrl(imageResource.url);
  const descriptiveAlt = `${groupLabel} - ${optionLabel} (${role})`;
  const friendlyName = generateFriendlyFileName(cleanedUrl, `${groupLabel} ${optionLabel}`, role.toLowerCase());

  return {
    resource: {
      ...imageResource,
      url: cleanedUrl,
      alt: imageResource.alt || descriptiveAlt,
      friendlyFileName: imageResource.friendlyFileName || friendlyName,
    },
    count: 1,
  };
}

function normalizeOptionGroups(groups: CustomizationOptionGroup[]): {
  groups: CustomizationOptionGroup[];
  assetMap: Map<string, string>;
  count: number;
} {
  const assetMap = new Map<string, string>();
  let count = 0;

  const normalizedGroups = groups.map((group) => {
    const groupLabel = group.label || "Option";
    const normalizedOptions = (group.options || []).map((option: CustomizationOption) => {
      const optionLabel = option.label || "Choice";

      const thumbResult = normalizeImageResource(option.thumbnailImage, groupLabel, optionLabel, "Thumbnail");
      const overlayResult = normalizeImageResource(option.overlayImage, groupLabel, optionLabel, "Overlay");

      if (thumbResult.resource?.url && thumbResult.resource.alt) {
        assetMap.set(thumbResult.resource.url, thumbResult.resource.alt);
        count += thumbResult.count;
      }
      if (overlayResult.resource?.url && overlayResult.resource.alt) {
        assetMap.set(overlayResult.resource.url, overlayResult.resource.alt);
        count += overlayResult.count;
      }

      return {
        ...option,
        thumbnailImage: thumbResult.resource,
        overlayImage: overlayResult.resource,
      };
    });

    return {
      ...group,
      options: normalizedOptions,
    };
  });

  return { groups: normalizedGroups, assetMap, count };
}

export function normalizeCustomizationProduct(product: CrawlProduct): {
  normalizedProduct: CrawlProduct;
  assetsNormalized: number;
} {
  if (!hasCustomization(product)) {
    return { normalizedProduct: product, assetsNormalized: 0 };
  }

  // Deep clone product to respect immutable inputs rule
  const cloned: CrawlProduct = JSON.parse(JSON.stringify(product));
  const customization = cloned.customization;
  if (!customization) {
    return { normalizedProduct: product, assetsNormalized: 0 };
  }

  let totalNormalized = 0;
  const knownAssetLabels = new Map<string, string>();

  // 1. Normalize optionGroups
  if (customization.optionGroups && customization.optionGroups.length > 0) {
    const { groups, assetMap, count } = normalizeOptionGroups(customization.optionGroups);
    customization.optionGroups = groups;
    totalNormalized += count;
    for (const [url, alt] of assetMap) {
      knownAssetLabels.set(url, alt);
    }
  }

  // 2. Normalize pricing.paidOptionGroups
  if (customization.pricing && customization.pricing.paidOptionGroups && customization.pricing.paidOptionGroups.length > 0) {
    const { groups, assetMap, count } = normalizeOptionGroups(customization.pricing.paidOptionGroups);
    customization.pricing.paidOptionGroups = groups;
    totalNormalized += count;
    for (const [url, alt] of assetMap) {
      knownAssetLabels.set(url, alt);
    }
  }

  // 3. Normalize customization.assets
  if (customization.assets && customization.assets.length > 0) {
    customization.assets = customization.assets.map((asset: CustomizationAsset) => {
      const cleanedUrl = cleanImageUrl(asset.url);
      const roles = asset.roles || [];
      let defaultAlt = knownAssetLabels.get(cleanedUrl) || knownAssetLabels.get(asset.url);

      if (!defaultAlt) {
        if (roles.includes("base")) {
          defaultAlt = `${cloned.title || "Product"} - Base Preview`;
        } else if (roles.includes("thumbnail")) {
          defaultAlt = `${cloned.title || "Product"} - Customizer Thumbnail`;
        } else if (roles.includes("overlay")) {
          defaultAlt = `${cloned.title || "Product"} - Customizer Overlay`;
        } else {
          defaultAlt = `${cloned.title || "Product"} - Customizer Asset`;
        }
      }

      const friendlyName = generateFriendlyFileName(
        cleanedUrl,
        defaultAlt,
        roles[0] || "asset",
      );

      totalNormalized += 1;
      return {
        ...asset,
        url: cleanedUrl,
        alt: asset.alt || defaultAlt,
        friendlyFileName: asset.friendlyFileName || friendlyName,
      };
    });
  }

  // 4. Normalize media gallery images with alt text and friendly name
  if (cloned.media && cloned.media.length > 0) {
    cloned.media = cloned.media.map((item: ProductMediaItem, index: number) => {
      const cleanedUrl = cleanImageUrl(item.url);
      const itemAlt = item.alt || `${cloned.title || "Product"} - Image ${index + 1}`;
      const friendlyName = generateFriendlyFileName(
        cleanedUrl,
        `${cloned.title || "product"} img ${index + 1}`,
        "media",
      );
      totalNormalized += 1;
      return {
        ...item,
        url: cleanedUrl,
        alt: itemAlt,
        friendlyFileName: item.friendlyFileName || friendlyName,
      };
    });
  }

  return { normalizedProduct: cloned, assetsNormalized: totalNormalized };
}

export async function runCustomizationNormalizer(
  input: CustomizationNormalizerInput,
): Promise<CustomizationNormalizerOutput> {
  const totalProducts = input.products.length;
  let customizedProducts = 0;
  let untouchedProducts = 0;
  let totalAssetsNormalized = 0;

  const processedProducts = input.products.map((product) => {
    if (hasCustomization(product)) {
      customizedProducts += 1;
      const { normalizedProduct, assetsNormalized } = normalizeCustomizationProduct(product);
      totalAssetsNormalized += assetsNormalized;
      return normalizedProduct;
    }

    untouchedProducts += 1;
    // If product has no customization, keep Sang's output as-is
    return product;
  });

  return {
    ...input,
    products: processedProducts,
    normalizationSummary: {
      totalProducts,
      customizedProducts,
      untouchedProducts,
      normalizedAssetsCount: totalAssetsNormalized,
    },
  };
}

// ============================================================================
// Security & Validation Helpers (NORMALIZER-02)
// ============================================================================

const DANGEROUS_PROTOCOLS = new Set(["file:", "javascript:", "data:", "ftp:", "gopher:"]);
const DANGEROUS_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "169.254.169.254", "::1"]);

export function isSafeHttpUrl(urlStr: string): boolean {
  if (!urlStr || typeof urlStr !== "string") {
    return false;
  }
  try {
    const parsed = new URL(urlStr.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return false;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (DANGEROUS_HOSTS.has(hostname) || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function validateProductPayload(payload: unknown): PayloadValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      isValid: false,
      errors: ["Payload must be a non-null JSON object."],
      warnings,
    };
  }

  const obj = payload as Record<string, unknown>;

  // Check title
  const title = obj.title ?? obj.sourceTitle ?? obj.originalPinTitle;
  if (!title || typeof title !== "string" || title.trim().length === 0) {
    errors.push("Product must have a non-empty title or sourceTitle.");
  }

  // Check Amazon ASIN format if present
  if (obj.asin !== undefined && obj.asin !== null) {
    if (typeof obj.asin !== "string" || !/^[A-Z0-9]{10}$/i.test(obj.asin.trim())) {
      errors.push(`Invalid ASIN format: "${String(obj.asin)}". Expected 10-character alphanumeric.`);
    }
  }

  // Check media URLs for security (SSRF prevention)
  if (Array.isArray(obj.media)) {
    for (let i = 0; i < obj.media.length; i += 1) {
      const item = obj.media[i];
      if (item && typeof item === "object") {
        const url = (item as { url?: unknown }).url;
        if (typeof url === "string" && !isSafeHttpUrl(url)) {
          errors.push(`Media item at index ${i} has an unsafe or invalid URL: "${url}".`);
        }
      }
    }
  }

  // Check customization integrity if present
  if (obj.customization && typeof obj.customization === "object") {
    const cust = obj.customization as Record<string, unknown>;
    if (cust.optionGroups !== undefined && !Array.isArray(cust.optionGroups)) {
      errors.push("Customization optionGroups must be an array.");
    }
    if (cust.assets !== undefined && Array.isArray(cust.assets)) {
      for (let i = 0; i < cust.assets.length; i += 1) {
        const asset = cust.assets[i];
        if (asset && typeof asset === "object") {
          const url = (asset as { url?: unknown }).url;
          if (typeof url === "string" && !isSafeHttpUrl(url)) {
            errors.push(`Customization asset at index ${i} has an unsafe URL: "${url}".`);
          }
        }
      }
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// Multi-source Adapters (NORMALIZER-04)
// ============================================================================

export function fromPinterestPodItem(item: PinterestPodDeliverableItemInput): CrawlProduct {
  const media: ProductMediaItem[] = [];

  if (item.cutoutProduct?.transparentUrl && isSafeHttpUrl(item.cutoutProduct.transparentUrl)) {
    media.push({
      url: item.cutoutProduct.transparentUrl,
      kind: "IMAGE",
      alt: `${item.originalPinTitle} - Cutout Transparent`,
    });
  }
  if (item.cutoutProduct?.whiteBgUrl && isSafeHttpUrl(item.cutoutProduct.whiteBgUrl)) {
    media.push({
      url: item.cutoutProduct.whiteBgUrl,
      kind: "IMAGE",
      alt: `${item.originalPinTitle} - Cutout White Background`,
    });
  }

  if (Array.isArray(item.composedMockups)) {
    for (const mockup of item.composedMockups) {
      if (mockup.mockupUrl && isSafeHttpUrl(mockup.mockupUrl)) {
        media.push({
          url: mockup.mockupUrl,
          kind: "IMAGE",
          alt: `${item.originalPinTitle} - ${mockup.detectedSceneType || "Mockup"}`,
        });
      }
    }
  }

  const tags: string[] = ["source:pinterest-pod"];
  if (Array.isArray(item.trendKeywords)) {
    tags.push(...item.trendKeywords);
  }

  return {
    id: `pod_${item.designId}`,
    sourcePlatform: "pinterest",
    sourceProductId: item.designId,
    title: item.originalPinTitle,
    handle: slugify(item.originalPinTitle),
    categories: item.productType ? [item.productType] : [],
    media,
    variants: item.variants ? [...item.variants] : [],
    tags,
    vendor: item.vendor,
    productType: item.productType,
    customization: null,
  };
}

export function fromShopifyProduct(shopifyProduct: ShopifyProductInputForNormalization): CrawlProduct {
  const media: ProductMediaItem[] = (shopifyProduct.images ?? []).map((img, idx) => ({
    url: img.url,
    kind: "IMAGE",
    alt: img.altText || `${shopifyProduct.title} - Image ${idx + 1}`,
  }));

  let customization: any = null;
  const customizerMetafield = (shopifyProduct.metafields ?? []).find(
    (m) => (m.namespace === "custom" || !m.namespace) && m.key === "amazon_customizer",
  );
  if (customizerMetafield?.value) {
    try {
      customization = JSON.parse(customizerMetafield.value);
    } catch {
      // Ignore unparseable JSON
    }
  }

  return {
    id: shopifyProduct.id,
    sourcePlatform: "shopify",
    sourceProductId: shopifyProduct.id,
    title: shopifyProduct.title,
    handle: shopifyProduct.handle || slugify(shopifyProduct.title),
    descriptionHtml: shopifyProduct.descriptionHtml,
    vendor: shopifyProduct.vendor,
    productType: shopifyProduct.productType,
    tags: shopifyProduct.tags ? [...shopifyProduct.tags] : [],
    media,
    variants: shopifyProduct.variants ? [...shopifyProduct.variants] : [],
    customization,
  };
}

// ============================================================================
// Canonical Checksum Computation (NORMALIZER-03)
// ============================================================================

export function canonicalJsonStringify(val: unknown): string {
  if (val === null || typeof val !== "object") {
    return JSON.stringify(val) ?? "";
  }
  if (Array.isArray(val)) {
    return "[" + val.map((item) => canonicalJsonStringify(item) || "null").join(",") + "]";
  }
  const obj = val as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const entries: string[] = [];
  for (const k of keys) {
    const v = obj[k];
    if (v !== undefined && typeof v !== "function" && typeof v !== "symbol") {
      entries.push(`${JSON.stringify(k)}:${canonicalJsonStringify(v)}`);
    }
  }
  return "{" + entries.join(",") + "}";
}

export function computeNormalizedProductChecksum(
  product: CrawlProduct,
  options?: Record<string, unknown>,
): string {
  const payloadToHash = {
    title: product.title ?? product.sourceTitle ?? "",
    handle: product.handle ?? "",
    description: product.description ?? "",
    asin: product.asin ?? "",
    parentAsin: product.parentAsin ?? "",
    sourcePlatform: product.sourcePlatform ?? "amazon",
    media: (product.media ?? []).map((m) => ({ url: m.url, alt: m.alt })),
    customization: product.customization
      ? {
          optionGroups: product.customization.optionGroups,
          pricing: product.customization.pricing,
          assets: product.customization.assets,
          textInputs: product.customization.textInputs,
        }
      : null,
    ...(options ?? {}),
  };

  const serialized = canonicalJsonStringify(payloadToHash);

  let h1 = 0x811c9dc5;
  let h2 = 0x84222325;
  for (let i = 0; i < serialized.length; i += 1) {
    const ch = serialized.charCodeAt(i);
    h1 ^= ch;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= ch;
    h2 = Math.imul(h2, 0x01000193) ^ (h1 >>> 16);
  }
  const hex1 = (h1 >>> 0).toString(16).padStart(8, "0");
  const hex2 = (h2 >>> 0).toString(16).padStart(8, "0");
  return `${hex1}${hex2}`;
}
