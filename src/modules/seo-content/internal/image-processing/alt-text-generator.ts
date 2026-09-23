import { characterLength, cleanAltText, isPlaceholderAlt } from "./alt-text-sanitizer";
import { fitAltText } from "./alt-text-fitter";

export interface AltTextGenerationOptions {
  readonly sourceAlt?: string;
  readonly sourceTitle?: string;
  readonly productTitle?: string;
  readonly primaryKeyword?: string;
  readonly secondaryKeywords?: readonly string[];
  readonly physicalProductIdentity?: string;
  readonly typographyVisibleTexts?: readonly string[];
  readonly typographyStyleSummary?: string;
  readonly visualEntities?: string;
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
 * 2. Determines grounded base subject from primaryKeyword, productTitle, secondaryKeywords, or physical identity.
 * 3. Enriches it only with product-safe visual evidence and typography.
 * 4. Ensures word-safe fitting <= maxLength (default 125 chars) and gallery distinctness.
 * 5. Falls back safely to "Product image ${index + 1}" only when no title/keyword signals exist.
 */
export function generateAltText(options: AltTextGenerationOptions): string {
  const {
    sourceAlt,
    sourceTitle,
    productTitle,
    primaryKeyword,
    secondaryKeywords,
    physicalProductIdentity,
    typographyVisibleTexts = [],
    typographyStyleSummary,
    visualEntities,
    imageIndex,
    previousAlts = [],
    maxLength = 125,
  } = options;

  const trimmedSourceAlt = sourceAlt ? cleanAltText(sourceAlt) : "";
  const trimmedSourceTitle = sourceTitle ? cleanAltText(sourceTitle) : "";
  const trimmedProductTitle = productTitle ? cleanAltText(productTitle) : "";
  const effectiveTitle = trimmedProductTitle || trimmedSourceTitle;
  const trimmedPrimary = primaryKeyword ? cleanAltText(primaryKeyword) : "";
  const firstSecondary = secondaryKeywords?.[0] ? cleanAltText(secondaryKeywords[0]) : "";
  const trimmedCategory = physicalProductIdentity ? cleanAltText(physicalProductIdentity) : "";
  const cleanCategory =
    trimmedCategory &&
    !GENERIC_ENTITIES.has(trimmedCategory.toLowerCase()) &&
    !GENERIC_STYLES.has(trimmedCategory.toLowerCase())
      ? trimmedCategory
      : "";

  // 1. If sourceAlt is meaningful and not a placeholder/filename, prioritize it
  if (trimmedSourceAlt && !isPlaceholderAlt(trimmedSourceAlt)) {
    const fitted = fitAltText(trimmedSourceAlt, maxLength);
    return ensureGalleryUniqueness(fitted, imageIndex, previousAlts, maxLength);
  }

  // 2. If sourceTitle was completely empty/whitespace (sparse product without original title)
  if (!trimmedSourceTitle) {
    return `Product image ${imageIndex + 1}`;
  }

  // 3. Determine if we have product-safe visual enrichments.
  // or a primary keyword distinct from source title
  const coreSubject = trimmedPrimary || firstSecondary || effectiveTitle;
  const subjectLower = coreSubject.toLowerCase();

  // Filter meaningful visual entities that are not already present in the subject
  const additionalEntities: string[] = [];
  for (const entity of [visualEntities ?? "", ...typographyVisibleTexts]) {
    const entityClean = cleanAltText(entity);
    const entityLower = entityClean.toLowerCase();
    if (
      entityClean &&
      !GENERIC_ENTITIES.has(entityLower) &&
      !subjectLower.includes(entityLower) &&
      !additionalEntities.some(
        (e) => e.toLowerCase().includes(entityLower) || entityLower.includes(e.toLowerCase()),
      )
    ) {
      additionalEntities.push(entityClean);
      if (additionalEntities.length >= 2) break;
    }
  }

  const hasMeaningfulStyle = Boolean(
    typographyStyleSummary &&
    typographyStyleSummary.trim() &&
    !GENERIC_STYLES.has(typographyStyleSummary.trim().toLowerCase()) &&
    !subjectLower.includes(typographyStyleSummary.toLowerCase()),
  );

  const hasVisualEnrichment = additionalEntities.length > 0 || hasMeaningfulStyle;

  const isDistinctPrimary = Boolean(
    trimmedPrimary &&
    trimmedPrimary.toLowerCase() !== trimmedSourceTitle.toLowerCase() &&
    trimmedPrimary.toLowerCase() !== trimmedProductTitle.toLowerCase(),
  );

  // If we have visual enrichment or distinct primary keyword, build enriched alt text
  if (hasVisualEnrichment || isDistinctPrimary) {
    const basePhrase = trimmedPrimary || firstSecondary || effectiveTitle;
    const parts: string[] = [toSentenceCase(basePhrase)];

    if (additionalEntities.length > 0) {
      parts.push(`featuring ${additionalEntities.join(" and ")}`);
    }

    if (hasMeaningfulStyle && typographyStyleSummary) {
      parts.push(`with ${cleanAltText(typographyStyleSummary)} typography`);
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

  if (cleanCategory) {
    const candidate = `${toSentenceCase(cleanCategory)} - View ${imageIndex + 1}`;
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
