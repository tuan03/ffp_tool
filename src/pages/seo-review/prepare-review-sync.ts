import type { AmazonCrawlerReviewClient } from "../../modules/amazon-crawler";
import { updateAutoSeoReviewStatus } from "./auto-seo-review-client";
import { canStartReviewSync, reviewActions } from "./review-actions";
import type { SeoProductUiViewModel } from "./types";

interface ReviewSyncDependencies {
  readonly storeId: string;
  readonly crawler?: Pick<AmazonCrawlerReviewClient, "decide">;
  readonly gpt?: { saveReviewState(storeId: string, jobId: string, state: SeoProductUiViewModel): Promise<unknown> };
  readonly saveLegacyStatus?: typeof updateAutoSeoReviewStatus;
  readonly now?: () => number;
}

/** Preserve backend validation/audit; consent is persisted only after an explicit Sync click. */
export async function prepareReviewSync(product: SeoProductUiViewModel, dependencies: ReviewSyncDependencies): Promise<SeoProductUiViewModel> {
  if (!product.storeId || product.storeId !== dependencies.storeId) throw new Error("Review không thuộc store đang xem.");
  if (!canStartReviewSync(product) && !reviewActions(product).canReconcile) throw new Error("Bản Review này không thể sync ở trạng thái hiện tại.");
  if (product.reviewDecision !== "pending") return product;
  if (product.reviewListItem) throw new Error("Cần tải đầy đủ bản Review trước khi sync.");
  let version = product.coordinatorReview?.version;
  if (product.coordinatorReview) {
    if (!dependencies.crawler) throw new Error("Coordinator Review API is unavailable.");
    const review = await dependencies.crawler.decide(product.coordinatorReview.itemId, product.coordinatorReview.version, "approved");
    version = review.version;
  }
  const prepared: SeoProductUiViewModel = { ...product, reviewDecision: "approved", rejectionReason: undefined,
    reviewActions: undefined, reviewLifecycleStage: undefined, isSyncing: false,
    coordinatorReview: product.coordinatorReview && version !== undefined ? { ...product.coordinatorReview, version } : product.coordinatorReview,
    updatedAt: (dependencies.now ?? Date.now)() };
  if (product.gptJobId) {
    if (!dependencies.gpt) throw new Error("GPT Review API is unavailable.");
    await dependencies.gpt.saveReviewState(dependencies.storeId, product.gptJobId, prepared);
  } else if (product.sourceOrigin === "auto_seo" && !product.coordinatorReview) {
    await (dependencies.saveLegacyStatus ?? updateAutoSeoReviewStatus)(prepared, "approved");
  }
  return prepared;
}
