import type { AutoSeoStoreOption } from "../../types";
import type { AutoSeoEligibilityResponse } from "../../types";
import type { AutoSeoBatchSize, AutoSeoEligibilityFilter } from "../smart-batch";

export interface AutoSeoToolbarProps {
  isLoadingProducts: boolean;
  isRunningAutoSeo: boolean;
  totalProductsCount: number;
  selectedCount: number;
  reSeoCount?: number;
  visibleProductsCount?: number;
  onLoadProducts(): void;
  onSelectAll?(): void;
  onClearSelection?(): void;
  onRunAutoSeo(): void | Promise<void>;
  onReSeo?(): void | Promise<void>;
  isCreatingRevisions?: boolean;
  stores?: readonly AutoSeoStoreOption[];
  selectedStoreId?: string;
  onSelectStore?(storeId: string): void;
  isLoadingStores?: boolean;
  batchSize?: AutoSeoBatchSize;
  onBatchSizeChange?(batchSize: AutoSeoBatchSize): void;
  onSelectNextBatch?(): void;
  isEligibilityLoading?: boolean;
  eligibilityCounts?: AutoSeoEligibilityResponse["counts"];
  eligibilityFilter?: AutoSeoEligibilityFilter;
  onEligibilityFilterChange?(filter: AutoSeoEligibilityFilter): void;
}

export function AutoSeoToolbar({
  isLoadingProducts,
  isRunningAutoSeo,
  totalProductsCount,
  selectedCount,
  reSeoCount = 0,
  onLoadProducts,
  onClearSelection,
  onRunAutoSeo,
  onReSeo,
  isCreatingRevisions = false,
  stores,
  selectedStoreId,
  onSelectStore,
  isLoadingStores = false,
  batchSize = 50,
  onBatchSizeChange,
  onSelectNextBatch,
  isEligibilityLoading = false,
  eligibilityCounts,
  eligibilityFilter,
  onEligibilityFilterChange,
}: AutoSeoToolbarProps): React.JSX.Element {
  const needsSeoCount = eligibilityCounts
    ? eligibilityCounts.never_processed + eligibilityCounts.changed + eligibilityCounts.retry
    : 0;

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 sm:p-5 shadow-lg backdrop-blur-sm space-y-4">
      {/* Top Header Row: Store Selection & Data Synchronization */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        {/* Pipeline Info */}
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <span>⚙️</span> Quy trình chọn lọc &amp; Chuẩn bị dữ liệu SEO
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
            Chọn các sản phẩm từ danh sách bên dưới để trích xuất payload đầu vào chuẩn hóa cho pipeline SEO Content Generator.
          </p>
        </div>

        {/* Store Selector, Load Products Button, and Selected Counter */}
        <div className="flex flex-wrap items-center gap-3 border-t lg:border-t-0 border-slate-800 pt-3 lg:pt-0">
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
              className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs font-medium text-slate-200 focus:border-cyan-500 focus:outline-hidden disabled:opacity-50 cursor-pointer min-w-[190px]"
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

          {/* Nút Tải sản phẩm đi liền với Cửa hàng */}
          <button
            type="button"
            onClick={onLoadProducts}
            disabled={isLoadingProducts || isLoadingStores || !selectedStoreId || !stores || stores.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 hover:border-slate-600 px-3.5 py-1.5 text-xs font-semibold text-slate-200 shadow-xs transition disabled:opacity-50 disabled:cursor-not-allowed"
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

          {/* Badge Đã chọn */}
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold border transition ${
                selectedCount > 0
                  ? "bg-cyan-950/60 border-cyan-700 text-cyan-200 shadow-xs shadow-cyan-900/30"
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

            {selectedCount > 0 && onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                className="text-xs text-rose-400 hover:text-rose-300 hover:underline px-1 py-0.5 transition cursor-pointer"
                title="Bỏ chọn toàn bộ sản phẩm đang chọn"
              >
                ✕ Bỏ chọn
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Action Row: Smart Batch + Health Metrics on Left, Run Button on Right (No Wrap!) */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-3 border-t border-slate-800/80">
        {/* Left: Smart Batch & Inventory Metrics */}
        <div className="flex flex-wrap items-center gap-3">
          {onSelectNextBatch && (
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
                className="inline-flex items-center gap-1.5 rounded-md bg-cyan-950 hover:bg-cyan-900 border border-cyan-700/80 px-3 py-1 text-xs font-semibold text-cyan-200 shadow-xs transition disabled:cursor-not-allowed disabled:opacity-40"
              >
                <span>⚡</span>
                {isEligibilityLoading ? "Đang kiểm tra..." : `Chọn ${batchSize} sản phẩm tiếp theo`}
              </button>
            </div>
          )}

          {eligibilityCounts && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium">
              <button
                type="button"
                onClick={() =>
                  onEligibilityFilterChange?.(
                    eligibilityFilter === "needs_seo" ? "all" : "needs_seo",
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition cursor-pointer ${
                  eligibilityFilter === "needs_seo"
                    ? "bg-cyan-900/90 border border-cyan-400 text-cyan-100 font-bold shadow-xs shadow-cyan-900/50 ring-1 ring-cyan-400/50"
                    : "bg-cyan-950/50 border border-cyan-800/70 text-cyan-300 hover:bg-cyan-900/50"
                }`}
                title={
                  eligibilityFilter === "needs_seo"
                    ? "Đang lọc: Cần SEO (click để bỏ lọc)"
                    : "Click để lọc các sản phẩm cần làm SEO"
                }
              >
                <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />
                Cần SEO: {needsSeoCount}
              </button>

              <button
                type="button"
                onClick={() =>
                  onEligibilityFilterChange?.(
                    eligibilityFilter === "current" ? "all" : "current",
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition cursor-pointer ${
                  eligibilityFilter === "current"
                    ? "bg-emerald-900/90 border border-emerald-400 text-emerald-100 font-bold shadow-xs shadow-emerald-900/50 ring-1 ring-emerald-400/50"
                    : "bg-slate-800/60 border border-slate-700 text-slate-300 hover:bg-slate-800"
                }`}
                title={
                  eligibilityFilter === "current"
                    ? "Đang lọc: Đã SEO (click để bỏ lọc)"
                    : "Click để lọc các sản phẩm đã cập nhật SEO"
                }
              >
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                Đã SEO: {eligibilityCounts.current}
              </button>

              <button
                type="button"
                onClick={() =>
                  onEligibilityFilterChange?.(
                    eligibilityFilter === "active" ? "all" : "active",
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 transition cursor-pointer ${
                  eligibilityFilter === "active"
                    ? "bg-violet-900/90 border border-violet-400 text-violet-100 font-bold shadow-xs shadow-violet-900/50 ring-1 ring-violet-400/50"
                    : "bg-violet-950/50 border border-violet-800/70 text-violet-300 hover:bg-violet-900/50"
                }`}
                title={
                  eligibilityFilter === "active"
                    ? "Đang lọc: Đang xử lý (click để bỏ lọc)"
                    : "Click để lọc các sản phẩm đang xử lý SEO"
                }
              >
                <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                Đang xử lý: {eligibilityCounts.active}
              </button>
            </div>
          )}
        </div>

        {/* Right: create first SEO draft or a new revision for synced products. */}
        <div className="flex flex-wrap items-center gap-2 self-start md:self-auto">
          {onReSeo && (
            <button
              type="button"
              onClick={onReSeo}
              disabled={isCreatingRevisions || isRunningAutoSeo || reSeoCount === 0}
              title="Tạo bản SEO mới cho sản phẩm đã Sync; chưa duyệt và chưa ghi Shopify"
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-amber-600/80 bg-amber-950/60 px-5 py-2.5 text-xs font-bold text-amber-200 transition hover:bg-amber-900/70 disabled:cursor-not-allowed disabled:opacity-40 whitespace-nowrap"
            >
              {isCreatingRevisions ? "Đang tạo bản SEO lại..." : `SEO lại${reSeoCount > 0 ? ` (${reSeoCount})` : ""}`}
            </button>
          )}
          <button
            type="button"
            onClick={onRunAutoSeo}
            disabled={isCreatingRevisions || isRunningAutoSeo || selectedCount === 0 || totalProductsCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 px-6 py-2.5 text-xs font-bold text-white shadow-lg shadow-cyan-900/30 hover:from-cyan-500 hover:via-blue-500 hover:to-indigo-500 transition-all transform active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:transform-none disabled:shadow-none whitespace-nowrap"
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
    </div>
  );
}
