import { reviewErrorMessage } from "../review-actions";
import { ReviewProductActions } from "./ReviewProductActions";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import type { SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductListTableProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly expandedIds: ReadonlySet<string>;
  readonly currentStoreId?: string;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleSelectAll: () => void;
  readonly onToggleExpand: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onViewSyncError?: (product: SeoProductUiViewModel) => void;
  readonly onRollbackProduct?: (id: string) => void;
  readonly onDeleteProduct?: (id: string) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

export function ProductListTable(props: ProductListTableProps): React.JSX.Element {
  const isAllSelected = props.products.length > 0 && props.products.every(product => props.selectedIds.has(product.id));
  return <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
    <table className="w-full table-fixed text-left text-sm">
      <thead className="bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400"><tr>
        <th className="w-10 p-3"><input type="checkbox" aria-label="Chọn trang này" checked={isAllSelected} onChange={props.onToggleSelectAll} className="accent-blue-600" /></th>
        <th className="w-[43%] p-3">Sản phẩm</th><th className="w-[24%] p-3">Đồng bộ</th><th className="p-3">Xem kết quả</th>
      </tr></thead>
      <tbody>{props.products.map(product => <tr key={product.id} className="border-t border-slate-200 bg-white align-top transition hover:bg-slate-50/70 dark:border-slate-700 dark:bg-slate-900 dark:hover:bg-slate-800/50">
        <td className="p-3"><input type="checkbox" aria-label={`Chọn ${product.productTitle.value}`} checked={props.selectedIds.has(product.id)}
          onChange={() => props.onToggleSelect(product.id)} className="accent-blue-300" /></td>
        <td className="p-3"><div className="flex max-w-lg gap-3">
          {product.images[0]?.previewUrl.value && <img src={product.images[0].previewUrl.value} alt={product.images[0].alt.value} loading="lazy" className="h-12 w-12 rounded-lg bg-white object-contain" />}
          <div className="min-w-0"><button type="button" onClick={() => props.onViewProduct(product)} className="line-clamp-2 text-left font-semibold text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-300">{product.productTitle.value}</button>
            <p className="mt-1 truncate text-xs text-slate-500 dark:text-slate-400">{product.asin || product.handle.value || product.productId}</p>
            <p className="mt-1 text-xs text-slate-400">{product.sourceOrigin === "distributed_crawler" ? "Crawler" : product.sourceOrigin === "pinterest_pod" ? "Pinterest POD" : "Auto SEO"} · {new Date(product.updatedAt).toLocaleString("vi-VN")}</p>
          </div></div></td>
        <td className="p-3"><ReviewStatusBadge product={product} />
          {product.shopifySyncError && <p className="mt-2 max-w-sm text-xs text-amber-700 dark:text-amber-300">{reviewErrorMessage(product.shopifySyncError)}</p>}</td>
        <td className="p-3"><ReviewProductActions product={product} onView={props.onViewProduct} onEdit={props.onEditProduct}
          onApprove={props.onApproveProduct} onSync={props.onRetrySync} onArchive={props.onDeleteProduct} /></td>
      </tr>)}</tbody>
    </table>
  </div>;
}
