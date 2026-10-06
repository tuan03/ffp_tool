import {
  fromAutoSeoProduct,
  resolveStoreProfile,
  runAutoSeoPipeline,
  runMockSeoContent,
} from "../../src/modules/seo-content";
import { runSeoContent as runServerSeoContent } from "../../src/modules/seo-content/server";
import { getCustomGptRuntime } from "../custom-gpt-seo/runtime";
import type { GatewaySeoContentOptions, GatewaySeoContentRequest, SeoContentResult } from "./types";

/**
 * Executes the real SEO Content Pipeline (B1 -> B6) for products handed off by Auto SEO.
 */
export async function runSeoContent(
  input: GatewaySeoContentRequest,
  options?: GatewaySeoContentOptions,
): Promise<SeoContentResult> {
  const isTestOrMock =
    process.env.NODE_ENV === "test" ||
    process.env.APP_ENV === "mock" ||
    process.env.VITE_APP_ENV === "mock";
  const defaultRunner = isTestOrMock ? runMockSeoContent : undefined;
  const runner = options?.runner ?? defaultRunner;
  const storeProfile = resolveStoreProfile({ storeId: input.storeId, siteDomain: input.shopDomain });

  if (!storeProfile) {
    throw new Error("STORE_PROFILE_REQUIRED");
  }

  if (!runner) {
    const queue = getCustomGptRuntime().queue;
    const settings = options?.providerSettings ?? (await queue.settings(input.storeId));
    if (settings.provider === "custom_gpt" || settings.provider === "codex_mcp") {
      const jobIds: string[] = [];
      for (const product of input.products) {
        const productId = product.id.replace(/^gid:\/\/shopify\/Product\//, "");
        const seoInput = fromAutoSeoProduct(product, storeProfile.niche, storeProfile);
        const job = await queue.enqueue({
          input: seoInput,
          execution: {
            storeId: input.storeId,
            productId,
            source: "auto_seo",
            sourceIdentity: productId,
            sourceRevision: product.updatedAt,
            shopifyUpdatedAt: product.updatedAt,
            providerId: settings.provider,
            pipelineVersion: "seo-content-input-v2",
            originalSnapshot: product,
          },
          settings,
        });
        jobIds.push(job.id);
      }
      return {
        success: true,
        provider: settings.provider,
        processedCount: 0,
        message: `Queued ${input.products.length} products for ${settings.provider === "codex_mcp" ? "Codex MCP" : "Custom GPT"}`,
        seoOutputs: [],
        dispatchStatus: "queued",
        jobIds,
      };
    }
  }

  const result = await runAutoSeoPipeline(input.products, {
    runner: runner ?? runServerSeoContent,
    storeProfile,
  });

  const isSuccess = result.successful > 0 || result.total === 0;
  const firstFailure = result.items.find((item) => !item.success)?.error;
  const failureDetail = !isSuccess && firstFailure ? `: ${firstFailure}` : "";

  return {
    provider: "gemini",
    success: isSuccess,
    processedCount: result.successful,
    message: `Processed ${result.successful}/${result.total} products with SEO Content Pipeline B1-B6${failureDetail}`,
    seoOutputs: result.seoOutputs,
    dispatchStatus: isSuccess ? "review_ready" : undefined,
    jobIds: [],
  };
}
