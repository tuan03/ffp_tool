import { amazonCrawlerMockOutput } from "./data";

import type {
  AmazonCrawlerCacheClearResult,
  AmazonCrawlerHydratedJob,
  AmazonCrawlerJobLoader,
  AmazonCrawlerJobSummary,
  AmazonCrawlerOutput,
  AmazonCrawlerRunOptions,
  ShopifyAsinFilter,
} from "../types";
import { SHOPIFY_ASIN_FILTER_LIMIT } from "../types";

const loadMockAsinActivity: NonNullable<ShopifyAsinFilter["loadActivity"]> = async ({ asins, signal }) => {
  signal?.throwIfAborted();
  return [...new Set(asins)].map((asin) => ({ asin, parentAsin: asin, status: "available" as const }));
};

const filterMockAsins: ShopifyAsinFilter = async ({ storeId, asins, signal, onProgress }) => {
  signal?.throwIfAborted();
  if (!storeId.trim() || asins.length === 0 || asins.length > SHOPIFY_ASIN_FILTER_LIMIT || asins.some((asin) => !/^[A-Z0-9]{10}$/.test(asin))) {
    throw new Error("Chọn store và nhập danh sách ASIN hợp lệ.");
  }
  const requestedAsins = [...new Set(asins)];
  const matches = requestedAsins.filter((asin) => asin === "B0MOCK1001").map((asin) => ({
    asin, productId: "gid://shopify/Product/101", title: "Mock existing Shopify product", status: "ACTIVE",
    adminUrl: `https://${storeId}.myshopify.com/admin/products/101`,
  }));
  onProgress?.({ scannedProducts: 1, pagesRead: 1 });
  signal?.throwIfAborted();
  const missingAsins = requestedAsins.filter((asin) => !matches.some((match) => match.asin === asin));
  return { storeId, matches, missingAsins, scannedProducts: 1, activity: await loadMockAsinActivity({ storeId, asins: missingAsins, signal }) };
};

export const filterMockShopifyAsins: ShopifyAsinFilter = Object.assign(filterMockAsins, { loadActivity: loadMockAsinActivity });

export async function clearMockAmazonCrawlerCache(): Promise<AmazonCrawlerCacheClearResult> {
  return { removedFiles: 0, removedBytes: 0 };
}

export async function runMockAmazonCrawler({
  input,
  onProgress,
  signal,
}: AmazonCrawlerRunOptions): Promise<AmazonCrawlerOutput> {
  if (signal?.aborted) throw new DOMException("The crawler job was cancelled.", "AbortError");
  if (input.sequentialBatch) {
    const output = structuredClone(amazonCrawlerMockOutput);
    output.jobId = "mock-sequential-batch";
    output.settings = { ...input };
    const skips = new Map((input.batchSkippedInputs ?? []).map(entry => [entry.asin, entry.reason]));
    const sources = [...new Set(input.urls)];
    const template = output.products[0];
    output.products = template ? sources.filter(asin => !skips.has(asin)).map(asin => ({
      ...structuredClone(template), id: `mock-${asin}`, asin, parentAsin: asin,
      sourceKey: `amazon:${asin}:mock:default`, canonicalUrl: `https://www.amazon.com/dp/${asin}`,
      sourceVariants: template.sourceVariants.map(variant => ({ ...variant, asin })),
    })) : [];
    output.seoQueueHandoff = { totalProducts: output.products.length, handedOver: output.products.length, pending: 0, notHandedOver: 0 };
    output.completedAsins = sources;
    output.statistics = { ...output.statistics, requestedInputs: sources.length, acceptedInputs: sources.length,
      products: output.products.length,
      sourceVariants: output.products.reduce((total, product) => total + product.sourceVariants.length, 0),
      finalVariants: output.products.reduce((total, product) => total + product.variants.length, 0) };
    onProgress?.({ phase: "export", completed: sources.length, total: sources.length, message: "Đã xử lý lô mẫu.",
      batch: { skippedShopify: [...skips.values()].filter(reason => reason === "existing_shopify").length,
        skippedPipeline: [...skips.values()].filter(reason => reason === "existing_pipeline").length,
        attention: [...skips.values()].filter(reason => reason === "attention").length, covered: 0 },
      items: sources.map(asin => ({ asin, source: asin, phase: "export", status: "completed",
        message: skips.has(asin) ? "Đã bỏ qua ASIN trong lô mẫu." : "Đã cào trong lô mẫu.",
        skipReason: skips.get(asin), variantCompleted: 0, variantTotal: 0 })),
    });
    return output;
  }
  const source = input.urls[0] ?? "B0MOCK0001";
  onProgress?.({
    phase: "product",
    completed: 1,
    total: 1,
    message: "Mock crawl completed.",
    source,
    items: [{
      source,
      asin: "B0MOCK0001",
      phase: "product",
      status: "completed",
      message: "Đã cào variant 3/3: Size: Queen (B0MOCK0003)",
      variantCompleted: 3,
      variantTotal: 3,
      currentAsin: "B0MOCK0003",
      currentOptions: { Size: "Queen" },
      activeVariants: [],
    }],
  });
  const mockSettings = {
    profileSlug: input.profileSlug,
    imageProfileSlug: input.imageProfileSlug,
    applyJeminisePreset: input.applyJeminisePreset,
    productThreads: input.productThreads,
    variantThreads: input.variantThreads,
    urllibThreads: input.urllibThreads,
    browserProfiles: input.browserProfiles,
    browserTabs: input.browserTabs,
    headless: input.headless,
    amazonZip: input.amazonZip,
    captchaTimeoutSeconds: input.captchaTimeoutSeconds,
    dnsTimeoutSeconds: input.dnsTimeoutSeconds ?? 10,
    connectTimeoutSeconds: input.connectTimeoutSeconds ?? 15,
    httpResponseTimeoutSeconds: input.httpResponseTimeoutSeconds ?? 90,
    navigationTimeoutSeconds: input.navigationTimeoutSeconds ?? 60,
    selectorTimeoutSeconds: input.selectorTimeoutSeconds ?? 15,
    customizationTimeoutSeconds: input.customizationTimeoutSeconds ?? 120,
    childTimeoutSeconds: input.childTimeoutSeconds ?? 300,
    asinTimeoutSeconds: input.asinTimeoutSeconds ?? 1800,
    jobTimeoutSeconds: input.jobTimeoutSeconds ?? 21600,
    maxMatrixVariants: input.maxMatrixVariants,
  };
  const output = structuredClone(amazonCrawlerMockOutput);
  output.settings = mockSettings;
  return output;
}

export function createMockAmazonCrawlerJobLoader(): AmazonCrawlerJobLoader {
  return {
    async loadJob(jobId?: string): Promise<AmazonCrawlerHydratedJob | null> {
      // Generated batches live in the browser session, not the static fixture.
      // Returning that unrelated fixture would overwrite their exact skip counts.
      if (jobId === "mock-sequential-batch") return null;
      return {
        jobId: jobId || "mock-job-001",
        status: "completed",
        products: [...amazonCrawlerMockOutput.products],
        output: structuredClone(amazonCrawlerMockOutput),
        settings: { ...amazonCrawlerMockOutput.settings },
      };
    },
    async listRecentJobs(): Promise<AmazonCrawlerJobSummary[]> {
      return [
        {
          id: "mock-job-001",
          status: "completed",
          executionState: "active",
          createdAt: new Date().toISOString(),
          acceptedInputs: 1,
        },
      ];
    },
  };
}
