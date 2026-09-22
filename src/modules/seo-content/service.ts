import { createSeoPipeline } from "./internal/pipeline";
import type { SeoContentInput, SeoContentOutput } from "./types";

const defaultPipeline = createSeoPipeline();

/**
 * Executes the SEO + Content pipeline for a single product.
 *
 * Runs sequential multi-stage processing:
 * B1 (Understanding) -> B2 (Context) -> B3 (Search) -> B4 (Conflict) -> B5 (Content) -> B6 (Images).
 */
export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return defaultPipeline.execute(input);
}
