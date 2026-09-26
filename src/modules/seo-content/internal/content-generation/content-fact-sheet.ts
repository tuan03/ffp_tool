import type { SeoContentInput } from "../../types";
import type { ProductUnderstanding, SeoPipelineContext } from "../domain-types";
import type { ContentFactSheet } from "./content-generation-types";
import { resolveStoreProfile } from "../store-profiles";

const PERSONALIZATION_PATTERN =
  /\b(personalized|personalised|personalization|personalisation|custom\s+name|your\s+name|custom\s+text|custom\s+photo|upload\s+photo|custom\s+image|monogram|initials|customizable|customisable|engraved|engraving|custom\s+song|custom\s+spotify)\b/i;

const PLACEHOLDER_PATTERN =
  /^(unknown|none|n\/a|not applicable|unspecified|sample|test|sku.*)[\s.]*$/i;

/**
 * Sanitizes text fields by eliminating empty strings, whitespace, and placeholder strings
 * such as 'unknown', 'none', 'n/a', etc.
 */
export function sanitizeFactText(text?: string): string | undefined {
  if (!text) return undefined;
  const clean = text.trim();
  if (clean.length === 0 || PLACEHOLDER_PATTERN.test(clean)) return undefined;
  return clean;
}

/**
 * Deterministically detects whether the product explicitly supports customization/personalization
 * based on verified source text, OCR text, and niche.
 */
export function detectPersonalizationEvidence(
  source: SeoContentInput,
  understanding?: ProductUnderstanding,
): boolean {
  if (PERSONALIZATION_PATTERN.test(source.title)) return true;
  if (PERSONALIZATION_PATTERN.test(source.description)) return true;
  if (PERSONALIZATION_PATTERN.test(source.niche)) return true;
  if (source.handle && PERSONALIZATION_PATTERN.test(source.handle)) return true;

  if (understanding?.typography.visibleTexts) {
    for (const ocr of understanding.typography.visibleTexts) {
      if (PERSONALIZATION_PATTERN.test(ocr)) return true;
    }
  }

  return false;
}

/**
 * Builds a clean, verified fact sheet from the pipeline context.
 * Strips raw HTML and filters untrusted claims before copywriting generation.
 */
export function buildContentFactSheet(
  context: SeoPipelineContext,
): ContentFactSheet {
  const { source, productUnderstanding, shoppingContext } = context;

  const storeProfile =
    context.storeProfile ??
    resolveStoreProfile({
      storeId: source.storeId,
      siteDomain: source.siteDomain ?? source.url,
    });

  const personalizationSupported = detectPersonalizationEvidence(
    source,
    productUnderstanding,
  );

  const effectiveNiche = context.effectiveNiche ?? storeProfile?.niche ?? source.niche;
  const sanitizedNiche = sanitizeFactText(effectiveNiche);
  const sanitizedProductIdentity =
    sanitizeFactText(productUnderstanding?.physicalProductIdentity) ||
    sanitizedNiche ||
    "product";

  return {
    originalTitle: source.title.trim(),
    originalDescription: source.description.trim(),
    existingHandle: source.handle,
    niche: sanitizedNiche,
    physicalProductIdentity: sanitizedProductIdentity,
    typographyVisibleTexts: (productUnderstanding?.typography.visibleTexts ?? [])
      .map((t) => sanitizeFactText(t))
      .filter((t): t is string => Boolean(t)),
    typographyStyleSummary: sanitizeFactText(productUnderstanding?.typography.styleSummary),
    visualEntities: sanitizeFactText(productUnderstanding?.visualEntities),
    targetAudience: shoppingContext?.targetAudience ?? [],
    occasions: shoppingContext?.suitableOccasions ?? [],
    useCases: shoppingContext?.useCases ?? [],
    personalizationSupported,
    variantLabel: sanitizeFactText(source.variantLabel),
    storeProfile,
  };
}

