import { isReviewSynced, reviewStage } from "../review-actions";
import type { SeoProductUiViewModel } from "../types";

export function ReviewStatusBadge({ product }: { readonly product: SeoProductUiViewModel }): React.JSX.Element {
  const stage = reviewStage(product);
  const hasIncompletePublication = product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:");
  const labels = { pending: "Sẵn sàng sync", ready: "Sẵn sàng sync", syncing: product.shopifySyncStatus === "queued" ? "Đang chờ sync" : "Đang sync Shopify", failed: "Cần kiểm tra", history: isReviewSynced(product) ? "Đã sync Shopify" : product.reviewArchivedAt ? "Đã lưu trữ" : "Đã bỏ qua" };
  return <span role="status" aria-live="polite" className={"inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-semibold " +
    (stage === "syncing" ? "border-blue-300 dark:border-blue-800 bg-blue-600 text-white shadow-sm " : stage === "failed" ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300" : stage === "history" ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300" : "border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300")}>
    {stage === "syncing" && <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />}{hasIncompletePublication && stage === "failed" ? "Đã sync · publish chưa đủ" : labels[stage]}</span>;
}
