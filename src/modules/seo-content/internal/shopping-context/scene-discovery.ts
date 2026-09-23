import type { ProductUnderstanding } from "../domain-types";
import type { ShoppingContext } from "../domain-types";

export interface SceneDiscoveryHints {
  readonly contextualAudienceHints: readonly string[];
  readonly sceneSearchSeeds: readonly string[];
}

/**
 * Scene evidence is deliberately processed outside the grounded B2 analyzer. This
 * prevents a model from treating room props as an attribute, audience, occasion or
 * use case of the product being sold.
 */
export function deriveSceneDiscoveryHints(
  productUnderstanding: ProductUnderstanding | undefined,
): SceneDiscoveryHints {
  const scene = productUnderstanding?.sceneContext.toLowerCase() ?? "";
  const identity = productUnderstanding?.physicalProductIdentity.trim() ?? "";
  if ((scene.includes("home studio") || scene.includes("music studio")) && identity && identity !== "unknown") {
    return {
      contextualAudienceHints: ["home studio decorators"],
      sceneSearchSeeds: [`home studio ${identity}`],
    };
  }
  return { contextualAudienceHints: [], sceneSearchSeeds: [] };
}

const SCENE_ONLY_TERM = /\b(studios?|guitars?|vinyl|turntable|monitor speakers?|audio producer|keyboard|desk|acoustic panels?|potted plants?)\b/i;

/** Removes scene-prop claims from B2's grounded fields before B3/B5 can consume them. */
export function removeSceneOnlyGroundedContext(
  context: ShoppingContext,
): ShoppingContext {
  const removeSceneTerms = (items: readonly string[]): readonly string[] =>
    items.filter((item) => !SCENE_ONLY_TERM.test(item));
  const targetAudience = removeSceneTerms(context.targetAudience);
  const suitableOccasions = removeSceneTerms(context.suitableOccasions);
  const useCases = removeSceneTerms(context.useCases);
  const buyerIntentKeywords = removeSceneTerms(context.buyerIntentKeywords);

  return {
    ...context,
    targetAudience: targetAudience.length > 0 ? targetAudience : ["general shoppers"],
    suitableOccasions: suitableOccasions.length > 0 ? suitableOccasions : ["everyday use"],
    useCases: useCases.length > 0 ? useCases : ["personal use"],
    buyerIntentKeywords: buyerIntentKeywords.length > 0 ? buyerIntentKeywords : ["product"],
  };
}
