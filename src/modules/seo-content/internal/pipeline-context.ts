import type {
  SeoContentImageOutput,
  SeoContentInput,
  SeoContentOutput,
} from "../types";
import type { ContentResult, SeoPipelineContext } from "./domain-types";

/**
 * Creates the initial immutable SeoPipelineContext from the raw input.
 */
export function createInitialContext(input: SeoContentInput, effectiveNiche?: string): SeoPipelineContext {
  const frozenSource: SeoContentInput = Object.freeze({
    images: Object.freeze(
      input.images.map((img) => Object.freeze({ ...img })),
    ),
    niche: input.niche,
    storeProfile: Object.freeze({ ...input.storeProfile }),
  });

  return Object.freeze({
    source: frozenSource,
    effectiveNiche: effectiveNiche ?? input.niche,
    storeProfile: input.storeProfile,
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
  const trimmedTitle = content?.productTitle.trim() ?? "";

  return source.images.map((img, index) => {
    const stableId = img.id.trim().replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
    const baseName = stableId || `product-image-${index + 1}`;
    const filename = `${baseName}.webp`;

    return {
      sourceUrl: img.url,
      alt:
        trimmedTitle ? `${trimmedTitle} - View ${index + 1}` : `Product image ${index + 1}`,
      webp: {
        filename,
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
    productTitle: content?.productTitle ?? context.productUnderstanding?.physicalProductIdentity ?? "Product",
    productDescription: content?.productDescription ?? "",
    productSeoTitle: content?.productSeoTitle ?? context.productUnderstanding?.physicalProductIdentity?.slice(0, 70) ?? "Product",
    productSeoDescription: content?.productSeoDescription ?? "",
    images,
    ...(content?.productHandle ? { productHandle: content.productHandle } : {}),
    aeo_quick_summary: content?.aeo_quick_summary,
    aeo_faq: content?.aeo_faq,
    aeo_json_ld: content?.aeo_json_ld,
  };
}
