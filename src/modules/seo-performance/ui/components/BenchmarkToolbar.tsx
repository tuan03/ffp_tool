import type { BenchmarkComparisonMode, BenchmarkFilters, BenchmarkProductItem } from "../../types";
import { exportBenchmarkCsv } from "../presentation";

interface BenchmarkToolbarProps {
  readonly filters: BenchmarkFilters;
  readonly onChange: (filters: BenchmarkFilters) => void;
  readonly items: readonly BenchmarkProductItem[];
  readonly storeId: string;
}

const selectStyle = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 focus:outline-none";
const inputStyle = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none";

export function BenchmarkToolbar({
  filters,
  onChange,
  items,
  storeId,
}: BenchmarkToolbarProps): React.JSX.Element {
  const isQueryFilterActive = Boolean(filters.query && filters.query.trim().length > 0);

  const handleExportCsv = (): void => {
    exportBenchmarkCsv(items, storeId, filters.windowDays ?? 28);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      {/* Primary Toolbar Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          {/* Version Filter */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Phiên bản:</span>
            <select
              aria-label="Lọc phiên bản"
              className={selectStyle}
              value={filters.versionFilter ?? "all"}
              onChange={e => onChange({ ...filters, versionFilter: e.target.value as "all" | "v0" | "v1+", offset: 0 })}
            >
              <option value="all">Tất cả phiên bản</option>
              <option value="v1+">Đã làm SEO (v1+)</option>
              <option value="v0">Chưa làm SEO (v0 baseline)</option>
            </select>
          </label>

          {/* Comparison Mode */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Chế độ so sánh:</span>
            <select
              aria-label="Chế độ so sánh"
              className={selectStyle}
              value={filters.comparisonMode ?? "version"}
              onChange={e => onChange({ ...filters, comparisonMode: e.target.value as BenchmarkComparisonMode, offset: 0 })}
            >
              <option value="version">Version Comparison (vN vs vN-1)</option>
              <option value="calendar">Calendar Comparison (So sánh kỳ lịch)</option>
            </select>
          </label>

          {/* Window Days */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Cửa sổ đối chứng:</span>
            <select
              aria-label="Cửa sổ đối chứng"
              className={selectStyle}
              value={filters.windowDays ?? 28}
              onChange={e => onChange({ ...filters, windowDays: Number(e.target.value) as 7 | 14 | 28, offset: 0 })}
            >
              <option value="28">28 ngày (Chuẩn khuyến nghị)</option>
              <option value="14">14 ngày (Tín hiệu giữa kỳ)</option>
              <option value="7">7 ngày (Tín hiệu sớm)</option>
            </select>
          </label>

          {/* Status Filter */}
          <label className="flex items-center gap-1.5 text-xs text-slate-400">
            <span>Trạng thái:</span>
            <select
              aria-label="Lọc trạng thái"
              className={selectStyle}
              value={filters.statusFilter ?? ""}
              onChange={e => onChange({ ...filters, statusFilter: e.target.value, offset: 0 })}
            >
              <option value="">Tất cả trạng thái</option>
              <option value="IMPROVING">Tăng trưởng (Improving)</option>
              <option value="STABLE">Ổn định (Stable)</option>
              <option value="DECLINING">Suy giảm (Declining)</option>
              <option value="COLLECTING">Đang thu thập (Collecting)</option>
              <option value="BASELINE">Gốc (Baseline · v0)</option>
              <option value="TECHNICAL_REVIEW">Cần rà soát kỹ thuật</option>
              <option value="CONTENT_CHANGED">Thay đổi ngoài (External)</option>
            </select>
          </label>
        </div>

        {/* Action Controls */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-xs font-medium text-slate-200 transition hover:border-slate-500 hover:text-white"
          >
            <span>Xuất CSV ({items.length})</span>
          </button>
        </div>
      </div>

      {/* Secondary Search & GSC Query Filter */}
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <label className="flex flex-1 min-w-[200px] items-center gap-2">
          <span className="text-xs text-slate-400">Tìm kiếm:</span>
          <input
            type="text"
            className={`${inputStyle} w-full`}
            placeholder="Tìm theo tên sản phẩm hoặc đường dẫn URL..."
            value={filters.search ?? ""}
            onChange={e => onChange({ ...filters, search: e.target.value, offset: 0 })}
          />
        </label>

        <label className="flex flex-1 min-w-[200px] items-center gap-2">
          <span className="text-xs text-slate-400">GSC Query:</span>
          <input
            type="text"
            className={`${inputStyle} w-full`}
            placeholder="Lọc từ khóa tìm kiếm (GSC search query)..."
            value={filters.query ?? ""}
            onChange={e => onChange({ ...filters, query: e.target.value, offset: 0 })}
          />
        </label>

        {(filters.search || filters.query || filters.statusFilter || filters.versionFilter) && (
          <button
            type="button"
            onClick={() => onChange({ windowDays: filters.windowDays, comparisonMode: filters.comparisonMode, offset: 0 })}
            className="text-xs text-cyan-400 hover:underline"
          >
            Xóa bộ lọc
          </button>
        )}
      </div>

      {/* GSC Query Filter Warning Banner per Rule 12.7 */}
      {isQueryFilterActive && (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-amber-800/80 bg-amber-950/30 p-3 text-xs text-amber-300"
        >
          <span className="font-bold">⚠️ Cảnh báo giới hạn báo cáo:</span>
          <span>
            Bạn đang áp dụng bộ lọc GSC Query (<strong>&quot;{filters.query}&quot;</strong>). Query tìm kiếm chỉ có trong Google Search Console, GA4 không hỗ trợ nối từ khóa tới từng phiên người dùng. Cột <em>Organic Sessions Δ</em> của GA4 sẽ hiển thị thông báo <em>N/A</em> thay vì số liệu không tương thích.
          </span>
        </div>
      )}
    </div>
  );
}
