import type { SeoContentImageOutput, SeoContentInput, SeoContentOutput } from "./types";

/**
 * Baseline implementation of SEO + Content pipeline.
 *
 * Current Phase 0: Baseline transformation preserving title, description, handle,
 * and initializing default SEO titles, descriptions, and WebP asset mappings.
 *
 * Upcoming Pipeline Phases:
 * TODO (Phase B1): Product Understanding — extract entities, clean HTML, OCR/vision analysis.
 * TODO (Phase B2): Audience & Buying Context — target personas, gifting angles, buying intent.
 * TODO (Phase B3): Search Suggestions — seed keyword generation and Google autocomplete expansion.
 * TODO (Phase B4): SEO Conflict Control — cannibalization detection and keyword scoring.
 * TODO (Phase B5): Search Intent & Content Generation — SEO title, 5-block HTML description, SEO meta description, handle.
 * TODO (Phase B6): Image Processing — per-image descriptive alt text, WebP format conversion.
 */
export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  const trimmedTitle = input.title.trim();
  const trimmedHandle = input.handle.trim();

  const images: readonly SeoContentImageOutput[] = input.images.map((img, index) => {
    const baseName = trimmedHandle ? `${trimmedHandle}-${index + 1}` : `product-image-${index + 1}`;
    const filename = `${baseName}.webp`;

    return {
      sourceUrl: img.url,
      alt: img.alt?.trim() || (trimmedTitle ? `${trimmedTitle} - View ${index + 1}` : `Product image ${index + 1}`),
      webp: {
        filename,
        localFilePath: img.localFilePath,
        url: img.url,
      },
    };
  });

  return {
    productTitle: input.title,
    productDescription: input.description,
    productSeoTitle: input.title.slice(0, 70),
    productSeoDescription: input.description.slice(0, 160),
    images,
    productHandle: input.handle,
  };
}
