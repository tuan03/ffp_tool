import type { ProductUnderstanding } from "../domain-types";
import type { ShoppingContext } from "../domain-types";

interface GroundedSourceEvidence {
  readonly niche: string;
  readonly title: string;
  readonly description: string;
}

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
  if (!identity || identity === "unknown") {
    return { contextualAudienceHints: [], sceneSearchSeeds: [] };
  }

  const sceneProfiles: ReadonlyArray<{ readonly match: RegExp; readonly label: string }> = [
    { match: /\b(home|music) studio\b/, label: "home studio" },
    { match: /\bbedroom\b/, label: "bedroom" },
    { match: /\bliving room\b/, label: "living room" },
    { match: /\b(home office|workspace)\b/, label: "home office" },
    { match: /\bnursery\b/, label: "nursery" },
  ];
  const profile = sceneProfiles.find(({ match }) => match.test(scene));
  if (profile) {
    return {
      contextualAudienceHints: [`${profile.label} decorators`],
      sceneSearchSeeds: [`${profile.label} ${identity}`],
    };
  }
  return { contextualAudienceHints: [], sceneSearchSeeds: [] };
}

const SCENE_ONLY_TERM = /\b(studios?|guitars?|vinyl|turntable|monitor speakers?|audio producer|keyboard|desk|acoustic panels?|potted plants?)\b/i;

/** Removes scene-prop claims from B2's grounded fields before B3/B5 can consume them. */
export function removeSceneOnlyGroundedContext(
  context: ShoppingContext,
  source: GroundedSourceEvidence,
  productUnderstanding: ProductUnderstanding | undefined,
): ShoppingContext {
  const groundedEvidence = [
    source.title,
    source.description,
    source.niche,
    productUnderstanding?.physicalProductIdentity,
    productUnderstanding?.visualEntities,
    productUnderstanding?.typography.styleSummary,
    ...(productUnderstanding?.typography.visibleTexts ?? []),
  ].join(" ").toLowerCase();
  const removeSceneTerms = (items: readonly string[]): readonly string[] =>
    items.filter((item) => {
      const sceneTerm = item.match(SCENE_ONLY_TERM)?.[0]?.toLowerCase();
      return !sceneTerm || groundedEvidence.includes(sceneTerm);
    });
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
