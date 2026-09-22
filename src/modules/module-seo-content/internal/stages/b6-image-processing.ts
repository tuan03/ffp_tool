import { evolveContext } from "../pipeline-context";
import { wrapStageError } from "../pipeline-errors";
import type {
  ImageProcessingResult,
  SeoPipelineContext,
  SeoPipelineStage,
} from "../domain-types";
import type {
  ImageProcessingInput,
  ImageProcessingMetadata,
} from "../image-processing/image-processing-types";
import {
  DefaultImageProcessor,
  type ImageProcessor,
  type ImageProcessorOptions,
} from "../image-processing/image-processor";

export interface B6Dependencies {
  readonly imageProcessor?: ImageProcessor;
  readonly processorOptions?: ImageProcessorOptions;
}

/**
 * Maps the accumulated pipeline context into the focused ImageProcessingInput.
 */
export function buildImageProcessingInput(context: SeoPipelineContext): ImageProcessingInput {
  return {
    images: context.source.images,
    sourceTitle: context.source.title,
    productTitle: context.contentResult?.productTitle ?? context.source.title ?? "",
    productHandle: context.contentResult?.productHandle ?? context.source.handle ?? "",
    primaryKeyword: context.contentGenerationMetadata?.primaryKeyword,
    secondaryKeywords: context.contentGenerationMetadata?.secondaryKeywords,
    productCategory: context.productUnderstanding?.productCategory,
    entities: context.productUnderstanding?.detectedEntities ?? [],
    dominantColors: context.productUnderstanding?.dominantColors,
    visualStyle: context.productUnderstanding?.visualStyle,
  };
}

/**
 * Stage B6: Image Processing & Alt Text Optimization
 *
 * Coordinates:
 * - Deterministic SEO WebP filename generation (`${handle}-${index + 1}.webp`)
 * - Context-aware, grounded, non-stuffed Alt text generation (<=125 chars)
 * - Safe WebP conversion and artifact handling with zero-network testability
 * - Error isolation: corrupt images in lenient mode do not fail the entire SEO result
 */
export async function executeB6ImageProcessing(
  context: SeoPipelineContext,
  dependencies?: B6Dependencies,
): Promise<SeoPipelineContext> {
  try {
    const processor =
      dependencies?.imageProcessor ??
      new DefaultImageProcessor(dependencies?.processorOptions);

    const input = buildImageProcessingInput(context);
    const { processedImages, metadata } = await processor.process(input);

    const imageResult: ImageProcessingResult = {
      processedImages,
    };

    return evolveContext(context, {
      imageResult,
      imageProcessingMetadata: metadata,
    });
  } catch (error) {
    throw wrapStageError("b6", error);
  }
}

export const b6ImageProcessingStage: SeoPipelineStage = {
  name: "b6",
  execute: executeB6ImageProcessing,
};
