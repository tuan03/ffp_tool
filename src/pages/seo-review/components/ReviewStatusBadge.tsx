import { reviewStage } from "../review-actions";
import type { SeoProductUiViewModel } from "../types";

export function ReviewStatusBadge({ product }: { readonly product: SeoProductUiViewModel }): React.JSX.Element {
  const stage = reviewStage(product);
  const labels = { pending: "Sẵn sàng sync", ready: "Sẵn sàng sync", syncing: product.shopifySyncStatus === "queued" ? "Đang chờ sync" : "Đang sync Shopify", failed: "Cần kiểm tra", history: product.shopifySyncStatus === "synced" ? "Đã sync Shopify" : product.reviewArchivedAt ? "Đã lưu trữ" : "Đã bỏ qua" };
  return <span role="status" aria-live="polite" className={"inline-flex min-h-7 items-center gap-2 rounded-full border px-2.5 py-1 text-[11px] font-semibold " +
    (stage === "syncing" ? "border-blue-400 bg-blue-600 text-white shadow-sm shadow-blue-900/40" : stage === "failed" ? "border-amber-800 bg-amber-950 text-amber-300" : stage === "history" ? "border-teal-800 bg-teal-950 text-teal-300" : "border-slate-700 text-slate-300")}>
    {stage === "syncing" && <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white/30 border-t-white" />}{labels[stage]}</span>;
}
