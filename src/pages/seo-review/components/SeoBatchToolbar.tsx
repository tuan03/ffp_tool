import type { SeoReviewFilterState, SeoReviewViewMode } from "../types";

export interface SeoBatchToolbarProps {
  readonly totalCount: number;
  readonly filteredCount?: number;
  readonly crawlCount?: number;
  readonly podCount?: number;
  readonly autoSeoCount?: number;
  readonly pendingCount?: number;
  readonly approvedCount?: number;
  readonly approvedUnsyncedCount?: number;
  readonly rejectedCount?: number;
  readonly syncFailedCount?: number;
  readonly selectedCount: number;
  readonly canRollbackCount?: number;
  readonly filter: SeoReviewFilterState;
  readonly viewMode: SeoReviewViewMode;
  readonly isAllExpanded?: boolean;
  readonly isSyncing?: boolean;
  readonly isReverting?: boolean;
  readonly onFilterChange: (newFilter: Partial<SeoReviewFilterState>) => void;
  readonly onViewModeChange: (mode: SeoReviewViewMode) => void;
  readonly onToggleExpandAll?: () => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly onApproveSelected: () => void;
  readonly onRejectSelected: () => void;
  readonly onSyncAllApproved: () => void;
  readonly onRollbackSelected?: () => void;
  readonly onExportApprovedJson: () => void;
  readonly onClearAll: () => void;
}

export function SeoBatchToolbar({
  totalCount,
  filteredCount,
  crawlCount = 0,
  podCount = 0,
  autoSeoCount = 0,
  pendingCount = 0,
  approvedCount = 0,
  approvedUnsyncedCount = 0,
  rejectedCount = 0,
  syncFailedCount = 0,
  selectedCount,
  canRollbackCount = 0,
  filter,
  viewMode,
  isAllExpanded = false,
  isSyncing = false,
  isReverting = false,
  onFilterChange,
  onViewModeChange,
  onToggleExpandAll,
  onSelectAll,
  onClearSelection,
  onApproveSelected,
  onRejectSelected,
  onSyncAllApproved,
  onRollbackSelected,
  onExportApprovedJson,
  onClearAll,
}: SeoBatchToolbarProps): React.JSX.Element {
  return (
    <div className="space-y-3.5">
      {/* Product Source Origin Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="text-xs font-semibold text-slate-400 mr-1 flex items-center gap-1">
            <span>🏷️</span>
            <span>Nguồn sản phẩm:</span>
          </span>
          <button
            type="button"
            onClick={() => onFilterChange({ sourceOriginFilter: "all" })}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              !filter.sourceOriginFilter || filter.sourceOriginFilter === "all"
                ? "bg-slate-700/90 text-white shadow-sm ring-1 ring-slate-500/50"
                : "bg-slate-900/80 text-slate-400 hover:text-slate-200 border border-slate-800"
            }`}
          >
            <span>🌐</span>
            <span>Tất cả nguồn</span>
            <span className="font-mono text-[11px] opacity-80">({totalCount})</span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ sourceOriginFilter: "distributed_crawler" })}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              filter.sourceOriginFilter === "distributed_crawler"
                ? "bg-cyan-950 text-cyan-200 border border-cyan-500 shadow-md shadow-cyan-950/40 ring-1 ring-cyan-500/30"
                : "bg-slate-900/80 text-cyan-400/80 hover:text-cyan-300 border border-slate-800"
            }`}
            title="Sản phẩm cào từ Distributed Crawler (Amazon). Đã tối ưu SEO trong pipeline cào, sẵn sàng cập nhật hoặc duyệt."
          >
            <span>⚡</span>
            <span>Distributed Crawl</span>
            <span className="font-mono text-[11px] opacity-90">({crawlCount})</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-emerald-950/90 text-emerald-300 border border-emerald-700/60 ml-0.5">
              ✓ Đã SEO sẵn
            </span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ sourceOriginFilter: "pinterest_pod" })}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              filter.sourceOriginFilter === "pinterest_pod"
                ? "bg-pink-950 text-pink-200 border border-pink-500 shadow-md shadow-pink-950/40 ring-1 ring-pink-500/30"
                : "bg-slate-900/80 text-pink-400/80 hover:text-pink-300 border border-slate-800"
            }`}
            title="Sản phẩm thiết kế từ Pinterest POD Studio. Cần duyệt lại tiêu đề, mô tả và ảnh in."
          >
            <span>🎨</span>
            <span>Pinterest POD</span>
            <span className="font-mono text-[11px] opacity-90">({podCount})</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-700/60 ml-0.5">
              ⏳ Cần duyệt lại
            </span>
          </button>

          <button
            type="button"
            onClick={() => onFilterChange({ sourceOriginFilter: "auto_seo" })}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
              filter.sourceOriginFilter === "auto_seo"
                ? "bg-purple-950 text-purple-200 border border-purple-500 shadow-md shadow-purple-950/40 ring-1 ring-purple-500/30"
                : "bg-slate-900/80 text-purple-400/80 hover:text-purple-300 border border-slate-800"
            }`}
            title="Sản phẩm tuyển chọn từ Auto SEO. Cần duyệt lại nội dung SEO trước khi đồng bộ."
          >
            <span>🤖</span>
            <span>Auto SEO</span>
            <span className="font-mono text-[11px] opacity-90">({autoSeoCount})</span>
            <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-amber-950/90 text-amber-300 border border-amber-700/60 ml-0.5">
              ⏳ Cần duyệt lại
            </span>
          </button>
        </div>
      </div>

      {/* Search, Filter Tabs & View Mode Switcher */}
      <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
            placeholder="Tìm theo tên sản phẩm, handle, ASIN..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/90 pl-10 pr-8 py-2 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 shadow-inner"
          />
          <span className="absolute left-3.5 top-2.5 text-slate-500 text-xs">🔍</span>
          {filter.searchQuery && (
            <button
              type="button"
              onClick={() => onFilterChange({ searchQuery: "" })}
              className="absolute right-3 top-2.5 text-slate-500 hover:text-slate-300 text-xs"
            >
              ✕
            </button>
          )}
        </div>

        {/* View Mode Switcher + Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Review Status Tabs */}
          <div className="flex items-center rounded-xl bg-slate-900/90 p-1 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => onFilterChange({ decisionFilter: "all" })}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer ${
                filter.decisionFilter === "all"
                  ? "bg-slate-800 text-cyan-400 font-semibold shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              Tất cả ({totalCount})
            </button>
            <button
              type="button"
              onClick={() => onFilterChange({ decisionFilter: "pending" })}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                filter.decisionFilter === "pending"
                  ? "bg-amber-950/80 text-amber-300 font-semibold shadow-sm border border-amber-800/40"
                  : "text-slate-400 hover:text-amber-300"
              }`}
            >
              <span>Chờ duyệt</span>
              <span className="text-[10px] opacity-80">({pendingCount})</span>
            </button>
            <button
              type="button"
              onClick={() => onFilterChange({ decisionFilter: "approved" })}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                filter.decisionFilter === "approved"
                  ? "bg-emerald-950/80 text-emerald-300 font-semibold shadow-sm border border-emerald-800/40"
                  : "text-slate-400 hover:text-emerald-300"
              }`}
            >
              <span>Đã duyệt</span>
              <span className="text-[10px] opacity-80">({approvedCount})</span>
            </button>
            <button
              type="button"
              onClick={() => onFilterChange({ decisionFilter: "rejected" })}
              className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                filter.decisionFilter === "rejected"
                  ? "bg-rose-950/80 text-rose-300 font-semibold shadow-sm border border-rose-800/40"
                  : "text-slate-400 hover:text-rose-300"
              }`}
            >
              <span>Từ chối</span>
              <span className="text-[10px] opacity-80">({rejectedCount})</span>
            </button>
            {syncFailedCount > 0 && (
              <button
                type="button"
                onClick={() => onFilterChange({ decisionFilter: "sync_failed" })}
                className={`px-2.5 py-1 rounded-lg font-medium transition cursor-pointer flex items-center gap-1 ${
                  filter.decisionFilter === "sync_failed"
                    ? "bg-rose-900/90 text-rose-200 font-bold shadow-sm border border-rose-600"
                    : "text-rose-400 hover:text-rose-200"
                }`}
                title="Lọc các sản phẩm gặp lỗi khi đẩy lên Shopify"
              >
                <span>⚠️ Lỗi đẩy</span>
                <span className="text-[10px] opacity-90">({syncFailedCount})</span>
              </button>
            )}
          </div>

          {/* View Mode Toggle: Cards vs Table vs Split */}
          <div className="flex items-center rounded-xl bg-slate-900/90 p-1 border border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => onViewModeChange("cards")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                viewMode === "cards"
                  ? "bg-cyan-600 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Dạng thẻ chi tiết (Review cuộn liên tục)"
            >
              <span>🗂️</span>
              <span>Dạng thẻ</span>
            </button>

            <button
              type="button"
              onClick={() => onViewModeChange("table")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                viewMode === "table"
                  ? "bg-cyan-600 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Bảng dữ liệu mở rộng"
            >
              <span>📋</span>
              <span>Bảng mở rộng</span>
            </button>

            <button
              type="button"
              onClick={() => onViewModeChange("split")}
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg font-medium transition cursor-pointer ${
                viewMode === "split"
                  ? "bg-cyan-600 text-white font-semibold shadow-sm"
                  : "text-slate-400 hover:text-slate-200"
              }`}
              title="Chia đôi màn hình (Inspector nhanh)"
            >
              <span>🖥️</span>
              <span>Chia màn hình</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sub-toolbar: Filters, Expand all (for table), and Batch Operations */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/50 px-4 py-2 text-xs">
        {/* Left: Selection summary and Expand/Collapse for Table view */}
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-slate-400 font-mono">
            {selectedCount > 0 ? (
              <span className="text-cyan-400 font-semibold">
                Đã chọn {selectedCount}/{filteredCount !== undefined ? filteredCount : totalCount} sản phẩm
              </span>
            ) : filteredCount !== undefined && filteredCount !== totalCount ? (
              <span>
                Hiển thị <strong className="text-cyan-400 font-semibold">{filteredCount}</strong> / {totalCount} sản phẩm
              </span>
            ) : (
              <span>Tổng cộng: {totalCount} sản phẩm</span>
            )}
          </span>

          <div className="h-3.5 w-px bg-slate-800" />

          <button
            type="button"
            onClick={onSelectAll}
            className="text-slate-400 hover:text-cyan-400 transition cursor-pointer font-medium"
          >
            Chọn tất cả
          </button>

          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              Bỏ chọn
            </button>
          )}

          {/* Expand/Collapse All for Table View */}
          {viewMode === "table" && onToggleExpandAll && totalCount > 0 && (
            <>
              <div className="h-3.5 w-px bg-slate-800" />
              <button
                type="button"
                onClick={onToggleExpandAll}
                className="inline-flex items-center gap-1 text-cyan-400 hover:text-cyan-300 transition cursor-pointer font-medium"
              >
                <span>{isAllExpanded ? "▲ Thu gọn tất cả hàng" : "▼ Mở rộng tất cả hàng"}</span>
              </button>
            </>
          )}

          {/* Only Mock toggle */}
          <div className="h-3.5 w-px bg-slate-800" />
          <label className="inline-flex items-center gap-1.5 text-slate-300 cursor-pointer hover:text-slate-200">
            <input
              type="checkbox"
              checked={filter.onlyMockData}
              onChange={(e) => onFilterChange({ onlyMockData: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-[11px] font-medium text-amber-400/90">Chưa đủ dữ liệu</span>
          </label>
        </div>

        {/* Right: Batch Actions */}
        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={onApproveSelected}
                disabled={isSyncing || isReverting}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                  isSyncing || isReverting
                    ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                    : "bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 cursor-pointer"
                }`}
              >
                {isSyncing ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Đang sync ({selectedCount})...</span>
                  </>
                ) : (
                  <>
                    <span>✓ Duyệt ({selectedCount})</span>
                  </>
                )}
              </button>

              {/* Nút Hoàn tác hàng loạt */}
              {canRollbackCount > 0 && onRollbackSelected && (
                <button
                  type="button"
                  onClick={onRollbackSelected}
                  disabled={isSyncing || isReverting}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold transition ${
                    isReverting
                      ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                      : isSyncing
                        ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                        : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer shadow-sm shadow-amber-950/40"
                  }`}
                  title="Hoàn tác các sản phẩm đã chọn về dữ liệu gốc và đồng bộ lên Shopify"
                >
                  {isReverting ? (
                    <>
                      <svg className="animate-spin h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      <span>Đang hoàn tác ({canRollbackCount})...</span>
                    </>
                  ) : (
                    <>
                      <span>↩ Hoàn tác ({canRollbackCount})</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={onRejectSelected}
                disabled={isSyncing || isReverting}
                className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg font-semibold transition ${
                  isSyncing || isReverting
                    ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                    : "bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/30 cursor-pointer"
                }`}
              >
                ✕ Từ chối ({selectedCount})
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onSyncAllApproved}
            disabled={approvedUnsyncedCount === 0 || isSyncing || isReverting}
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-500/40 bg-cyan-600 px-3 py-1.5 font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:border-slate-700 disabled:bg-slate-800 disabled:text-slate-500"
          >
            🛍️ Sync tất cả đã duyệt ({approvedUnsyncedCount})
          </button>

          <button
            type="button"
            onClick={onExportApprovedJson}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 transition cursor-pointer"
          >
            📥 Xuất JSON đã duyệt
          </button>

          {totalCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              title="Xóa toàn bộ danh sách sản phẩm"
              className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-900/60 transition cursor-pointer flex items-center gap-1"
            >
              <span>🗑️</span>
              <span>Xóa</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
