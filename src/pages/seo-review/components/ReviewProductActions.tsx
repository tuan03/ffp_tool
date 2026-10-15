import { canStartReviewSync, isReviewSynced, reviewActions } from "../review-actions";
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
  const hasAdvancedActions = actions.canEdit || (canStartReviewSync(product) && props.onSync) || (actions.canArchive && props.onArchive) || (actions.canRevise && props.onRevise);
  const button = "rounded-lg border px-3 py-1.5 text-xs font-semibold transition hover:bg-slate-50 dark:hover:bg-slate-700";
  return <div className="flex flex-wrap items-center gap-2">
    {props.onView && <button type="button" aria-label="Xem chi tiết sản phẩm" onClick={() => props.onView?.(product)} className={button + " border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100"}>Xem</button>}
    {(isReviewSynced(product) || product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:")) && product.shopifyAdminUrl && <a href={product.shopifyAdminUrl} target="_blank" rel="noopener noreferrer"
      className={button + " border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300"}>Mở Shopify ↗</a>}
    {hasAdvancedActions && <details className="text-xs text-slate-500 dark:text-slate-400">
      <summary className="cursor-pointer rounded-lg px-3 py-1.5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:hover:bg-slate-800">Thao tác khác</summary>
      <div className="mt-2 flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
    {actions.canEdit && <button type="button" onClick={() => props.onEdit(product)} className={button + " border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300"}>Sửa</button>}
    {canStartReviewSync(product) && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300"}>{actions.canRetry ? product.shopifySyncError?.startsWith("SHOPIFY_PUBLICATION_INCOMPLETE:") ? "Thử lại publish kênh" : "Thử lại Sync" : "Sync Shopify"}</button>}
    {actions.canArchive && props.onArchive && <button type="button" title="Giữ nguyên SEO, ảnh, backup và lịch sử sync; không xóa sản phẩm Shopify."
      onClick={() => props.onArchive?.(product.id)} className={button + " border-slate-300 dark:border-slate-700 text-slate-600 dark:text-slate-400"}>{product.reviewDecision === "pending" ? "Bỏ khỏi danh sách" : "Lưu trữ"}</button>}
    {actions.canRevise && props.onRevise && <>
      <button type="button" onClick={() => props.onRevise?.(product.id)} className="mt-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-blue-700 dark:text-blue-300">Tạo bản SEO mới</button>
    </>}
      </div>
    </details>}
    {actions.canReconcile && props.onSync && <button type="button" onClick={() => props.onSync?.(product.id)}
      className={button + " border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300"}>Kiểm tra trạng thái Shopify</button>}
  </div>;
}
