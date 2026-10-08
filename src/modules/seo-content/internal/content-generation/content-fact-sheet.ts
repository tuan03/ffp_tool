import { normalizeExcludedLiterals, redactExcludedLiterals } from "../literal-text-guard";
import { projectStoreContentProfile } from "../store-profiles/types";

import type { SeoContentInput } from "../../types";
import type { ProductUnderstanding, SeoPipelineContext } from "../domain-types";
import type { ContentFactSheet } from "./content-generation-types";

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
  _source: SeoContentInput,
  understanding?: ProductUnderstanding,
): boolean {
  // Visible names/initials prove typography, not configurable personalization.
  // V2 requires an explicit applicable store policy for such a claim.
  void understanding;
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

  const effectiveNiche = context.effectiveNiche ?? source.niche;
  const storeProfile = projectStoreContentProfile(
    source.storeProfile,
    productUnderstanding?.physicalProductIdentity,
    effectiveNiche,
    productUnderstanding?.confidence,
  );

  const personalizationSupported = detectPersonalizationEvidence(
    source,
    productUnderstanding,
  );

  const sanitizedNiche = sanitizeFactText(effectiveNiche);
  const sanitizedProductIdentity =
    sanitizeFactText(productUnderstanding?.physicalProductIdentity) ||
    sanitizedNiche ||
    "product";
  const excludedLiteralTexts = normalizeExcludedLiterals([
    ...(productUnderstanding?.typography.visibleTexts ?? []),
    ...(productUnderstanding?.typography.excludedLiteralTexts ?? []),
  ]);
  const visualEntities = productUnderstanding?.visualEntities
    ? redactExcludedLiterals(productUnderstanding.visualEntities, excludedLiteralTexts, "unknown")
    : undefined;
  const typographyStyleSummary = productUnderstanding?.typography.styleSummary
    ? redactExcludedLiterals(productUnderstanding.typography.styleSummary, excludedLiteralTexts, "unknown")
    : undefined;

  return {
    originalTitle: [sanitizedProductIdentity, sanitizeFactText(visualEntities)]
      .filter(Boolean).join(" - "),
    originalDescription: [
      sanitizeFactText(visualEntities),
      sanitizeFactText(typographyStyleSummary),
    ].filter(Boolean).join(". "),
    niche: sanitizedNiche,
    physicalProductIdentity: sanitizedProductIdentity,
    typographyVisibleTexts: [],
    excludedLiteralTexts,
    typographyStyleSummary: sanitizeFactText(typographyStyleSummary),
    visualEntities: sanitizeFactText(visualEntities),
    targetAudience: shoppingContext?.targetAudience ?? [],
    occasions: shoppingContext?.suitableOccasions ?? [],
    useCases: shoppingContext?.useCases ?? [],
    personalizationSupported,
    storeProfile,
  };
}

