import { reviewStage } from "../review-actions";
import type { SeoProductUiViewModel } from "../types";

export function ReviewStatusBadge({ product }: { readonly product: SeoProductUiViewModel }): React.JSX.Element {
  const stage = reviewStage(product);
  const labels = { pending: "Chờ duyệt", ready: "Đã duyệt · Chờ sync", syncing: "Đang sync", failed: "Cần kiểm tra", history: product.reviewArchivedAt ? "Đã lưu trữ" : product.shopifySyncStatus === "synced" ? "Đã sync Shopify" : "Lịch sử" };
  return <span className={"rounded-full border px-2.5 py-1 text-[11px] font-semibold " + (stage === "failed" ? "border-amber-800 text-amber-300" : stage === "history" ? "border-teal-800 text-teal-300" : "border-slate-700 text-slate-300")}>{labels[stage]}</span>;
}
