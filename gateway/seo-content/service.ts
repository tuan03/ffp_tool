import {
  fromAutoSeoProduct,
  runAutoSeoPipeline,
  runMockSeoContent,
} from "../../src/modules/seo-content";
import { runSeoContent as runServerSeoContent } from "../../src/modules/seo-content/server";
import { getCustomGptRuntime } from "../custom-gpt-seo/runtime";
import { SEO_WORKER_SCHEMA_VERSION } from "../custom-gpt-seo/input-contract";
import { requireAutoSeoStoreProfile } from "./store-profile";

import type { GptSeoEnqueue } from "../../src/modules/custom-gpt-seo";
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
  const storeProfile = options?.storeProfile ?? requireAutoSeoStoreProfile(input);
  if (storeProfile.storeId !== input.storeId) throw new Error("Store profile does not match execution store");

  if (!runner) {
    const queue = getCustomGptRuntime().queue;
    const settings = options?.providerSettings ?? (await queue.settings(input.storeId));
    if (settings.provider === "custom_gpt" || settings.provider === "codex_mcp") {
      const productsBySourceIdentity = new Map<string, string>();
      const enqueues: readonly GptSeoEnqueue[] = input.products.map((product) => {
        const productId = product.id.replace(/^gid:\/\/shopify\/Product\//, "");
        productsBySourceIdentity.set(productId, product.id);
        const seoInput = fromAutoSeoProduct(product, storeProfile.niche, storeProfile);
        return {
          input: seoInput,
          execution: {
            storeId: input.storeId,
            productId,
            source: "auto_seo",
            sourceIdentity: productId,
            sourceRevision: product.updatedAt,
            shopifyUpdatedAt: product.updatedAt,
            providerId: settings.provider,
            pipelineVersion: SEO_WORKER_SCHEMA_VERSION,
            originalSnapshot: product,
          },
          settings,
        };
      });
      const batch = await queue.enqueueBatch(enqueues);
      const skippedProductIds = batch.activeDuplicateSourceIdentities
        .map(sourceIdentity => productsBySourceIdentity.get(sourceIdentity))
        .filter((productId): productId is string => productId !== undefined);
      return {
        success: true,
        provider: settings.provider,
        processedCount: batch.jobs.length,
        message: `Queued ${batch.jobs.length}/${input.products.length} products for ${settings.provider === "codex_mcp" ? "Codex MCP" : "Custom GPT"}`,
        seoOutputs: [],
        dispatchStatus: "queued",
        jobIds: batch.jobs.map(job => job.id),
        skippedProductIds,
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
