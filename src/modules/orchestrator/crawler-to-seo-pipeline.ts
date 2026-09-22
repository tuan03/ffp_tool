import { runCustomizationNormalizer } from "../customization-normalizer";
import type {
  CrawlProduct,
  CustomizationNormalizerInput,
  CustomizationNormalizerOutput,
} from "../customization-normalizer";
import { runCustomizationSeoPipeline } from "../seo-content";
import type {
  CustomizationSeoBatchResult,
  CustomizationSeoItemResult,
  CustomizationSeoOptions,
  SeoContentInput,
  SeoContentOutput,
} from "../seo-content";

export interface HandoverCrawlerToSeoInput {
  readonly jobId?: string;
  readonly products: readonly CrawlProduct[];
  readonly defaultNiche?: string;
  readonly concurrency?: number;
}

export interface HandoverCrawlerToSeoDependencies {
  readonly normalizer?: (
    input: CustomizationNormalizerInput,
  ) => Promise<CustomizationNormalizerOutput>;
  readonly seoRunner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
}

export interface HandoverCrawlerToSeoResult {
  readonly jobId: string;
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly CustomizationSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

/**
 * Coordinates end-to-end data processing from Amazon Crawler through Customization Normalizer to SEO Content.
 */
export async function handoverCrawlerToSeo(
  input: HandoverCrawlerToSeoInput,
  dependencies: HandoverCrawlerToSeoDependencies = {},
): Promise<HandoverCrawlerToSeoResult> {
  const jobId = input.jobId || `handover-${Date.now()}`;
  const products = input.products ?? [];

  if (products.length === 0) {
    return {
      jobId,
      total: 0,
      successful: 0,
      failed: 0,
      items: [],
      seoOutputs: [],
    };
  }

  // 1. Normalize customization data
  const normalizer = dependencies.normalizer || runCustomizationNormalizer;
  const normalizerInput: CustomizationNormalizerInput = {
    jobId,
    status: "completed",
    products,
  };
  const normalizedOutput = await normalizer(normalizerInput);

  // 2. Execute SEO pipeline over normalized products
  const seoOptions: CustomizationSeoOptions = {
    runner: dependencies.seoRunner,
    defaultNiche: input.defaultNiche || "custom product",
    concurrency: input.concurrency || 3,
  };

  const seoBatchResult: CustomizationSeoBatchResult = await runCustomizationSeoPipeline(
    normalizedOutput,
    seoOptions,
  );

  return {
    jobId,
    total: seoBatchResult.total,
    successful: seoBatchResult.successful,
    failed: seoBatchResult.failed,
    items: seoBatchResult.items,
    seoOutputs: seoBatchResult.seoOutputs,
  };
}
