import type { BatchDetailData, BenchmarkProductItem } from "../../types";
import { displayDate, formatPercent, formatPositionChange, formatPp, getStatusBadge } from "../presentation";

interface BatchDetailModalProps {
  readonly data: BatchDetailData;
  readonly onClose: () => void;
  readonly onSelectProduct?: (product: BenchmarkProductItem) => void;
}

export function BatchDetailModal({
  data,
  onClose,
  onSelectProduct,
}: BatchDetailModalProps): React.JSX.Element {
  const cohort = data.cohortTotals;
  const dist = data.statusDistribution;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="batch-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-50 dark:bg-slate-800 p-4 backdrop-blur-sm"
    >
      <div className="flex h-full max-h-[90vh] w-full max-w-4xl flex-col rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-4 sm:p-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="rounded bg-blue-50 dark:bg-blue-950/60 px-2 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                Auto-SEO Batch
              </span>
              <span className="text-xs text-slate-600 dark:text-slate-400">Store: {data.storeId}</span>
            </div>
            <h2 id="batch-modal-title" className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100 sm:text-xl">
              Chi tiết nhóm sản phẩm: {data.batchId}
            </h2>
            <div className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Thực hiện: {displayDate(data.executedAt)} · Mô hình: <strong>{data.modelName ?? "—"}</strong> · Prompt: <strong>{data.promptVersion ?? "—"}</strong>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
          {/* Summary counters */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5 text-center text-xs">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <span className="text-slate-600 dark:text-slate-400">Tổng sản phẩm</span>
              <div className="mt-1 text-xl font-bold text-slate-900 dark:text-slate-100">{data.totalProducts}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <span className="text-slate-600 dark:text-slate-400">Thành công</span>
              <div className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-300">{data.succeededCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <span className="text-slate-600 dark:text-slate-400">Không đổi</span>
              <div className="mt-1 text-xl font-bold text-slate-600 dark:text-slate-400">{data.noChangeCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <span className="text-slate-600 dark:text-slate-400">Lỗi / Thất bại</span>
              <div className="mt-1 text-xl font-bold text-rose-700 dark:text-rose-300">{data.failedCount}</div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3">
              <span className="text-slate-600 dark:text-slate-400">Đủ điều kiện đối chứng</span>
              <div className="mt-1 text-xl font-bold text-blue-700 dark:text-blue-300">{data.eligibleCount}</div>
            </div>
          </div>

          {/* Cohort Totals Before vs After */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Hiệu quả Cohort trong Batch</h3>
            <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
              Tổng hợp cho {data.eligibleCount} sản phẩm đã có đủ dữ liệu đối chứng Before & After.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-center text-xs">
              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <span className="text-slate-600 dark:text-slate-400">Tổng Clicks</span>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{cohort.afterClicks}</div>
                <div className="text-emerald-700 dark:text-emerald-300">
                  {cohort.clicksDeltaAbsolute > 0 ? "+" : ""}{cohort.clicksDeltaAbsolute} ({formatPercent(cohort.clicksDeltaPercent)})
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <span className="text-slate-600 dark:text-slate-400">Tổng Impressions</span>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{cohort.afterImpressions}</div>
                <div className="text-emerald-700 dark:text-emerald-300">
                  {cohort.impressionsDeltaAbsolute > 0 ? "+" : ""}{cohort.impressionsDeltaAbsolute} ({formatPercent(cohort.impressionsDeltaPercent)})
                </div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <span className="text-slate-600 dark:text-slate-400">CTR trung bình</span>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{(cohort.afterCtr * 100).toFixed(2)}%</div>
                <div className="text-emerald-700 dark:text-emerald-300">{formatPp(cohort.ctrDeltaPp)}</div>
              </div>

              <div className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3">
                <span className="text-slate-600 dark:text-slate-400">Vị trí trung bình</span>
                <div className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{cohort.afterPosition.toFixed(1)}</div>
                <div className="text-emerald-700 dark:text-emerald-300">
                  {formatPositionChange(cohort.beforePosition, cohort.afterPosition).text}
                </div>
              </div>
            </div>
          </div>

          {/* Status Distribution */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Phân bố trạng thái sản phẩm</h3>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 text-xs">
              <div className="rounded bg-emerald-50 dark:bg-emerald-950/60 p-2 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                Tăng trưởng (Improving): <strong>{dist.improving}</strong>
              </div>
              <div className="rounded bg-slate-50 dark:bg-slate-800 p-2 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                Ổn định (Stable): <strong>{dist.stable}</strong>
              </div>
              <div className="rounded bg-amber-50 dark:bg-amber-950/60 p-2 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                Khác chiều (Mixed): <strong>{dist.mixed}</strong>
              </div>
              <div className="rounded bg-rose-50 dark:bg-rose-950/60 p-2 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                Suy giảm (Declining): <strong>{dist.declining}</strong>
              </div>
            </div>
          </div>

          {/* Model / Prompt Observational Note */}
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-4 text-xs text-blue-700 dark:text-blue-300">
            <h4 className="font-semibold text-blue-700 dark:text-blue-300">Ghi chú quan sát mô hình (Observational Note):</h4>
            <p className="mt-1 text-slate-700 dark:text-slate-300 leading-relaxed">{data.observationalNote}</p>
          </div>

          {/* Products in this batch */}
          <div>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Danh sách sản phẩm trong Batch</h3>
            <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden text-xs">
              {data.products.map(p => {
                const badge = getStatusBadge(p.status.performanceStatus, p.status.measurementStatus, p.status.technicalFlags);
                return (
                  <div key={p.productId} className="flex items-center justify-between p-3 hover:bg-slate-100 dark:hover:bg-slate-700">
                    <div className="min-w-0 flex-1 pr-3">
                      <button
                        type="button"
                        onClick={() => onSelectProduct?.(p)}
                        className="truncate text-left font-medium text-slate-900 dark:text-slate-100 hover:text-blue-700 dark:hover:text-blue-300 hover:underline"
                      >
                        {p.title}
                      </button>
                      <div className="mt-0.5 text-slate-500 dark:text-slate-400">{p.url}</div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="rounded bg-slate-50 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-300 font-mono">
                        {p.currentVersion}
                      </span>
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${badge.className}`}>
                        {badge.label}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
