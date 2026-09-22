import { useMemo, useState } from "react";

import { crawlerProductToListItem } from "../../service";
import type { CrawlerError, CrawlerProduct, ProductCrawlerFilter } from "../../types";

interface CrawlerProductTableProps {
  products: CrawlerProduct[];
  selectedIds: string[];
  jobErrors?: CrawlerError[];
  jobWarnings?: string[];
  onRetryFailed?(failedIds?: string[]): void;
  onToggleSelect(id: string): void;
  onToggleSelectAll(filteredIds: string[]): void;
  onClearSelection(): void;
  onViewDetail(product: CrawlerProduct): void;
  onOpenHandoff(): void;
}

export function CrawlerProductTable({
  products,
  selectedIds,
  jobErrors,
  jobWarnings,
  onRetryFailed,
  onToggleSelect,
  onToggleSelectAll,
  onClearSelection,
  onViewDetail,
  onOpenHandoff,
}: CrawlerProductTableProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState("");
  const [filter, setFilter] = useState<ProductCrawlerFilter>("all");
  const [isOnlySelected, setIsOnlySelected] = useState(false);

  const listItems = useMemo(() => {
    return products.map((p) => ({
      raw: p,
      projected: crawlerProductToListItem(p),
    }));
  }, [products]);

  const filteredItems = useMemo(() => {
    return listItems.filter(({ raw, projected }) => {
      if (isOnlySelected && !selectedIds.includes(raw.id)) {
        return false;
      }

      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchTitle = projected.title.toLowerCase().includes(q);
        const matchAsin = projected.asin?.toLowerCase().includes(q);
        if (!matchTitle && !matchAsin) {
          return false;
        }
      }

      // Category filter
      switch (filter) {
        case "success":
          return projected.status === "success";
        case "partial":
          return projected.status === "partial";
        case "has_customization":
          return projected.hasCustomization;
        case "no_customization":
          return !projected.hasCustomization;
        case "has_warning":
          return projected.warningCount > 0;
        case "all":
        default:
          return true;
      }
    });
  }, [listItems, searchQuery, filter, isOnlySelected, selectedIds]);

  const filteredIds = filteredItems.map((item) => item.raw.id);
  const isAllFilteredSelected =
    filteredIds.length > 0 && filteredIds.every((id) => selectedIds.includes(id));
  const isSomeFilteredSelected =
    filteredIds.some((id) => selectedIds.includes(id)) && !isAllFilteredSelected;

  const totalVariants = products.reduce((acc, p) => acc + p.variants.length, 0);

  return (
    <div className="space-y-4">
      {/* Job-level Errors Alert Banner (Section 18) */}
      {jobErrors && jobErrors.length > 0 && (
        <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-4 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
              <span>⚠️</span>
              <span>Crawl Failed — Phát hiện {jobErrors.length} mục cào không thành công:</span>
            </div>
            {onRetryFailed && (
              <button
                type="button"
                onClick={() =>
                  onRetryFailed(
                    jobErrors
                      .map((e) => e.input || e.productId || "")
                      .filter(Boolean),
                  )
                }
                className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-semibold text-white hover:bg-rose-500 transition shadow-sm"
              >
                ↻ Thử lại mục lỗi
              </button>
            )}
          </div>
          <div className="space-y-1.5">
            {jobErrors.map((err, i) => (
              <div
                key={i}
                className="flex flex-wrap items-center justify-between rounded-lg bg-rose-950/70 p-2.5 text-xs border border-rose-900/60"
              >
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-rose-200">
                    {err.input || err.productId || "ASIN"}
                  </span>
                  <span className="text-slate-300">— Lý do: {err.message}</span>
                </div>
                <span className="font-mono text-[10px] text-rose-400">Mã: {err.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Warnings banner */}
      {jobWarnings && jobWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-800/60 bg-amber-950/30 p-3 text-xs text-amber-200 flex items-center gap-2">
          <span>⚠️</span>
          <span>{jobWarnings.join("; ")}</span>
        </div>
      )}

      {/* Top Results Metrics & Summary */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4">
        <div className="flex items-center gap-4 text-xs">
          <div>
            <span className="text-slate-400">Tổng sản phẩm:</span>{" "}
            <strong className="text-slate-100 font-mono text-sm">{products.length}</strong>
          </div>
          <div className="h-4 w-px bg-slate-800" />
          <div>
            <span className="text-slate-400">Tổng biến thể:</span>{" "}
            <strong className="text-cyan-400 font-mono text-sm">{totalVariants}</strong>
          </div>
          <div className="h-4 w-px bg-slate-800" />
          <div>
            <span className="text-slate-400">Có tùy biến:</span>{" "}
            <strong className="text-emerald-400 font-mono text-sm">
              {products.filter((p) => Boolean(p.customization)).length}
            </strong>
          </div>
        </div>

        {/* Search bar */}
        <div className="relative w-full sm:w-64">
          <input
            type="text"
            placeholder="Tìm theo tiêu đề hoặc ASIN..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1.5 text-slate-400 hover:text-white text-xs"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Filter Tabs & Selection Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
          <span className="text-slate-500 mr-1 text-[11px]">Lọc:</span>
          {[
            { id: "all", label: `Tất cả (${products.length})` },
            {
              id: "success",
              label: `Thành công (${listItems.filter((i) => i.projected.status === "success").length})`,
            },
            {
              id: "partial",
              label: `Cần rà soát (${listItems.filter((i) => i.projected.status === "partial").length})`,
            },
            {
              id: "has_warning",
              label: `Có cảnh báo (${listItems.filter((i) => i.projected.warningCount > 0).length})`,
            },
            {
              id: "has_customization",
              label: `Có Customize (${listItems.filter((i) => i.projected.hasCustomization).length})`,
            },
            {
              id: "no_customization",
              label: `Không Customize (${listItems.filter((i) => !i.projected.hasCustomization).length})`,
            },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id as ProductCrawlerFilter)}
              className={`rounded-lg px-2.5 py-1 transition ${
                filter === tab.id
                  ? "bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold"
                  : "bg-slate-900 text-slate-400 border border-slate-800 hover:bg-slate-800 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Selection Actions (Section 13) */}
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">
            Đã chọn: <strong className="text-cyan-400 font-mono">{selectedIds.length}</strong> / {products.length}
          </span>

          <button
            type="button"
            onClick={() => onToggleSelectAll(filteredIds)}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 transition"
          >
            Chọn tất cả
          </button>

          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={onClearSelection}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-300 hover:bg-slate-700 transition"
            >
              Bỏ chọn
            </button>
          )}

          {selectedIds.length > 0 && (
            <button
              type="button"
              onClick={() => setIsOnlySelected(!isOnlySelected)}
              className={`rounded px-2 py-1 transition border ${
                isOnlySelected
                  ? "bg-cyan-950 border-cyan-700 text-cyan-300 font-semibold"
                  : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {isOnlySelected ? "✓ Đang xem mục đã chọn" : "👁️ Xem mục đã chọn"}
            </button>
          )}

          <button
            type="button"
            disabled={selectedIds.length === 0}
            onClick={onOpenHandoff}
            className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-3 py-1 font-bold text-slate-950 shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
          >
            <span>🚀 Bàn giao {selectedIds.length} mục sang SEO</span>
          </button>
        </div>
      </div>

      {/* Main Table */}
      <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-slate-800 bg-slate-950/80 font-semibold text-slate-300">
            <tr>
              <th className="w-10 p-3 text-center">
                <input
                  type="checkbox"
                  checked={isAllFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = isSomeFilteredSelected;
                  }}
                  onChange={() => onToggleSelectAll(filteredIds)}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500"
                  aria-label="Chọn tất cả sản phẩm đang lọc"
                />
              </th>
              <th className="w-16 p-3">Ảnh</th>
              <th className="p-3">Sản phẩm</th>
              <th className="w-28 p-3">ASIN</th>
              <th className="w-24 p-3 text-center">Biến thể</th>
              <th className="w-32 p-3 text-center">Tùy biến</th>
              <th className="w-24 p-3 text-center">Cảnh báo</th>
              <th className="w-28 p-3 text-center">Trạng thái</th>
              <th className="w-24 p-3 text-right">Thao tác</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/60 text-slate-300">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={9} className="p-8 text-center text-slate-500 italic">
                  Không tìm thấy sản phẩm nào khớp với điều kiện lọc.
                </td>
              </tr>
            ) : (
              filteredItems.map(({ raw, projected }) => {
                const isSelected = selectedIds.includes(raw.id);

                return (
                  <tr
                    key={raw.id}
                    className={`transition hover:bg-slate-800/40 ${
                      isSelected ? "bg-cyan-950/20" : ""
                    }`}
                  >
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(raw.id)}
                        className="rounded border-slate-700 text-cyan-500 focus:ring-cyan-500"
                        aria-label={`Chọn sản phẩm ${projected.title}`}
                      />
                    </td>

                    <td className="p-3">
                      <div className="h-12 w-12 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center">
                        {projected.thumbnailUrl ? (
                          <img
                            src={projected.thumbnailUrl}
                            alt={projected.title}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-slate-600 text-xs">No img</span>
                        )}
                      </div>
                    </td>

                    <td className="p-3 max-w-xs sm:max-w-md">
                      <div className="font-medium text-slate-100 line-clamp-2 leading-relaxed">
                        {projected.title}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                        <a
                          href={raw.canonicalUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-cyan-400 hover:underline flex items-center gap-1"
                        >
                          <span>Amazon Link ↗</span>
                        </a>
                        {raw.productDetails?.Brand && (
                          <span className="text-slate-500">• Hãng: {raw.productDetails.Brand}</span>
                        )}
                      </div>
                    </td>

                    <td className="p-3 font-mono text-[11px] text-slate-300 font-semibold">
                      {projected.asin}
                    </td>

                    <td className="p-3 text-center">
                      <span className="rounded bg-slate-800 px-2 py-0.5 font-mono text-[11px] font-bold text-cyan-300">
                        {projected.variantCount}
                      </span>
                    </td>

                    <td className="p-3 text-center">
                      {projected.hasCustomization ? (
                        <span className="inline-flex items-center gap-1 rounded bg-emerald-950/80 border border-emerald-800/80 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                          <span>🟢</span> Có
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded bg-slate-800 px-2 py-0.5 text-[10px] text-slate-400">
                          <span>⚪</span> Không
                        </span>
                      )}
                    </td>

                    <td className="p-3 text-center">
                      {projected.warningCount > 0 ? (
                        <span className="inline-flex items-center rounded bg-amber-950/80 border border-amber-800/80 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                          ⚠️ {projected.warningCount}
                        </span>
                      ) : (
                        <span className="text-slate-600 text-xs">—</span>
                      )}
                    </td>

                    <td className="p-3 text-center">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                          projected.status === "success"
                            ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                            : projected.status === "partial"
                              ? "bg-amber-950 text-amber-300 border border-amber-800"
                              : "bg-rose-950 text-rose-300 border border-rose-800"
                        }`}
                      >
                        {projected.status}
                      </span>
                    </td>

                    <td className="p-3 text-right">
                      <button
                        type="button"
                        onClick={() => onViewDetail(raw)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-slate-700 hover:text-white transition"
                      >
                        Chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
