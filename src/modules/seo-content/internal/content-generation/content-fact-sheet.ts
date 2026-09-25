import type { SeoContentInput } from "../../types";
import type { ProductUnderstanding, SeoPipelineContext } from "../domain-types";
import type { ContentFactSheet } from "./content-generation-types";

const PERSONALIZATION_PATTERN =
  /\b(personalized|personalised|personalization|personalisation|custom\s+name|your\s+name|custom\s+text|custom\s+photo|upload\s+photo|custom\s+image|monogram|initials|customizable|customisable|engraved|engraving|custom\s+song|custom\s+spotify)\b/i;

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

  const personalizationSupported = detectPersonalizationEvidence(
    source,
    productUnderstanding,
  );

  return {
    originalTitle: source.title.trim(),
    originalDescription: source.description.trim(),
    existingHandle: source.handle,
    niche: (context.effectiveNiche ?? source.niche)?.trim() || undefined,
    physicalProductIdentity:
      productUnderstanding?.physicalProductIdentity?.trim() ||
      (context.effectiveNiche ?? source.niche)?.trim() ||
      "product",
    typographyVisibleTexts: productUnderstanding?.typography.visibleTexts ?? [],
    typographyStyleSummary: productUnderstanding?.typography.styleSummary?.trim() || undefined,
    visualEntities: productUnderstanding?.visualEntities?.trim() || undefined,
    targetAudience: shoppingContext?.targetAudience ?? [],
    occasions: shoppingContext?.suitableOccasions ?? [],
    useCases: shoppingContext?.useCases ?? [],
    personalizationSupported,
    variantLabel: source.variantLabel?.trim() || undefined,
  };
}
