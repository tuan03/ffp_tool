import type { GptSeoJob } from "../../modules/custom-gpt-seo";
import type { AutoSeoSourceProduct, SeoContentDetailedOutput } from "../../modules/seo-content";

import { adaptAutoSeoItemToViewModel } from "./seo-content-ui-adapter";
import { restoreShopifyReviewImageIds } from "./shopify-review-images";
import type { SeoProductUiViewModel } from "./types";

interface ReviewPage<TReview> {
  readonly reviews: readonly TReview[];
  readonly nextOffset: number | null;
}

interface ReviewPageClient<TReview> {
  reviews(storeId: string, offset: number): Promise<ReviewPage<TReview>>;
}

export async function loadAllCustomGptReviewRecords<TReview>(
  client: ReviewPageClient<TReview>,
  storeId: string,
): Promise<readonly TReview[]> {
  const reviews: TReview[] = [];
  let offset = 0;

  while (true) {
    const page = await client.reviews(storeId, offset);
    reviews.push(...page.reviews);
    if (page.nextOffset === null) return reviews;
    offset = page.nextOffset;
  }
}

export function adaptCustomGptReview(job: GptSeoJob, saved: Record<string, unknown> = {}): SeoProductUiViewModel {
  if (job.source !== "auto_seo" || job.status !== "REVIEW_READY") throw new Error("Only completed Auto SEO jobs use this review adapter");
  const result = job.result as SeoContentDetailedOutput;
  if (!result?.output?.productTitle) throw new Error("Missing GPT SEO output");
  const sourceProduct = job.original as AutoSeoSourceProduct;
  const sourceHandle = typeof sourceProduct.handle === "string" ? sourceProduct.handle : "";
  const product = adaptAutoSeoItemToViewModel({
    productId: job.execution?.productId || job.sourceIdentity,
    storeId: job.storeId,
    handle: sourceHandle,
    sourceProduct,
    seoInput: job.input,
    seoOutput: result.output,
    success: true,
  }, job.storeId);
  const review = { ...product, ...saved, id: `gpt-${job.id}`, gptJobId: job.id, storeId: job.storeId, sourceOrigin: "auto_seo" } as SeoProductUiViewModel;
  // Previously saved reviews contain presentation IDs. Preserve their edits while repairing identity.
  return { ...review, images: restoreShopifyReviewImageIds(review.images, sourceProduct.images) };
}
