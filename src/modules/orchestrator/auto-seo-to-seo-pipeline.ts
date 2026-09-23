import { runAutoSeoPipeline } from "../seo-content";
import type {
  AutoSeoAdapterOptions,
  AutoSeoBatchResult,
  AutoSeoItemResult,
  AutoSeoSourceProduct,
  SeoContentInput,
  SeoContentOutput,
} from "../seo-content";

export type { AutoSeoSourceProduct };

export interface HandoverAutoSeoToSeoInput {
  readonly workflowId?: string;
  readonly storeId?: string;
  readonly products: readonly AutoSeoSourceProduct[];
  readonly defaultNiche?: string;
  readonly concurrency?: number;
}

export interface HandoverAutoSeoToSeoDependencies {
  readonly seoRunner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
}

export interface HandoverAutoSeoToSeoResult {
  readonly workflowId: string;
  readonly storeId?: string;
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly AutoSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

/**
 * Coordinates data processing from Auto SEO candidate products through SEO Content Pipeline (B1 -> B6).
 */
export async function handoverAutoSeoToSeo(
  input: HandoverAutoSeoToSeoInput,
  dependencies: HandoverAutoSeoToSeoDependencies = {},
): Promise<HandoverAutoSeoToSeoResult> {
  const workflowId = input.workflowId || `auto-seo-handover-${Date.now()}`;
  const storeId = input.storeId;
  const rawProducts = input.products ?? [];

  if (rawProducts.length === 0) {
    return {
      workflowId,
      storeId,
      total: 0,
      successful: 0,
      failed: 0,
      items: [],
      seoOutputs: [],
    };
  }

  const products = rawProducts.map((p) => ({
    ...p,
    storeId: (p as { storeId?: string }).storeId || storeId,
  }));

  const seoOptions: AutoSeoAdapterOptions = {
    runner: dependencies.seoRunner,
    defaultNiche: input.defaultNiche || "Shopify Product",
    concurrency: input.concurrency || 3,
  };

  const seoBatchResult: AutoSeoBatchResult = await runAutoSeoPipeline(
    products,
    seoOptions,
  );

  return {
    workflowId,
    storeId,
    total: seoBatchResult.total,
    successful: seoBatchResult.successful,
    failed: seoBatchResult.failed,
    items: seoBatchResult.items,
    seoOutputs: seoBatchResult.seoOutputs,
  };
}
