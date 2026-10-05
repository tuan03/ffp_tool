import type { BenchmarkProductItem } from "../../types";
import { formatPercent, formatPositionChange, formatPp, getStatusBadge } from "../presentation";

interface BenchmarkTableProps {
  readonly items: readonly BenchmarkProductItem[];
  readonly loading?: boolean;
  readonly sortBy?: string;
  readonly sortDir?: "asc" | "desc";
  readonly onSort?: (column: string) => void;
  readonly onSelectProduct: (product: BenchmarkProductItem) => void;
  readonly onSelectBatch?: (batchId: string) => void;
  readonly onSendToAutoSeo?: (product: BenchmarkProductItem) => void;
}

export function BenchmarkTable({
  items,
  loading = false,
  sortBy,
  sortDir = "desc",
  onSort,
  onSelectProduct,
  onSelectBatch,
  onSendToAutoSeo,
}: BenchmarkTableProps): React.JSX.Element {
  const renderSortIndicator = (column: string): React.JSX.Element | null => {
    if (sortBy !== column) return null;
    return <span className="ml-1 text-cyan-400">{sortDir === "asc" ? "▲" : "▼"}</span>;
  };

  const headerButton = (column: string, title: string) => (
    <button
      type="button"
      onClick={() => onSort?.(column)}
      className="inline-flex items-center text-xs font-semibold text-slate-300 transition hover:text-cyan-300"
    >
      {title}
      {renderSortIndicator(column)}
    </button>
  );

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="border-b border-slate-800 bg-slate-950/80 text-xs uppercase tracking-wider text-slate-400">
            <tr>
              {/* 1. Product (Sticky Left) */}
              <th scope="col" className="sticky left-0 z-20 bg-slate-950 px-4 py-3 min-w-[240px]">
                {headerButton("title", "Sản phẩm (Product)")}
              </th>

              {/* 2. Current Version */}
              <th scope="col" className="px-3 py-3 min-w-[120px]">
                Phiên bản
              </th>

              {/* 3. SEO Age */}
              <th scope="col" className="px-3 py-3 min-w-[100px] text-right">
                {headerButton("age", "SEO Age")}
              </th>

              {/* 4. Clicks Δ */}
              <th scope="col" className="px-3 py-3 min-w-[120px] text-right">
                {headerButton("clicks", "Clicks Δ")}
              </th>

              {/* 5. Impressions Δ */}
              <th scope="col" className="px-3 py-3 min-w-[130px] text-right">
                {headerButton("impressions", "Impressions Δ")}
              </th>

              {/* 6. CTR Δ */}
              <th scope="col" className="px-3 py-3 min-w-[120px] text-right">
                {headerButton("ctr", "CTR Δ")}
              </th>

              {/* 7. Position Δ */}
              <th scope="col" className="px-3 py-3 min-w-[130px] text-right">
                {headerButton("position", "Position Δ")}
              </th>

              {/* 8. Queries Δ */}
              <th scope="col" className="px-3 py-3 min-w-[110px] text-right">
                {headerButton("queries", "Queries Δ")}
              </th>

              {/* 9. Organic Sessions Δ */}
              <th scope="col" className="px-3 py-3 min-w-[140px] text-right">
                {headerButton("sessions", "Organic Sessions Δ")}
              </th>

              {/* 10. Status */}
              <th scope="col" className="px-3 py-3 min-w-[150px]">
                {headerButton("status", "Trạng thái")}
              </th>

              {/* 11. Action (Sticky Right) */}
              <th scope="col" className="sticky right-0 z-20 bg-slate-950 px-4 py-3 min-w-[130px] text-center">
                Hành động
              </th>
            </tr>
          </thead>

          <tbody className="divide-y divide-slate-800/80">
            {loading ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-cyan-400 border-t-transparent" />
                    <span>Đang tính toán benchmark và nạp dữ liệu...</span>
                  </div>
                </td>
              </tr>
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={11} className="p-8 text-center text-slate-400">
                  Không tìm thấy sản phẩm nào phù hợp với bộ lọc hiện tại.
                </td>
              </tr>
            ) : (
              items.map(item => {
                const badge = getStatusBadge(
                  item.status.performanceStatus,
                  item.status.measurementStatus,
                  item.status.technicalFlags,
                );

                return (
                  <tr key={item.productId} className="group transition hover:bg-slate-800/40">
                    {/* 1. Product (Sticky Left) */}
                    <td className="sticky left-0 z-10 bg-slate-900 px-4 py-3 group-hover:bg-slate-850">
                      <div className="flex items-center gap-3">
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt=""
                            className="h-10 w-10 shrink-0 rounded object-cover border border-slate-700"
                            loading="lazy"
                          />
                        ) : (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-800 text-xs text-slate-500">
                            No img
                          </div>
                        )}
                        <div className="min-w-0">
                          <button
                            type="button"
                            onClick={() => onSelectProduct(item)}
                            className="truncate text-left font-medium text-slate-100 transition hover:text-cyan-300 hover:underline focus:outline-none"
                            title={item.title}
                          >
                            {item.title}
                          </button>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                            <span className="truncate max-w-[160px]" title={item.url}>
                              {item.url.replace(/^https?:\/\/[^/]+/, "")}
                            </span>
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noreferrer"
                              className="text-cyan-400 hover:text-cyan-200"
                              title="Mở storefront"
                            >
                              ↗
                            </a>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* 2. Current Version */}
                    <td className="px-3 py-3">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                            item.currentVersion === "v0"
                              ? "bg-slate-800 text-slate-300 border border-slate-700"
                              : "bg-cyan-950 text-cyan-300 border border-cyan-800"
                          }`}
                        >
                          {item.currentVersion}
                        </span>
                        {item.hasExternalDrift && (
                          <span
                            className="rounded bg-amber-950/80 px-1.5 py-0.2 text-[10px] text-amber-300 border border-amber-800"
                            title="Nội dung trên storefront đã bị thay đổi ngoài snapshot"
                          >
                            External Drift
                          </span>
                        )}
                        {item.batchId && (
                          <button
                            type="button"
                            onClick={() => onSelectBatch?.(item.batchId!)}
                            className="text-[11px] text-indigo-400 hover:underline"
                            title={`Xem batch: ${item.batchId}`}
                          >
                            {item.batchId}
                          </button>
                        )}
                      </div>
                    </td>

                    {/* 3. SEO Age */}
                    <td className="px-3 py-3 text-right">
                      {item.seoAge != null ? (
                        <div>
                          <span className="font-semibold text-slate-200">{item.seoAge}d</span>
                          <div className="text-[11px] text-slate-500">
                            {item.coverageDays}/{item.targetDays}d
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    {/* 4. Clicks Δ */}
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-slate-100">
                        {item.clicks.after.toLocaleString("vi-VN")}
                      </div>
                      <div className="text-xs">
                        {item.clicks.isNewActivity ? (
                          <span className="text-cyan-300">New activity</span>
                        ) : item.clicks.deltaAbsolute != null ? (
                          <span
                            className={
                              item.clicks.deltaAbsolute > 0
                                ? "text-emerald-400"
                                : item.clicks.deltaAbsolute < 0
                                  ? "text-rose-400"
                                  : "text-slate-400"
                            }
                          >
                            {item.clicks.deltaAbsolute > 0 ? "+" : ""}
                            {item.clicks.deltaAbsolute} ({formatPercent(item.clicks.deltaPercent)})
                          </span>
                        ) : (
                          <span className="text-slate-500">Δ —</span>
                        )}
                      </div>
                    </td>

                    {/* 5. Impressions Δ */}
                    <td className="px-3 py-3 text-right">
                      <div className="font-bold text-slate-100">
                        {item.impressions.after.toLocaleString("vi-VN")}
                      </div>
                      <div className="text-xs">
                        {item.impressions.deltaAbsolute != null ? (
                          <span
                            className={
                              item.impressions.deltaAbsolute > 0
                                ? "text-emerald-400"
                                : item.impressions.deltaAbsolute < 0
                                  ? "text-rose-400"
                                  : "text-slate-400"
                            }
                          >
                            {item.impressions.deltaAbsolute > 0 ? "+" : ""}
                            {item.impressions.deltaAbsolute.toLocaleString("vi-VN")} (
                            {formatPercent(item.impressions.deltaPercent)})
                          </span>
                        ) : (
                          <span className="text-slate-500">Δ —</span>
                        )}
                      </div>
                    </td>

                    {/* 6. CTR Δ */}
                    <td className="px-3 py-3 text-right">
                      <div className="font-semibold text-slate-200">
                        {item.ctr.after != null ? `${(item.ctr.after * 100).toFixed(2)}%` : "—"}
                      </div>
                      <div className="text-xs">
                        {item.ctr.deltaPercentagePoints != null ? (
                          <span
                            className={
                              item.ctr.deltaPercentagePoints > 0
                                ? "text-emerald-400"
                                : item.ctr.deltaPercentagePoints < 0
                                  ? "text-rose-400"
                                  : "text-slate-400"
                            }
                          >
                            {formatPp(item.ctr.deltaPercentagePoints)}
                          </span>
                        ) : (
                          <span className="text-slate-500">Δ —</span>
                        )}
                      </div>
                    </td>

                    {/* 7. Position Δ */}
                    <td className="px-3 py-3 text-right">
                      {item.position.after != null ? (
                        <div>
                          <div className="text-xs text-slate-300">
                            {item.position.before != null
                              ? `${item.position.before.toFixed(1)} → ${item.position.after.toFixed(1)}`
                              : item.position.after.toFixed(1)}
                          </div>
                          <div className="text-xs">
                            {item.position.improvement != null ? (
                              <span
                                className={
                                  item.position.improvement > 0
                                    ? "text-emerald-400 font-medium"
                                    : item.position.improvement < 0
                                      ? "text-rose-400 font-medium"
                                      : "text-slate-400"
                                }
                              >
                                {item.position.improvement > 0 ? "+" : ""}
                                {item.position.improvement.toFixed(1)} bậc
                              </span>
                            ) : (
                              <span className="text-slate-500">Δ —</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>

                    {/* 8. Queries Δ */}
                    <td className="px-3 py-3 text-right">
                      <div className="font-semibold text-slate-200">{item.queries.afterCount}</div>
                      <div className="text-xs">
                        {item.queries.delta != null ? (
                          <span
                            className={
                              item.queries.delta > 0
                                ? "text-emerald-400"
                                : item.queries.delta < 0
                                  ? "text-rose-400"
                                  : "text-slate-400"
                            }
                            title={`Mới: +${item.queries.newlyObserved} · Mất: -${item.queries.noLongerObserved} · Trùng khớp: ${item.queries.matchedCount}`}
                          >
                            {item.queries.delta > 0 ? "+" : ""}
                            {item.queries.delta}
                          </span>
                        ) : (
                          <span className="text-slate-500">Δ —</span>
                        )}
                      </div>
                    </td>

                    {/* 9. Organic Sessions Δ (GA4) */}
                    <td className="px-3 py-3 text-right">
                      {item.organicSessions.isGscQueryFilterApplied ? (
                        <span
                          className="text-[11px] text-amber-400 italic"
                          title="GSC query filter is not supported by this GA4 report"
                        >
                          N/A (Query filter)
                        </span>
                      ) : item.organicSessions.after != null ? (
                        <div>
                          <div className="font-semibold text-slate-200">
                            {item.organicSessions.after.toLocaleString("vi-VN")}
                          </div>
                          <div className="text-xs">
                            {item.organicSessions.deltaAbsolute != null ? (
                              <span
                                className={
                                  item.organicSessions.deltaAbsolute > 0
                                    ? "text-emerald-400"
                                    : item.organicSessions.deltaAbsolute < 0
                                      ? "text-rose-400"
                                      : "text-slate-400"
                                }
                              >
                                {item.organicSessions.deltaAbsolute > 0 ? "+" : ""}
                                {item.organicSessions.deltaAbsolute} (
                                {formatPercent(item.organicSessions.deltaPercent)})
                              </span>
                            ) : (
                              <span className="text-slate-500">Δ —</span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <span className="text-slate-500">Δ —</span>
                      )}
                    </td>

                    {/* 10. Status */}
                    <td className="px-3 py-3">
                      <span
                        className={`inline-block rounded-full border px-2.5 py-1 text-xs font-medium ${badge.className}`}
                        title={item.status.reason || badge.description}
                      >
                        {badge.label}
                      </span>
                    </td>

                    {/* 11. Action (Sticky Right) */}
                    <td className="sticky right-0 z-10 bg-slate-900 px-4 py-3 text-center group-hover:bg-slate-850">
                      {item.action.type === "SEND_TO_AUTO_SEO" ? (
                        <button
                          type="button"
                          onClick={() => onSendToAutoSeo?.(item)}
                          disabled={!item.action.enabled}
                          className="rounded-lg border border-cyan-500 bg-cyan-950/60 px-2.5 py-1.5 text-xs font-semibold text-cyan-300 transition hover:bg-cyan-900 disabled:opacity-40"
                          title={item.action.disabledReason ?? "Tạo draft yêu cầu Auto-SEO qua checkpoint"}
                        >
                          Send to Auto-SEO
                        </button>
                      ) : item.action.type === "AUTO_SEO" ? (
                        <button
                          type="button"
                          onClick={() => onSelectProduct(item)}
                          className="rounded-lg border border-indigo-500 bg-indigo-950/60 px-2.5 py-1.5 text-xs font-semibold text-indigo-300 transition hover:bg-indigo-900"
                        >
                          Tạo Auto-SEO
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSelectProduct(item)}
                          className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
                        >
                          {item.action.label}
                        </button>
                      )}
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
