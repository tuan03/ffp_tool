import { characterLength, cleanAltText, isPlaceholderAlt } from "./alt-text-sanitizer";
import { fitAltText } from "./alt-text-fitter";

export interface AltTextGenerationOptions {
  readonly sourceAlt?: string;
  readonly sourceTitle?: string;
  readonly productTitle?: string;
  readonly primaryKeyword?: string;
  readonly productCategory?: string;
  readonly entities?: readonly string[];
  readonly visualStyle?: string;
  readonly imageIndex: number;
  readonly previousAlts?: readonly string[];
  readonly maxLength?: number;
}

function toSentenceCase(str: string): string {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

const GENERIC_ENTITIES = new Set([
  "general",
  "item",
  "product",
  "design",
  "photo",
  "image",
  "unspecified",
  "none",
  "unknown",
]);

const GENERIC_STYLES = new Set([
  "unspecified",
  "none",
  "unknown",
  "default",
  "n/a",
]);

/**
 * Generates an SEO-optimized, accessible, and grounded Alt text for product images:
 * 1. Prioritizes meaningful sourceAlt if already descriptive and clean (not placeholder/filename).
 * 2. If sourceTitle was empty/whitespace, falls back to "Product image ${index + 1}".
 * 3. If primaryKeyword is provided and distinct from sourceTitle, crafts an enriched alt text
 *    incorporating primaryKeyword + up to 1-2 distinct entities + visualStyle.
 * 4. Otherwise, falls back to "${effectiveTitle} - View ${index + 1}".
 * 5. Guarantees character length <= 125 and distinctness across gallery.
 */
export function generateAltText(options: AltTextGenerationOptions): string {
  const {
    sourceAlt,
    sourceTitle,
    productTitle,
    primaryKeyword,
    productCategory,
    entities = [],
    visualStyle,
    imageIndex,
    previousAlts = [],
    maxLength = 125,
  } = options;

  const trimmedSourceAlt = sourceAlt ? cleanAltText(sourceAlt) : "";
  const trimmedSourceTitle = sourceTitle ? cleanAltText(sourceTitle) : "";
  const trimmedProductTitle = productTitle ? cleanAltText(productTitle) : "";
  const effectiveTitle = trimmedProductTitle || trimmedSourceTitle;
  const trimmedPrimary = primaryKeyword ? cleanAltText(primaryKeyword) : "";

  // 1. If sourceAlt is meaningful, prioritize it
  if (trimmedSourceAlt && !isPlaceholderAlt(trimmedSourceAlt)) {
    const fitted = fitAltText(trimmedSourceAlt, maxLength);
    return ensureGalleryUniqueness(fitted, imageIndex, previousAlts, maxLength);
  }

  // 2. If sourceTitle was completely empty/whitespace (sparse product without original title)
  if (!trimmedSourceTitle) {
    return `Product image ${imageIndex + 1}`;
  }

  // 3. Enriched SEO Alt text if primaryKeyword is available and distinct from original title
  const isDistinctPrimary =
    trimmedPrimary &&
    trimmedPrimary.toLowerCase() !== trimmedSourceTitle.toLowerCase() &&
    trimmedPrimary.toLowerCase() !== trimmedProductTitle.toLowerCase();

  if (isDistinctPrimary) {
    const parts: string[] = [toSentenceCase(trimmedPrimary)];
    const primaryLower = trimmedPrimary.toLowerCase();

    // Select up to 1-2 distinct visual entities (filtering out stop words)
    const additionalEntities: string[] = [];
    for (const entity of entities) {
      const entityClean = cleanAltText(entity).toLowerCase();
      if (
        entityClean &&
        !GENERIC_ENTITIES.has(entityClean) &&
        !primaryLower.includes(entityClean) &&
        !additionalEntities.some((e) => e.includes(entityClean) || entityClean.includes(e))
      ) {
        additionalEntities.push(cleanAltText(entity));
        if (additionalEntities.length >= 2) break;
      }
    }

    if (additionalEntities.length > 0) {
      parts.push(`featuring ${additionalEntities.join(" and ")}`);
    }

    // Add visual style if provided, meaningful, and not already in primary
    if (
      visualStyle &&
      visualStyle.trim() &&
      !GENERIC_STYLES.has(visualStyle.trim().toLowerCase()) &&
      !primaryLower.includes(visualStyle.toLowerCase())
    ) {
      parts.push(`in ${cleanAltText(visualStyle)} style`);
    }

    const candidate = parts.join(" ");
    const fitted = fitAltText(candidate, maxLength);
    return ensureGalleryUniqueness(fitted, imageIndex, previousAlts, maxLength);
  }

  // 4. Default title-based view fallback
  if (effectiveTitle) {
    const candidate = `${effectiveTitle} - View ${imageIndex + 1}`;
    const fitted = fitAltText(candidate, maxLength);
    return ensureGalleryUniqueness(fitted, imageIndex, previousAlts, maxLength);
  }

  if (productCategory && productCategory.trim() && !GENERIC_ENTITIES.has(productCategory.trim().toLowerCase())) {
    const candidate = `${toSentenceCase(productCategory.trim())} - View ${imageIndex + 1}`;
    const fitted = fitAltText(candidate, maxLength);
    return ensureGalleryUniqueness(fitted, imageIndex, previousAlts, maxLength);
  }

  // 5. Ultimate fallback
  return `Product image ${imageIndex + 1}`;
}

function ensureGalleryUniqueness(
  alt: string,
  imageIndex: number,
  previousAlts: readonly string[],
  maxLength: number,
): string {
  if (!previousAlts.includes(alt)) {
    return fitAltText(alt, maxLength);
  }

  let attemptIndex = imageIndex + 1;
  while (attemptIndex <= imageIndex + 10) {
    const suffix = `, view ${attemptIndex}`;
    const suffixLen = characterLength(suffix);
    const maxBaseLen = Math.max(1, maxLength - suffixLen);
    const base = fitAltText(alt, maxBaseLen);
    const candidate = `${base}${suffix}`;

    if (!previousAlts.includes(candidate) && characterLength(candidate) <= maxLength) {
      return candidate;
    }
    attemptIndex++;
  }

  // Fallback unique candidate
  const fallbackSuffix = ` #${imageIndex + 1}`;
  const base = fitAltText(alt, Math.max(1, maxLength - characterLength(fallbackSuffix)));
  return `${base}${fallbackSuffix}`;
}
