import { loadServerEnvironment } from "../../config/server-environment";

import { createSeoPipeline } from "./internal/pipeline";
import { getDefaultSiteNicheResolver } from "./internal/site-niche/site-niche-runtime";
import type { SeoContentInput, SeoContentOutput } from "./types";

loadServerEnvironment();

const defaultPipeline = createSeoPipeline({ siteNicheResolver: getDefaultSiteNicheResolver() });

/**
 * Executes the SEO + Content pipeline for a single product.
 *
 * Runs sequential multi-stage processing:
 * B1 (Understanding) -> B2 (Context) -> B3 (Search) -> B4 (Conflict) -> B5 (Content) -> B6 (Images).
 */
export async function runSeoContent(input: SeoContentInput): Promise<SeoContentOutput> {
  return defaultPipeline.execute(input);
}
