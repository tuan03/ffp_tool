import { fromAutoSeoProduct, runAutoSeoPipeline, runMockSeoContent } from "../../src/modules/seo-content";
import { getCustomGptRuntime } from "../custom-gpt-seo/runtime";
import type { GatewaySeoContentOptions, SeoContentInput, SeoContentResult } from "./types";

/**
 * Executes the real SEO Content Pipeline (B1 -> B6) for products handed off by Auto SEO.
 */
export async function runSeoContent(
  input: SeoContentInput,
  options?: GatewaySeoContentOptions,
): Promise<SeoContentResult> {
  const isTestOrMock =
    process.env.NODE_ENV === "test" ||
    process.env.APP_ENV === "mock" ||
    process.env.VITE_APP_ENV === "mock";
  const defaultRunner = isTestOrMock ? runMockSeoContent : undefined;
  const runner = options?.runner ?? defaultRunner;

  if (!runner) {
    const queue = getCustomGptRuntime().queue;
    const settings = options?.providerSettings ?? queue.settings(input.storeId);
    if (settings.provider === "custom_gpt" || settings.provider === "codex_mcp") {
      for (const product of input.products) {
        const seoInput = fromAutoSeoProduct(product);
        queue.enqueue({ storeId: input.storeId, source: "auto_seo", sourceIdentity: String(seoInput.productId || seoInput.handle), input: { ...seoInput, siteDomain: input.shopDomain }, original: product, settings });
      }
      return { success: true, provider: settings.provider, processedCount: 0, message: `Queued ${input.products.length} products for ${settings.provider === "codex_mcp" ? "Codex MCP" : "Custom GPT"}`, seoOutputs: [] };
    }
  }

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
