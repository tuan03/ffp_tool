import type { BenchmarkSummaryKpis } from "../../types";
import { formatPercent, formatPositionChange, formatPp } from "../presentation";

interface BenchmarkKpisProps {
  readonly kpis: BenchmarkSummaryKpis;
  readonly isQueryFilterActive?: boolean;
  readonly onStatusSelect?: (status: string) => void;
}

export function BenchmarkKpis({ kpis, isQueryFilterActive = false, onStatusSelect }: BenchmarkKpisProps): React.JSX.Element {
  const cohort = kpis.cohortTotals;

  return (
    <div className="space-y-4">
      {/* Management KPIs */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-600">
          Chỉ số quản lý sản phẩm
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Tổng sản phẩm</span>
            <div className="mt-1 text-xl font-bold text-slate-900">{kpis.totalManaged}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("v0")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("v0")}
            className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300"
          >
            <span className="text-xs text-slate-600">Chưa SEO (v0)</span>
            <div className="mt-1 text-xl font-bold text-slate-700">{kpis.v0Count}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Đã SEO (v1+)</span>
            <div className="mt-1 text-xl font-bold text-blue-700">{kpis.seoVersionCount}</div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Đủ điều kiện</span>
            <div className="mt-1 text-xl font-bold text-blue-700">
              {kpis.eligibleCount}
              <span className="text-xs font-normal text-slate-500"> / {kpis.totalManaged}</span>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("IMPROVING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("IMPROVING")}
            className="cursor-pointer rounded-lg border border-emerald-200 bg-emerald-50 p-3 transition hover:border-emerald-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-emerald-300"
          >
            <span className="text-xs text-emerald-700">Tăng trưởng</span>
            <div className="mt-1 text-xl font-bold text-emerald-700">+{kpis.improvingCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("STABLE")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("STABLE")}
            className="cursor-pointer rounded-lg border border-slate-200 bg-slate-50 p-3 transition hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300"
          >
            <span className="text-xs text-slate-600">Ổn định / Khác chiều</span>
            <div className="mt-1 text-xl font-bold text-slate-900">{kpis.stableOrMixedCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("DECLINING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("DECLINING")}
            className="cursor-pointer rounded-lg border border-rose-200 bg-rose-50 p-3 transition hover:border-rose-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-rose-300"
          >
            <span className="text-xs text-rose-700">Suy giảm</span>
            <div className="mt-1 text-xl font-bold text-rose-700">{kpis.decliningCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("COLLECTING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("COLLECTING")}
            className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 p-3 transition hover:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300"
          >
            <span className="text-xs text-blue-700">Đang thu thập</span>
            <div className="mt-1 text-xl font-bold text-blue-700">{kpis.collectingOrInsufficientCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("TECHNICAL_REVIEW")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("TECHNICAL_REVIEW")}
            className="cursor-pointer rounded-lg border border-blue-200 bg-blue-50 p-3 transition hover:border-blue-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300"
          >
            <span className="text-xs text-blue-700">Cần rà soát kỹ thuật</span>
            <div className="mt-1 text-xl font-bold text-blue-700">{kpis.technicalIssuesCount}</div>
          </div>
        </div>
      </div>

      {/* Cohort Performance KPIs */}
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-900">Hiệu quả Cohort đủ điều kiện</h3>
            <p className="mt-0.5 text-xs text-slate-600">
              Tổng hợp cho {kpis.eligibleCount} sản phẩm có đủ 2 cửa sổ đối chứng Before & After. CTR tính bằng tỷ lệ tổng; Position tính bằng trọng số Impressions.
            </p>
          </div>
          <span className="rounded bg-slate-50 px-2.5 py-1 text-xs text-slate-700">
            Aligned per-version cohort
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Clicks */}
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Tổng Clicks</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{cohort.afterClicks.toLocaleString("vi-VN")}</span>
              <span
                className={`text-xs font-semibold ${
                  cohort.clicksDeltaAbsolute > 0
                    ? "text-emerald-700"
                    : cohort.clicksDeltaAbsolute < 0
                      ? "text-rose-700"
                      : "text-slate-600"
                }`}
              >
                {cohort.clicksDeltaAbsolute > 0 ? "+" : ""}
                {cohort.clicksDeltaAbsolute} ({formatPercent(cohort.clicksDeltaPercent)})
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Kỳ trước: {cohort.beforeClicks.toLocaleString("vi-VN")}
            </div>
          </div>

          {/* Impressions */}
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Tổng Impressions</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">{cohort.afterImpressions.toLocaleString("vi-VN")}</span>
              <span
                className={`text-xs font-semibold ${
                  cohort.impressionsDeltaAbsolute > 0
                    ? "text-emerald-700"
                    : cohort.impressionsDeltaAbsolute < 0
                      ? "text-rose-700"
                      : "text-slate-600"
                }`}
              >
                {cohort.impressionsDeltaAbsolute > 0 ? "+" : ""}
                {cohort.impressionsDeltaAbsolute} ({formatPercent(cohort.impressionsDeltaPercent)})
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Kỳ trước: {cohort.beforeImpressions.toLocaleString("vi-VN")}
            </div>
          </div>

          {/* CTR */}
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-xs text-slate-600">CTR trung bình</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {cohort.afterCtr != null ? `${(cohort.afterCtr * 100).toFixed(2)}%` : "—"}
              </span>
              <span
                className={`text-xs font-semibold ${
                  (cohort.ctrDeltaPp ?? 0) > 0
                    ? "text-emerald-700"
                    : (cohort.ctrDeltaPp ?? 0) < 0
                      ? "text-rose-700"
                      : "text-slate-600"
                }`}
              >
                {formatPp(cohort.ctrDeltaPp)}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Kỳ trước: {cohort.beforeCtr != null ? `${(cohort.beforeCtr * 100).toFixed(2)}%` : "—"}
            </div>
          </div>

          {/* Position */}
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Vị trí trung bình</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900">
                {cohort.afterPosition != null ? cohort.afterPosition.toFixed(1) : "—"}
              </span>
              <span
                className={`text-xs font-semibold ${
                  (cohort.positionImprovement ?? 0) > 0
                    ? "text-emerald-700"
                    : (cohort.positionImprovement ?? 0) < 0
                      ? "text-rose-700"
                      : "text-slate-600"
                }`}
              >
                {(cohort.positionImprovement ?? 0) > 0 ? "+" : ""}
                {cohort.positionImprovement != null ? `${cohort.positionImprovement.toFixed(1)} bậc` : "—"}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              {formatPositionChange(cohort.beforePosition, cohort.afterPosition).text}
            </div>
          </div>

          {/* Organic Sessions */}
          <div className="rounded-lg bg-slate-50 p-3">
            <span className="text-xs text-slate-600">Google Organic Sessions</span>
            {isQueryFilterActive || cohort.isGscQueryFilterApplied ? (
              <div className="mt-1">
                <span
                  className="text-sm font-semibold text-amber-700 italic"
                  title="GSC query filter is not supported by this GA4 report (Rule 12.7: từ khóa GSC không liên kết trực tiếp với phiên/user trong GA4)"
                >
                  N/A (Query filter)
                </span>
                <div className="mt-1 text-[11px] text-slate-500">
                  Không khả dụng khi lọc query GSC
                </div>
              </div>
            ) : (
              <>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-slate-900">
                    {cohort.afterOrganicSessions != null ? cohort.afterOrganicSessions.toLocaleString("vi-VN") : "—"}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      (cohort.organicSessionsDelta ?? 0) > 0
                        ? "text-emerald-700"
                        : (cohort.organicSessionsDelta ?? 0) < 0
                          ? "text-rose-700"
                          : "text-slate-600"
                    }`}
                  >
                    {(cohort.organicSessionsDelta ?? 0) > 0 ? "+" : ""}
                    {cohort.organicSessionsDelta ?? "—"}
                  </span>
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Kỳ trước: {cohort.beforeOrganicSessions != null ? cohort.beforeOrganicSessions.toLocaleString("vi-VN") : "—"}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
