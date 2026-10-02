import type { AutoSeoStoreOption } from "../../types";
import type { AutoSeoEligibilityResponse } from "../../types";
import type { AutoSeoBatchSize } from "../smart-batch";

export interface AutoSeoToolbarProps {
  isLoadingProducts: boolean;
  isRunningAutoSeo: boolean;
  totalProductsCount: number;
  selectedCount: number;
  visibleProductsCount: number;
  onLoadProducts(): void;
  onSelectAll(): void;
  onClearSelection(): void;
  onRunAutoSeo(): void | Promise<void>;
  stores?: readonly AutoSeoStoreOption[];
  selectedStoreId?: string;
  onSelectStore?(storeId: string): void;
  isLoadingStores?: boolean;
  batchSize?: AutoSeoBatchSize;
  onBatchSizeChange?(batchSize: AutoSeoBatchSize): void;
  onSelectNextBatch?(): void;
  isEligibilityLoading?: boolean;
  eligibilityCounts?: AutoSeoEligibilityResponse["counts"];
}

export function AutoSeoToolbar({
  isLoadingProducts,
  isRunningAutoSeo,
  totalProductsCount,
  selectedCount,
  visibleProductsCount,
  onLoadProducts,
  onSelectAll,
  onClearSelection,
  onRunAutoSeo,
  stores,
  selectedStoreId,
  onSelectStore,
  isLoadingStores = false,
  batchSize = 50,
  onBatchSizeChange,
  onSelectNextBatch,
  isEligibilityLoading = false,
  eligibilityCounts,
}: AutoSeoToolbarProps): React.JSX.Element {
  const needsSeoCount = eligibilityCounts
    ? eligibilityCounts.never_processed + eligibilityCounts.changed + eligibilityCounts.retry
    : 0;

  const clearCount =
    visibleProductsCount === 0
      ? 0
      : selectedCount > 0
        ? selectedCount
        : visibleProductsCount;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-4">
      {/* Top Header Row: Store Selection & Global Status */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Pipeline Info */}
        <div className="flex-1 space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <span>⚙️</span> Quy trình chọn lọc &amp; Chuẩn bị dữ liệu SEO
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Chọn các sản phẩm từ danh sách bên dưới để trích xuất payload đầu vào chuẩn hóa (giữ nguyên HTML mô tả gốc và thông tin SEO) cho pipeline SEO Content Generator.
          </p>
        </div>

        {/* Store Selector & Selected Counter */}
        <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
          <div className="flex items-center gap-2">
            <label
              htmlFor="auto-seo-store-select"
              className="text-xs font-medium text-slate-300 whitespace-nowrap flex items-center gap-1.5"
            >
              <span>🏪</span> Cửa hàng:
            </label>
            <select
              id="auto-seo-store-select"
              value={selectedStoreId || ""}
              onChange={(e) => onSelectStore?.(e.target.value)}
              disabled={isLoadingStores || isLoadingProducts || !stores || stores.length === 0}
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-cyan-500 focus:outline-hidden disabled:opacity-50 cursor-pointer min-w-[200px]"
            >
              {isLoadingStores ? (
                <option value="">Đang tải danh sách cửa hàng...</option>
              ) : stores && stores.length > 0 ? (
                stores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.storeId} ({s.shopDomain})
                  </option>
                ))
              ) : (
                <option value="">Không có cửa hàng nào</option>
              )}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                selectedCount > 0
                  ? "bg-cyan-950/60 border-cyan-700/80 text-cyan-200 shadow-xs shadow-cyan-900/30"
                  : "bg-slate-800/80 border-slate-700 text-slate-300"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  selectedCount > 0 ? "bg-cyan-400 animate-pulse" : "bg-slate-500"
                }`}
              />
              Đã chọn: <strong className="text-cyan-300 font-bold">{selectedCount}</strong> / {totalProductsCount}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Toolbar: Selection, Smart Batch, and Run CTA */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800/80">
        {/* Button Group 0: Data Refresh and Bulk Selection */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onLoadProducts}
            disabled={isLoadingProducts || isLoadingStores || !selectedStoreId || !stores || stores.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 px-3.5 py-2 text-xs font-semibold text-slate-200 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
            title="Lấy danh sách sản phẩm mới nhất từ Shopify"
          >
            {isLoadingProducts ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                Đang tải...
              </>
            ) : (
              <>
                <span className="text-cyan-400">↻</span> Tải sản phẩm
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onSelectAll}
            disabled={visibleProductsCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-white transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="Chọn tất cả sản phẩm đang hiển thị trong bộ lọc"
          >
            ☑ Chọn tất cả ({visibleProductsCount})
          </button>

          <button
            type="button"
            onClick={onClearSelection}
            disabled={visibleProductsCount === 0 || selectedCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-rose-300 transition disabled:opacity-40 disabled:cursor-not-allowed"
            title="Bỏ chọn các sản phẩm đang được chọn"
          >
            ☐ Bỏ chọn ({clearCount})
          </button>
        </div>

        {/* Button Group 1: Smart Batch & Inventory Metrics */}
        {onSelectNextBatch && (
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 bg-slate-950/80 p-1 rounded-lg border border-slate-800">
              <label htmlFor="auto-seo-batch-size" className="text-xs text-slate-400 pl-1.5">
                Mỗi lượt
              </label>
              <select
                id="auto-seo-batch-size"
                aria-label="Số sản phẩm mỗi batch"
                value={batchSize}
                onChange={(event) =>
                  onBatchSizeChange?.(Number(event.target.value) as AutoSeoBatchSize)
                }
                className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-xs font-semibold text-slate-200 cursor-pointer focus:border-cyan-500 focus:outline-hidden"
              >
                {[10, 20, 50, 100].map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={onSelectNextBatch}
                disabled={isEligibilityLoading || !eligibilityCounts || needsSeoCount === 0}
                title="Tự động chọn nhanh các sản phẩm chưa làm SEO hoặc có cập nhật mới nhất"
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-950/80 hover:bg-cyan-900/80 border border-cyan-700/80 px-3 py-1 text-xs font-semibold text-cyan-200 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>⚡</span>
                {isEligibilityLoading ? "Đang kiểm tra..." : `Chọn ${batchSize} sản phẩm tiếp theo`}
              </button>
            </div>

            {eligibilityCounts && (
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
                <span className="inline-flex items-center gap-1 rounded-md bg-cyan-950/50 border border-cyan-800/70 px-2 py-0.5 text-cyan-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                  Cần SEO: {needsSeoCount}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-slate-800/60 border border-slate-700 px-2 py-0.5 text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  Đã cập nhật: {eligibilityCounts.current}
                </span>
                <span className="inline-flex items-center gap-1 rounded-md bg-violet-950/50 border border-violet-800/70 px-2 py-0.5 text-violet-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                  Đang xử lý: {eligibilityCounts.active}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Button Group 2: Primary CTA */}
        <button
          type="button"
          onClick={onRunAutoSeo}
          disabled={isRunningAutoSeo || selectedCount === 0 || totalProductsCount === 0}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-cyan-600/20 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none"
        >
          {isRunningAutoSeo ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Đang tạo payload SEO...
            </>
          ) : (
            <>
              <span>🚀</span> Run Auto SEO {selectedCount > 0 ? `(${selectedCount})` : ""}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
