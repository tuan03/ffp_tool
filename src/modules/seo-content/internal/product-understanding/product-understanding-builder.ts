import type { ProductUnderstanding } from "../domain-types";
import type { ProductImageAnalysis } from "./product-image-analyzer";
import type { TextProductSignals } from "./text-product-signals";

function clean(text: string | undefined, fallback: string): string {
  return text?.replace(/\s+/g, " ").trim() || fallback;
}

export function buildProductUnderstanding(
  imageAnalysis: ProductImageAnalysis | undefined,
  textSignals: TextProductSignals,
): ProductUnderstanding {
  if (!imageAnalysis) {
    return Object.freeze({
      typography: Object.freeze({ visibleTexts: Object.freeze([]), styleSummary: "unknown" }),
      visualEntities: "unknown",
      sceneContext: "unknown",
      physicalProductIdentity: clean(textSignals.physicalProductIdentity, "unknown"),
    });
  }

  const visibleTexts = Array.from(new Set(
    imageAnalysis.typography.visibleTexts.map((text) => clean(text, "")).filter(Boolean),
  ));

  return Object.freeze({
    typography: Object.freeze({
      visibleTexts: Object.freeze(visibleTexts),
      styleSummary: clean(imageAnalysis.typography.styleSummary, "unknown"),
    }),
    visualEntities: clean(imageAnalysis.visualEntities, "unknown"),
    sceneContext: clean(imageAnalysis.sceneContext, "unknown"),
    physicalProductIdentity: clean(
      imageAnalysis.physicalProductIdentity,
      clean(textSignals.physicalProductIdentity, "unknown"),
    ),
  });
}
