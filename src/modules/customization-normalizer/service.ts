import type {
  CrawlProduct,
  CustomizationAsset,
  CustomizationNormalizerInput,
  CustomizationNormalizerOutput,
  CustomizationOption,
  CustomizationOptionGroup,
  ImageResource,
  ProductMediaItem,
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
