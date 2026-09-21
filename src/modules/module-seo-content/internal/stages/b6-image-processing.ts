import { createFallbackProcessedImages, evolveContext } from "../pipeline-context";

import type {
  ImageProcessingResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";

export async function executeB6ImageProcessing(
  context: SeoPipelineContext,
): Promise<SeoPipelineContext> {
  const processedImages = createFallbackProcessedImages(
    context.source,
    context.contentResult,
  );

  const imageResult: ImageProcessingResult = {
    processedImages,
  };

  return evolveContext(context, { imageResult });
}

export const b6ImageProcessingStage: SeoPipelineStage = {
  name: "b6",
  execute: executeB6ImageProcessing,
};
