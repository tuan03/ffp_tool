import type React from "react";

export interface BenchmarkPaginationProps {
  readonly total: number;
  readonly offset: number;
  readonly limit: number;
  readonly onChange: (newOffset: number, newLimit?: number) => void;
  readonly isLoading?: boolean;
}

export function BenchmarkPagination({
  total,
  offset,
  limit,
  onChange,
  isLoading = false,
}: BenchmarkPaginationProps): React.JSX.Element | null {
  const pageSize = limit > 0 ? limit : 50;
  const currentPage = Math.floor(offset / pageSize) + 1;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (total <= 0) return null;

  const startRecord = offset + 1;
  const endRecord = Math.min(offset + pageSize, total);

  // Generate page numbers with ellipsis
  const getPageNumbers = (): (number | "...")[] => {
    if (totalPages <= 7) {
      return Array.from({ length: totalPages }, (_, i) => i + 1);
    }
    if (currentPage <= 4) {
      return [1, 2, 3, 4, 5, "...", totalPages];
    }
    if (currentPage >= totalPages - 3) {
      return [1, "...", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
    }
    return [1, "...", currentPage - 1, currentPage, currentPage + 1, "...", totalPages];
  };

  const pages = getPageNumbers();

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-4 sm:flex-row sm:items-center sm:justify-between text-xs text-slate-300">
      {/* Left: Summary and Page Size */}
      <div className="flex flex-wrap items-center gap-3">
        <span>
          Hiển thị <strong className="text-white">{startRecord}</strong> – <strong className="text-white">{endRecord}</strong> trên tổng số <strong className="text-cyan-400">{total}</strong> sản phẩm
        </span>
        <label className="flex items-center gap-1.5 text-slate-400">
          <span>Kích thước trang:</span>
          <select
            aria-label="Số sản phẩm mỗi trang"
            value={pageSize}
            disabled={isLoading}
            onChange={e => onChange(0, Number(e.target.value))}
            className="rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 transition focus:border-cyan-500 focus:outline-none"
          >
            <option value={25}>25 / trang</option>
            <option value={50}>50 / trang</option>
            <option value={100}>100 / trang</option>
          </select>
        </label>
      </div>

      {/* Right: Pagination Controls */}
      <nav aria-label="Phân trang danh sách sản phẩm" className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Trang trước"
          disabled={currentPage <= 1 || isLoading}
          onClick={() => onChange(Math.max(0, offset - pageSize))}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          ◀ Trước
        </button>

        {pages.map((p, index) => {
          if (p === "...") {
            return (
              <span key={`ellipsis-${index}`} className="px-2 py-1 text-slate-500 select-none">
                ...
              </span>
            );
          }
          const isActive = p === currentPage;
          return (
            <button
              key={p}
              type="button"
              aria-label={`Trang ${p}`}
              aria-current={isActive ? "page" : undefined}
              disabled={isLoading}
              onClick={() => onChange((p - 1) * pageSize)}
              className={`min-w-[32px] rounded-lg border px-2.5 py-1.5 font-semibold transition ${
                isActive
                  ? "border-cyan-500 bg-cyan-600 text-white shadow-sm"
                  : "border-slate-700 bg-slate-900 text-slate-300 hover:border-slate-500 hover:bg-slate-800 hover:text-white"
              } disabled:cursor-not-allowed disabled:opacity-50`}
            >
              {p}
            </button>
          );
        })}

        <button
          type="button"
          aria-label="Trang sau"
          disabled={currentPage >= totalPages || isLoading}
          onClick={() => onChange(offset + pageSize)}
          className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 font-medium text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          Sau ▶
        </button>
      </nav>
    </div>
  );
}
