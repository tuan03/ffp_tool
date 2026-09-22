import type { SeoReviewFilterState } from "../types";

export interface SeoBatchToolbarProps {
  readonly totalCount: number;
  readonly selectedCount: number;
  readonly filter: SeoReviewFilterState;
  readonly onFilterChange: (newFilter: Partial<SeoReviewFilterState>) => void;
  readonly onSelectAll: () => void;
  readonly onClearSelection: () => void;
  readonly onApproveSelected: () => void;
  readonly onRejectSelected: () => void;
  readonly onExportApprovedJson: () => void;
  readonly onClearAll: () => void;
}

export function SeoBatchToolbar({
  totalCount,
  selectedCount,
  filter,
  onFilterChange,
  onSelectAll,
  onClearSelection,
  onApproveSelected,
  onRejectSelected,
  onExportApprovedJson,
  onClearAll,
}: SeoBatchToolbarProps): React.JSX.Element {
  return (
    <div className="space-y-4">
      {/* Search and Filters Bar */}
      <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search input */}
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={filter.searchQuery}
            onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
            placeholder="Tìm theo tên sản phẩm, handle, ASIN..."
            className="w-full rounded-xl border border-slate-800 bg-slate-900/90 pl-10 pr-4 py-2.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 shadow-inner"
          />
          <span className="absolute left-3.5 top-3 text-slate-500 text-xs">🔍</span>
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

        {/* Filter controls */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={filter.statusFilter}
            onChange={(e) =>
              onFilterChange({
                statusFilter: e.target.value as SeoReviewFilterState["statusFilter"],
              })
            }
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none cursor-pointer"
          >
            <option value="all">Tất cả SEO Status</option>
            <option value="completed">Completed</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
          </select>

          {/* Decision Filter */}
          <select
            value={filter.decisionFilter}
            onChange={(e) =>
              onFilterChange({
                decisionFilter: e.target.value as SeoReviewFilterState["decisionFilter"],
              })
            }
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-300 focus:border-cyan-500 focus:outline-none cursor-pointer"
          >
            <option value="all">Tất cả Review Status</option>
            <option value="pending">Chờ review (Pending)</option>
            <option value="approved">Đã duyệt (Approved)</option>
            <option value="rejected">Từ chối (Rejected)</option>
          </select>

          {/* Only Mock toggle */}
          <label className="inline-flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900/60 px-3 py-2 text-xs text-slate-300 cursor-pointer hover:bg-slate-800/50">
            <input
              type="checkbox"
              checked={filter.onlyMockData}
              onChange={(e) => onFilterChange({ onlyMockData: e.target.checked })}
              className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="font-medium text-amber-400/90">Thiếu trường SEO</span>
          </label>

          {totalCount > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              title="Xóa toàn bộ danh sách sản phẩm"
              className="px-2.5 py-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-rose-400 hover:border-rose-900/60 text-xs transition cursor-pointer flex items-center gap-1.5"
            >
              <span>🗑️</span>
              <span>Xóa danh sách</span>
            </button>
          )}
        </div>
      </div>

      {/* Batch Operations Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-800/80 bg-slate-900/40 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-400 font-mono">
            {selectedCount > 0 ? (
              <span className="text-cyan-400 font-semibold">
                Đã chọn {selectedCount}/{totalCount} sản phẩm
              </span>
            ) : (
              <span>Tổng cộng: {totalCount} sản phẩm</span>
            )}
          </span>

          <div className="h-4 w-px bg-slate-800" />

          <button
            type="button"
            onClick={onSelectAll}
            className="text-xs text-slate-400 hover:text-cyan-400 transition cursor-pointer"
          >
            Chọn tất cả
          </button>

          {selectedCount > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="text-xs text-slate-500 hover:text-slate-300 transition cursor-pointer"
            >
              Bỏ chọn
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          {selectedCount > 0 && (
            <>
              <button
                type="button"
                onClick={onApproveSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/30 transition cursor-pointer"
              >
                ✓ Duyệt đã chọn ({selectedCount})
              </button>

              <button
                type="button"
                onClick={onRejectSelected}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-600/20 text-rose-300 hover:bg-rose-600/30 border border-rose-500/30 transition cursor-pointer"
              >
                ✕ Từ chối đã chọn ({selectedCount})
              </button>
            </>
          )}

          <button
            type="button"
            onClick={onExportApprovedJson}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 transition cursor-pointer"
          >
            📥 Xuất JSON đã duyệt
          </button>
        </div>
      </div>
    </div>
  );
}
