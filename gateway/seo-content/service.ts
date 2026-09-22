import type { SeoContentInput, SeoContentResult } from "./types";

/**
 * Temporary typed placeholder function for SEO Content generation.
 * Real SEO generation is not yet implemented.
 */
export async function runSeoContent(
  input: SeoContentInput,
): Promise<SeoContentResult> {
  return {
    success: true,
    processedCount: input.products.length,
    message: "SEO content generation placeholder executed successfully",
  };
}
