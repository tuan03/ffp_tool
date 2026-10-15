import { useEffect, useRef } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import type { SeoProductUiViewModel } from "../types";

import { ReviewProductActions } from "./ReviewProductActions";
import { ReviewResultContent } from "./ReviewResultContent";
import { ReviewResultStatus } from "./ReviewResultStatus";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import type { ZoomImageItem } from "../types";

export interface ProductSplitViewProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly activeProduct: SeoProductUiViewModel | null;
  readonly currentStoreId?: string;
  readonly onSelectActive: (product: SeoProductUiViewModel) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onRollbackProduct?: (id: string) => void;
  readonly onApproveAndNext: (id: string) => void;
  readonly onRejectAndNext: (id: string) => void;
  readonly onDeleteProduct?: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onViewSyncError?: (product: SeoProductUiViewModel) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}


export function ProductSplitView(props: ProductSplitViewProps): React.JSX.Element {
  const { products, activeProduct, onSelectActive } = props;
  const readerRef = useRef<HTMLDivElement>(null);
  const activeIndex = products.findIndex(product => product.id === activeProduct?.id);
  useEffect(() => {
    const first = products[0];
    if (first && !products.some(product => product.id === activeProduct?.id)) onSelectActive(first);
  }, [products, activeProduct?.id, onSelectActive]);
  useEffect(() => { readerRef.current?.scrollTo({ top: 0 }); }, [activeProduct?.id]);

  function handleNavigate(direction: number): void {
    const product = products[activeIndex + direction];
    if (product) onSelectActive(product);
  }
  useEffect(() => {
    function handleKeyDown(event: globalThis.KeyboardEvent): void {
      if (document.querySelector('dialog[open], [role="dialog"]')) return;
      const element = document.activeElement;
      if (element instanceof HTMLElement && (element.isContentEditable || element.closest("input, textarea, select, button, a, summary, [role='tablist'], [role='tabpanel']"))) return;
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        handleNavigate(event.key === "ArrowUp" ? -1 : 1);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [products, activeIndex, onSelectActive]);

  return <div className="grid min-w-0 grid-cols-[minmax(17rem,0.85fr)_minmax(0,2fr)] items-start gap-4">
    <section aria-label="Danh sách kết quả SEO" className="sticky top-20 flex h-[calc(100dvh-25rem)] min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
        <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">Sản phẩm trên trang</h3>
        <span className="text-xs tabular-nums text-slate-400">{products.length}</span>
      </div>
      <div className="min-h-0 overflow-y-auto">
        {products.map(product => <article key={product.id} aria-label={product.productTitle.value}
          className={"relative flex gap-2 border-b border-slate-100 px-3 py-4 last:border-0 dark:border-slate-800 " +
            (product.id === activeProduct?.id ? "bg-blue-50/70 shadow-[inset_3px_0_0_0_#2563eb] dark:bg-blue-950/30" : "hover:bg-slate-50 dark:hover:bg-slate-800/50")}>
          <input type="checkbox" aria-label={`Chọn ${product.productTitle.value}`} checked={props.selectedIds.has(product.id)}
            onChange={() => props.onToggleSelect(product.id)} className="mt-1 h-3.5 w-3.5 shrink-0 accent-blue-600" />
          <button type="button" aria-pressed={product.id === activeProduct?.id} onClick={() => onSelectActive(product)}
            className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-2 focus-visible:outline-blue-600">
            <span className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-slate-100 bg-white text-slate-400 dark:border-slate-700 dark:bg-slate-800">
              {product.images[0]?.previewUrl.value ? <img src={product.images[0].previewUrl.value} alt="" loading="lazy" className="h-full w-full object-contain" /> : <AppIcon name="image" />}
            </span>
            <span className="min-w-0 flex-1 space-y-2">
              <span className="line-clamp-2 block text-xs font-semibold leading-5 text-slate-900 dark:text-slate-100">{product.productTitle.value}</span>
              <span className="block truncate font-mono text-[11px] text-slate-400">{product.asin || product.handle.value || product.productId}</span>
              <ReviewStatusBadge product={product} />
            </span>
          </button>
        </article>)}
      </div>
      <p className="border-t border-slate-200 px-4 py-2.5 text-[11px] text-slate-400 dark:border-slate-700">↑ ↓ chuyển sản phẩm · Chỉ xem, không tự ghi dữ liệu</p>
    </section>
    <section aria-label="Khung đọc kết quả SEO" className="sticky top-20 flex h-[calc(100dvh-25rem)] min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
      {activeProduct ? <>
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-700">
          <div className="min-w-0"><p className="mb-1 text-[11px] font-medium text-slate-400">Kết quả đã lưu</p>
            <h3 className="line-clamp-2 text-base font-semibold leading-6 tracking-tight text-slate-900 dark:text-slate-100">{activeProduct.productTitle.value}</h3>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <button type="button" aria-label="Sản phẩm trước" disabled={activeIndex <= 0} onClick={() => handleNavigate(-1)}
              className="rounded-md border border-slate-200 px-2 py-1.5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800">←</button>
            <span className="tabular-nums">{Math.max(0, activeIndex + 1)}/{products.length}</span>
            <button type="button" aria-label="Sản phẩm kế tiếp" disabled={activeIndex >= products.length - 1} onClick={() => handleNavigate(1)}
              className="rounded-md border border-slate-200 px-2 py-1.5 hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-30 dark:border-slate-700 dark:hover:bg-slate-800">→</button>
          </div>
        </div>
        <div ref={readerRef} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <ReviewResultStatus product={activeProduct} currentStoreId={props.currentStoreId} />
          <ReviewResultContent product={activeProduct} onZoomImage={props.onZoomImage} />
        </div>
        <div className="shrink-0 border-t border-slate-200 p-3 dark:border-slate-700">
          <ReviewProductActions product={activeProduct} onView={props.onViewProduct} onEdit={props.onEditProduct}
            onApprove={props.onApproveProduct} onSync={props.onRetrySync} onArchive={props.onDeleteProduct} />
        </div>
      </> : <p className="p-10 text-sm text-slate-500 dark:text-slate-400">Chọn sản phẩm bên trái để xem nội dung đã lưu.</p>}
    </section>
  </div>;
}
