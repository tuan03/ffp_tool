import { normalizeExcludedLiterals, redactExcludedLiterals } from "../literal-text-guard";

import type { ProductUnderstanding } from "../domain-types";
import type { ProductImageAnalysis } from "./product-image-analyzer";

function clean(text: string | undefined, fallback: string): string {
  return text?.replace(/\s+/g, " ").trim() || fallback;
}

export function buildProductUnderstanding(
  imageAnalysis: ProductImageAnalysis | undefined,
): ProductUnderstanding {
  if (!imageAnalysis) {
    return Object.freeze({
      typography: Object.freeze({ visibleTexts: Object.freeze([]), styleSummary: "unknown" }),
      visualEntities: "unknown",
      sceneContext: "unknown",
      physicalProductIdentity: "unknown",
      identityCandidates: Object.freeze([]),
      excludedSceneEntities: Object.freeze([]),
      confidence: 0,
      reviewRequired: true,
    });
  }

  const excludedLiteralTexts = normalizeExcludedLiterals(
    imageAnalysis.typography.visibleTexts.map((text) => clean(text, "")).filter(Boolean),
  );

  return Object.freeze({
    typography: Object.freeze({
      visibleTexts: Object.freeze([]),
      excludedLiteralTexts: Object.freeze(excludedLiteralTexts),
      styleSummary: redactExcludedLiterals(
        clean(imageAnalysis.typography.styleSummary, "unknown"),
        excludedLiteralTexts,
        "unknown",
      ),
    }),
    visualEntities: redactExcludedLiterals(
      clean(imageAnalysis.visualEntities, "unknown"),
      excludedLiteralTexts,
      "unknown",
    ),
    sceneContext: redactExcludedLiterals(
      clean(imageAnalysis.sceneContext, "unknown"),
      excludedLiteralTexts,
      "unknown",
    ),
    physicalProductIdentity: clean(imageAnalysis.physicalProductIdentity, "unknown"),
    identityCandidates: Object.freeze([...(imageAnalysis.identityCandidates ?? [])]),
    excludedSceneEntities: Object.freeze([...(imageAnalysis.excludedSceneEntities ?? [])]),
    confidence: imageAnalysis.confidence,
    reviewRequired: imageAnalysis.reviewRequired,
  });
}
