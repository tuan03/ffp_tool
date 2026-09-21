interface AutoSeoToolbarProps {
  isLoadingProducts: boolean;
  isRunningAutoSeo: boolean;
  totalProductsCount: number;
  selectedCount: number;
  onLoadProducts(): void;
  onSelectAll(): void;
  onClearSelection(): void;
  onRunAutoSeo(): void;
}

export function AutoSeoToolbar({
  isLoadingProducts,
  isRunningAutoSeo,
  totalProductsCount,
  selectedCount,
  onLoadProducts,
  onSelectAll,
  onClearSelection,
  onRunAutoSeo,
}: AutoSeoToolbarProps): React.JSX.Element {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg backdrop-blur-sm space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Pipeline Info */}
        <div className="flex-1 space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <span>⚙️</span> Quy trình chọn lọc & Chuẩn bị dữ liệu SEO
            </span>
          </div>
          <p className="text-xs text-slate-400 leading-relaxed max-w-2xl">
            Chọn các sản phẩm từ danh sách bên dưới để trích xuất payload đầu vào chuẩn hóa (giữ nguyên HTML mô tả gốc và thông tin SEO) cho pipeline SEO Content Generator.
          </p>
        </div>

        {/* Status Count Pill */}
        <div className="flex md:flex-col items-center md:items-end justify-between gap-1 border-t md:border-t-0 border-slate-800 pt-3 md:pt-0">
          <span className="text-xs text-slate-400">Trạng thái chọn:</span>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-200 border border-slate-700">
              <span className={`h-2 w-2 rounded-full ${selectedCount > 0 ? "bg-cyan-400" : "bg-slate-500"}`} />
              Đã chọn: <strong className="text-cyan-300">{selectedCount}</strong> / {totalProductsCount}
            </span>
          </div>
        </div>
      </div>

      {/* Action Buttons Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/80">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onLoadProducts}
            disabled={isLoadingProducts}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 border border-slate-700 hover:bg-slate-700 hover:text-white transition disabled:opacity-50"
          >
            {isLoadingProducts ? (
              <>
                <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
                Đang tải...
              </>
            ) : (
              <>
                <span>↻</span> Tải sản phẩm (Shopify)
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onSelectAll}
            disabled={totalProductsCount === 0}
            className="rounded-lg bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-white transition disabled:opacity-40"
          >
            ☑ Chọn tất cả
          </button>

          <button
            type="button"
            onClick={onClearSelection}
            disabled={selectedCount === 0}
            className="rounded-lg bg-slate-800/70 px-3 py-2 text-xs font-medium text-slate-300 border border-slate-700/80 hover:bg-slate-800 hover:text-white transition disabled:opacity-40"
          >
            ☐ Bỏ chọn
          </button>
        </div>

        <button
          type="button"
          onClick={onRunAutoSeo}
          disabled={isRunningAutoSeo || totalProductsCount === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-2 text-xs font-bold text-white shadow-md shadow-cyan-600/20 hover:from-cyan-500 hover:to-blue-500 transition disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {isRunningAutoSeo ? (
            <>
              <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
              Đang tạo payload SEO...
            </>
          ) : (
            <>
              <span>🚀</span> Run Auto SEO
            </>
          )}
        </button>
      </div>
    </div>
  );
}
