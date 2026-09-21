import { evolveContext } from "../pipeline-context";

import type {
  ProductUnderstanding,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export async function executeB1ProductUnderstanding(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const titleTokens = context.source.title.trim().split(/\s+/).filter(Boolean);
  const nicheTokens = context.source.niche.trim().split(/\s+/).filter(Boolean);
  const detectedEntities = Array.from(new Set([...nicheTokens, ...titleTokens]));

  const productUnderstanding: ProductUnderstanding = {
    ocrTexts: [],
    detectedEntities,
    dominantColors: [],
    visualStyle: context.source.niche.trim() || "standard",
    productCategory: context.source.niche.trim() || "general",
  };

  return evolveContext(context, { productUnderstanding });
}

export const b1ProductUnderstandingStage: SeoPipelineStage = {
  name: "b1",
  execute: executeB1ProductUnderstanding,
};
