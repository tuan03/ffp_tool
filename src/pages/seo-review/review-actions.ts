import { getSeoReviewActions, getSeoReviewStage } from "../../shared/seo-review-list";
import type { SeoReviewActions, SeoReviewStage } from "../../shared/seo-review-list";
import type { SeoProductUiViewModel } from "./types";

export function reviewStage(product: SeoProductUiViewModel): SeoReviewStage {
  if (product.reviewArchivedAt) return "history";
  if (product.backendPublish) return product.backendPublish.state === "SUCCEEDED" ? "history" : product.backendPublish.state === "BLOCKED" ? "failed" : "syncing";
  if (product.isSyncing || product.shopifySyncStatus === "queued" || product.shopifySyncStatus === "syncing") return "syncing";
  if (product.shopifySyncStatus === "synced") return "history";
  if (product.reviewLifecycleStage) return product.reviewLifecycleStage;
  return getSeoReviewStage({ decision: product.reviewDecision, syncStatus: product.shopifySyncStatus ?? "idle", archivedAt: product.reviewArchivedAt });
}
export function reviewActions(product: SeoProductUiViewModel): SeoReviewActions {
  if (product.reviewArchivedAt) return { canEdit: false, canDecide: false, canSync: false, canRetry: false, canArchive: false, canRevise: false, canReconcile: false };
  const actions = product.reviewActions ?? getSeoReviewActions({ decision: product.reviewDecision,
    syncStatus: product.shopifySyncStatus ?? "idle", archivedAt: product.reviewArchivedAt, hasPublish: Boolean(product.backendPublish),
    isUnresolved: Boolean(product.backendPublish && product.backendPublish.state !== "SUCCEEDED") });
  if (product.isSyncing || product.isReverting) return { ...actions, canEdit: false, canDecide: false, canSync: false, canRetry: false, canArchive: false, canRevise: false, canReconcile: false };
  if (product.backendPublish) return { ...actions, canEdit: false, canDecide: false, canSync: false, canRetry: false };
  return product.sourceOrigin === "pinterest_pod" && !product.coordinatorReview ? { ...actions, canArchive: false } : actions;
}
/** Clicking Sync is the operator's consent; pending drafts need no separate approval click. */
export function canStartReviewSync(product: SeoProductUiViewModel): boolean {
  const actions = reviewActions(product);
  return actions.canSync || actions.canRetry || (actions.canDecide && product.reviewDecision === "pending" &&
    (product.shopifySyncStatus ?? "idle") === "idle");
}
export function isReviewSynced(product: SeoProductUiViewModel): boolean {
  return product.shopifySyncStatus === "synced" || product.backendPublish?.state === "SUCCEEDED";
}
export function reviewErrorMessage(error: string | undefined): string {
  if (!error) return "Mở chi tiết để kiểm tra lỗi đồng bộ.";
  if (error.includes("STALE_SOURCE")) return "Nguồn Shopify đã thay đổi. Cần đối chiếu và tạo bản SEO mới; không gửi lại bản cũ.";
  if (/UNCERTAIN|RECONCILIATION_REQUIRED|CONTENT_CONFLICT/.test(error)) return "Chưa xác định được kết quả ghi Shopify. Cần đối chiếu trước khi thử lại hoặc lưu trữ.";
  if (error.includes("REVIEW_ARCHIVED")) return "Bản Review đã lưu trữ, chỉ dùng để xem lịch sử.";
  return error;
}
