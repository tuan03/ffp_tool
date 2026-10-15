import { canStartReviewSync, reviewActions } from "../review-actions";
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
  const button = "rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50";
  return <div className="flex flex-wrap items-center gap-2">
    {props.onView && <button type="button" aria-label="Xem chi tiết sản phẩm" onClick={() => props.onView?.(product)} className={button + " border-slate-300 text-slate-900"}>Xem</button>}
    {actions.canEdit && <button type="button" onClick={() => props.onEdit(product)} className={button + " border-slate-300 text-slate-700"}>Sửa</button>}
    {canStartReviewSync(product) && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-blue-300 bg-blue-50 text-blue-700"}>{actions.canRetry ? product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:") ? "Thử lại publish kênh" : "Thử lại Sync" : "Sync Shopify"}</button>}
    {(product.shopifySyncStatus === "synced" || product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:")) && product.shopifyAdminUrl && <a href={product.shopifyAdminUrl} target="_blank" rel="noopener noreferrer"
      className={button + " border-blue-200 text-blue-700"}>Mở Shopify ↗</a>}
    {actions.canArchive && props.onArchive && <button type="button" title="Giữ nguyên SEO, ảnh, backup và lịch sử sync; không xóa sản phẩm Shopify."
      onClick={() => props.onArchive?.(product.id)} className={button + " border-slate-300 text-slate-600"}>{product.reviewDecision === "pending" ? "Bỏ khỏi danh sách" : "Lưu trữ"}</button>}
    {actions.canRevise && props.onRevise && <details className="relative text-xs text-slate-600">
      <summary className="cursor-pointer rounded-lg border border-slate-300 px-3 py-1.5">Nâng cao</summary>
      <button type="button" onClick={() => props.onRevise?.(product.id)} className="mt-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-blue-700">Tạo bản SEO mới</button>
    </details>}
    {actions.canReconcile && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-amber-200 text-amber-700"}>Kiểm tra trạng thái Shopify</button>}
  </div>;
}
