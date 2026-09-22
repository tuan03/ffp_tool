import { createSeoPipeline } from "./internal/pipeline";
import type { SeoContentInput, SeoContentOutput } from "./types";

let defaultPipeline: ReturnType<typeof createSeoPipeline> | undefined;

function getDefaultPipeline(): ReturnType<typeof createSeoPipeline> {
  if (!defaultPipeline) {
    defaultPipeline = createSeoPipeline();
  }
  return defaultPipeline;
}

/**
 * Executes the SEO + Content pipeline for a single product.
 *
 * Runs sequential multi-stage processing:
 * B1 (Understanding) -> B2 (Context) -> B3 (Search) -> B4 (Conflict) -> B5 (Content) -> B6 (Images).
 */
export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return getDefaultPipeline().execute(input);
}
