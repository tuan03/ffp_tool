import { reviewErrorMessage } from "../review-actions";
import { ReviewProductActions } from "./ReviewProductActions";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import type { SeoProductUiViewModel } from "../types";

export interface ProductCardListProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly currentStoreId?: string;
  readonly onToggleSelect: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onViewSyncError?: (product: SeoProductUiViewModel) => void;
  readonly onRollbackProduct?: (id: string) => void;
  readonly onRequeueProduct?: (id: string) => void;
  readonly onDeleteProduct?: (id: string) => void;
}

export function ProductCardList(props: ProductCardListProps): React.JSX.Element {
  return <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
    {props.products.map(product => <article key={product.id} className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="flex items-start gap-3">
        <input type="checkbox" aria-label={`Chọn ${product.productTitle.value}`} checked={props.selectedIds.has(product.id)}
          onChange={() => props.onToggleSelect(product.id)} className="mt-1 accent-cyan-500" />
        {product.images[0]?.previewUrl.value && <button type="button" onClick={() => props.onViewProduct(product)} aria-label={`Xem ảnh ${product.productTitle.value}`}>
          <img src={product.images[0].previewUrl.value} alt={product.images[0].alt.value} loading="lazy" className="h-20 w-20 rounded-lg bg-white object-contain" />
        </button>}
        <div className="min-w-0 flex-1"><h2 className="line-clamp-3 text-sm font-semibold text-slate-100">{product.productTitle.value}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{product.asin || product.handle.value || product.productId}</p>
          <p className="mt-1 text-[11px] text-slate-500">{product.sourceOrigin === "distributed_crawler" ? "Crawler" : product.sourceOrigin === "pinterest_pod" ? "Pinterest POD" : "Auto SEO"}</p>
        </div>
      </div>
      <div><ReviewStatusBadge product={product} /></div>
      {product.shopifySyncError && <p role="status" className="text-xs leading-relaxed text-amber-300">{reviewErrorMessage(product.shopifySyncError)}</p>}
      <div className="mt-auto border-t border-slate-800 pt-3">
        <ReviewProductActions product={product} onView={props.onViewProduct} onEdit={props.onEditProduct} onApprove={props.onApproveProduct}
          onSync={props.onRetrySync} onArchive={props.onDeleteProduct} />
      </div>
    </article>)}
  </div>;
}
