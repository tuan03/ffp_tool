import { evolveContext } from "../pipeline-context";

import type {
  ContentResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export async function executeB5ContentGeneration(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const contentResult: ContentResult = {
    productTitle: context.source.title,
    productDescription: context.source.description,
    productSeoTitle: context.source.title.slice(0, 70),
    productSeoDescription: context.source.description.slice(0, 160),
    productHandle: context.source.handle,
  };

  return evolveContext(context, { contentResult });
}

export const b5ContentGenerationStage: SeoPipelineStage = {
  name: "b5",
  execute: executeB5ContentGeneration,
};
