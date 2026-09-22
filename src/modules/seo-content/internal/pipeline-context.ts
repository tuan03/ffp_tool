import type {
  SeoContentImageOutput,
  SeoContentInput,
  SeoContentOutput,
} from "../types";
import type { ContentResult, SeoPipelineContext } from "./domain-types";

/**
 * Creates the initial immutable SeoPipelineContext from the raw input.
 */
export function createInitialContext(input: SeoContentInput): SeoPipelineContext {
  const frozenSource: SeoContentInput = Object.freeze({
    ...input,
    images: Object.freeze(
      input.images.map((img) =>
        Object.freeze({
          ...img,
        }),
      ),
    ),
  });

  return Object.freeze({
    source: frozenSource,
  });
}

/**
 * Returns a new immutable context with the given updates applied,
 * strictly preserving the original source data reference.
 */
export function evolveContext(
  context: SeoPipelineContext,
  updates: Partial<Omit<SeoPipelineContext, "source">>,
): SeoPipelineContext {
  return Object.freeze({
    ...context,
    ...updates,
    source: context.source,
  });
}

/**
 * Creates fallback processed image outputs from source images and content result.
 * Ensures image data is never lost if stage B6 fails recoverably or is omitted.
 */
export function createFallbackProcessedImages(
  source: SeoContentInput,
  content?: ContentResult,
): readonly SeoContentImageOutput[] {
  const trimmedSourceTitle = source.title?.trim() || "";
  const effectiveTitle = trimmedSourceTitle ? (content?.productTitle ?? source.title) : "";
  const effectiveHandle = content?.productHandle ?? source.handle;
  const trimmedTitle = effectiveTitle.trim();
  const trimmedHandle = effectiveHandle.trim();

  return source.images.map((img, index) => {
    const baseName = trimmedHandle
      ? `${trimmedHandle}-${index + 1}`
      : `product-image-${index + 1}`;
    const filename = `${baseName}.webp`;

    return {
      sourceUrl: img.url,
      alt:
        img.alt?.trim() ||
        (trimmedTitle ? `${trimmedTitle} - View ${index + 1}` : `Product image ${index + 1}`),
      webp: {
        filename,
        localFilePath: img.localFilePath,
        url: img.url,
      },
    };
  });
}

/**
 * Transforms the final accumulated context into the public SeoContentOutput contract.
 */
export function finalizePipelineOutput(context: SeoPipelineContext): SeoContentOutput {
  const content = context.contentResult;
  const images =
    context.imageResult?.processedImages ??
    createFallbackProcessedImages(context.source, content);

  return {
    productTitle: content?.productTitle ?? context.source.title,
    productDescription: content?.productDescription ?? context.source.description,
    productSeoTitle: content?.productSeoTitle ?? context.source.title.slice(0, 70),
    productSeoDescription:
      content?.productSeoDescription ?? context.source.description.slice(0, 160),
    images,
    productHandle: content?.productHandle ?? context.source.handle,
  };
}
