import { evolveContext } from "../pipeline-context";

import type {
  SeoPipelineContext,
  SeoPipelineStage,
  ShoppingContext,
} from "../domain-types";

export async function executeB2ShoppingContext(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const niche = context.source.niche.trim() || "general audience";
  const entities = context.productUnderstanding?.detectedEntities.slice(0, 5);
  const buyerIntentKeywords =
    entities && entities.length > 0 ? entities : [niche];

  const shoppingContext: ShoppingContext = {
    targetAudience: [niche],
    suitableOccasions: ["everyday", "gifting"],
    useCases: ["home decor", "personal use"],
    buyerIntentKeywords,
  };

  return evolveContext(context, { shoppingContext });
}

export const b2ShoppingContextStage: SeoPipelineStage = {
  name: "b2",
  execute: executeB2ShoppingContext,
};
