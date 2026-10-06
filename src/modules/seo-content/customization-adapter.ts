import type { CrawlProduct, CustomizationNormalizerOutput } from "../customization-normalizer";
import { runDefaultSeoContent } from "./default-runner";
import { createSeoContentQueue } from "./queue";
import type { SeoQueueProgressStats } from "./queue";
import type {
  SeoContentAltOnlyOutput,
  SeoContentInput,
  SeoContentOutput,
  SeoStoreProfile,
} from "./types";

export interface CustomizationSeoOptions {
  readonly runner?: (input: SeoContentInput) => Promise<SeoContentOutput>;
  readonly concurrency?: number;
  readonly defaultNiche?: string;
  readonly storeProfile: SeoStoreProfile;
  readonly onItemCompleted?: (itemResult: CustomizationSeoItemResult) => void;
  readonly onItemFailed?: (itemResult: CustomizationSeoItemResult) => void;
  readonly onProgress?: (stats: SeoQueueProgressStats) => void;
}

export interface CustomizationSeoItemResult {
  readonly productId?: string;
  readonly asin?: string;
  readonly sourceProduct: CrawlProduct;
  readonly seoInput: SeoContentInput;
  readonly seoOutput?: SeoContentOutput;
  readonly success: boolean;
  readonly error?: string;
}

export interface CustomizationSeoBatchResult {
  readonly total: number;
  readonly successful: number;
  readonly failed: number;
  readonly items: readonly CustomizationSeoItemResult[];
  readonly seoOutputs: readonly SeoContentOutput[];
}

function stableImageId(url: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < url.length; index += 1) {
    hash ^= url.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `image-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Projects a Customization product onto the V2 semantic contract. Text, variants,
 * ASINs, handles and image alt text deliberately remain outside SEO generation.
 */
export function fromCustomizationProduct(
  product: CrawlProduct,
  niche: string,
  storeProfile: SeoStoreProfile,
): SeoContentInput {
  const seenUrls = new Set<string>();
  const images = (product.media ?? []).flatMap((media) => {
    const url = typeof media.url === "string" ? media.url.trim() : "";
    if (String(media.kind ?? "image").toLowerCase() === "video" || !url || seenUrls.has(url)) {
      return [];
    }
    seenUrls.add(url);
    return [{ id: String(media.id ?? stableImageId(url)), url }];
  });

  return {
    images,
    niche: niche.trim() || storeProfile.niche,
    storeProfile,
  };
}

export interface ApplySeoContentOptions {
  readonly ensureUniqueHandle?: boolean;
  readonly existingShopifyHandle?: string;
}

/** Applies generated copy while preserving operational product identity. */
export function applySeoContentToCustomizationProduct(
  product: CrawlProduct,
  seoOutput: SeoContentOutput | SeoContentAltOnlyOutput,
  _options?: ApplySeoContentOptions,
): CrawlProduct {
  const altBySourceUrl = new Map(
    seoOutput.images.map((image) => [image.sourceUrl, image.alt] as const),
  );

  return {
    ...product,
    title: seoOutput.productTitle,
    descriptionHtml: seoOutput.productDescription,
    handle: product.handle,
    seo: {
      title: seoOutput.productSeoTitle,
      description: seoOutput.productSeoDescription,
      ...(seoOutput.aeo_quick_summary !== undefined ? { aeo_quick_summary: seoOutput.aeo_quick_summary } : {}),
      ...(seoOutput.aeo_faq !== undefined ? { aeo_faq: seoOutput.aeo_faq } : {}),
      ...(seoOutput.aeo_json_ld !== undefined ? { aeo_json_ld: seoOutput.aeo_json_ld } : {}),
    },
    media: product.media?.map((media) => {
      if (String(media.kind ?? "image").toLowerCase() === "video") return { ...media };
      const alt = altBySourceUrl.get(media.url.trim());
      return alt ? { ...media, alt } : { ...media };
    }),
  };
}

export function fromCustomizationBatch(
  batch: CustomizationNormalizerOutput | readonly CrawlProduct[],
  niche: string,
  storeProfile: SeoStoreProfile,
): readonly SeoContentInput[] {
  const products = Array.isArray(batch)
    ? batch
    : (batch as CustomizationNormalizerOutput).products || [];
  return products.map((product) => fromCustomizationProduct(product, niche, storeProfile));
}

export async function runCustomizationSeoPipeline(
  input: CustomizationNormalizerOutput | readonly CrawlProduct[],
  options: CustomizationSeoOptions,
): Promise<CustomizationSeoBatchResult> {
  const products = Array.isArray(input)
    ? input
    : (input as CustomizationNormalizerOutput).products || [];

  if (products.length === 0) {
    return { total: 0, successful: 0, failed: 0, items: [], seoOutputs: [] };
  }

  const runner = options.runner ?? runDefaultSeoContent;
  const requestedConcurrency = typeof options.concurrency === "number" && Number.isFinite(options.concurrency)
    ? options.concurrency
    : 1;
  const concurrency = Math.max(1, Math.min(Math.floor(requestedConcurrency), 3));

  interface IndexedItem {
    readonly index: number;
    readonly result: CustomizationSeoItemResult;
    readonly seoOutput?: SeoContentOutput;
  }
  const collectedItems: IndexedItem[] = [];

  const queue = createSeoContentQueue<CrawlProduct>({
    concurrency,
    runner,
    onItemCompleted: (item, seoOutput) => {
      const product = item.source as CrawlProduct;
      const result: CustomizationSeoItemResult = {
        productId: product.id,
        asin: product.asin || product.parentAsin,
        sourceProduct: product,
        seoInput: item.seoInput,
        seoOutput,
        success: true,
      };
      collectedItems.push({ index: item.index, result, seoOutput });
      options.onItemCompleted?.(result);
    },
    onItemFailed: (item, error) => {
      const product = item.source as CrawlProduct;
      const result: CustomizationSeoItemResult = {
        productId: product.id,
        asin: product.asin || product.parentAsin,
        sourceProduct: product,
        seoInput: item.seoInput,
        success: false,
        error,
      };
      collectedItems.push({ index: item.index, result });
      options.onItemCompleted?.(result);
      options.onItemFailed?.(result);
    },
    onProgress: (stats) => options.onProgress?.(stats),
  });

  queue.enqueue(products.map((product) => fromCustomizationProduct(
    product,
    options.defaultNiche ?? options.storeProfile.niche,
    options.storeProfile,
  )), products);
  await queue.waitForDrain();

  collectedItems.sort((left, right) => left.index - right.index);
  const items = collectedItems.map((entry) => entry.result);
  const seoOutputs = collectedItems.flatMap((entry) => entry.seoOutput ? [entry.seoOutput] : []);
  const successful = items.filter((item) => item.success).length;

  return {
    total: items.length,
    successful,
    failed: items.length - successful,
    items,
    seoOutputs,
  };
}
