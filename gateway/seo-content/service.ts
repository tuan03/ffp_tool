import { runAutoSeoPipeline, runMockSeoContent } from "../../src/modules/seo-content";
import type { GatewaySeoContentOptions, SeoContentInput, SeoContentResult } from "./types";

/**
 * Executes the real SEO Content Pipeline (B1 -> B6) for products handed off by Auto SEO.
 */
export async function runSeoContent(
  input: SeoContentInput,
  options?: GatewaySeoContentOptions,
): Promise<SeoContentResult> {
  const isTestOrMock = process.env.NODE_ENV === "test" || process.env.APP_ENV === "mock";
  const defaultRunner = isTestOrMock ? runMockSeoContent : undefined;
  const runner = options?.runner ?? defaultRunner;

  const result = await runAutoSeoPipeline(input.products, {
    ...(runner ? { runner } : {}),
    siteDomain: input.shopDomain,
  });

  const isSuccess = result.successful > 0 || result.total === 0;

  return {
    success: isSuccess,
    processedCount: result.successful,
    message: `Processed ${result.successful}/${result.total} products with SEO Content Pipeline B1-B6`,
    seoOutputs: result.seoOutputs,
  };
}
