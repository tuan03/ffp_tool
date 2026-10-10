import { reviewActions } from "../review-actions";
import type { SeoProductUiViewModel } from "../types";

export interface ReviewProductActionsProps {
  readonly product: SeoProductUiViewModel;
  readonly onView?: (product: SeoProductUiViewModel) => void;
  readonly onEdit: (product: SeoProductUiViewModel) => void;
  readonly onApprove: (id: string) => void;
  readonly onSync?: (id: string) => void;
  readonly onArchive?: (id: string) => void;
  readonly onRevise?: (id: string) => void;
}
export function ReviewProductActions(props: ReviewProductActionsProps): React.JSX.Element {
  const { product } = props;
  const actions = reviewActions(product);
  const button = "rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-800";
  return <div className="flex flex-wrap items-center gap-2">
    {props.onView && <button type="button" aria-label="Xem chi tiết sản phẩm" onClick={() => props.onView?.(product)} className={button + " border-slate-700 text-slate-200"}>Xem</button>}
    {actions.canEdit && <button type="button" onClick={() => props.onEdit(product)} className={button + " border-slate-700 text-slate-300"}>Sửa</button>}
    {actions.canDecide && product.reviewDecision !== "approved" && <button type="button" onClick={() => props.onApprove(product.id)} className={button + " border-emerald-700 text-emerald-300"}>Duyệt</button>}
    {(actions.canSync || actions.canRetry) && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-cyan-600 bg-cyan-950 text-cyan-200"}>{actions.canRetry ? "Thử lại Sync" : "Sync Shopify"}</button>}
    {product.shopifySyncStatus === "synced" && product.shopifyAdminUrl && <a href={product.shopifyAdminUrl} target="_blank" rel="noopener noreferrer"
      className={button + " border-teal-800 text-teal-300"}>Mở Shopify ↗</a>}
    {actions.canArchive && props.onArchive && <button type="button" title="Giữ nguyên SEO, ảnh, backup và lịch sử sync; không xóa sản phẩm Shopify."
      onClick={() => props.onArchive?.(product.id)} className={button + " border-slate-700 text-slate-400"}>{product.reviewDecision === "pending" ? "Bỏ khỏi danh sách" : "Lưu trữ"}</button>}
    {actions.canRevise && props.onRevise && <details className="relative text-xs text-slate-400">
      <summary className="cursor-pointer rounded-lg border border-slate-700 px-3 py-1.5">Nâng cao</summary>
      <button type="button" onClick={() => props.onRevise?.(product.id)} className="mt-2 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-cyan-300">Tạo bản SEO mới</button>
    </details>}
    {actions.canReconcile && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-amber-800 text-amber-300"}>Kiểm tra trạng thái Shopify</button>}
  </div>;
}
