import type { BenchmarkSummaryKpis } from "../../types";
import { formatPercent, formatPositionChange, formatPp } from "../presentation";

interface BenchmarkKpisProps {
  readonly kpis: BenchmarkSummaryKpis;
  readonly onStatusSelect?: (status: string) => void;
}

export function BenchmarkKpis({ kpis, onStatusSelect }: BenchmarkKpisProps): React.JSX.Element {
  const cohort = kpis.cohortTotals;

  return (
    <div className="space-y-4">
      {/* Management KPIs */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Chỉ số quản lý sản phẩm
        </h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-9">
          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-xs text-slate-400">Tổng sản phẩm</span>
            <div className="mt-1 text-xl font-bold text-slate-100">{kpis.totalManaged}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("v0")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("v0")}
            className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <span className="text-xs text-slate-400">Chưa SEO (v0)</span>
            <div className="mt-1 text-xl font-bold text-slate-300">{kpis.v0Count}</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-xs text-slate-400">Đã SEO (v1+)</span>
            <div className="mt-1 text-xl font-bold text-cyan-300">{kpis.seoVersionCount}</div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
            <span className="text-xs text-slate-400">Đủ điều kiện</span>
            <div className="mt-1 text-xl font-bold text-indigo-300">
              {kpis.eligibleCount}
              <span className="text-xs font-normal text-slate-500"> / {kpis.totalManaged}</span>
            </div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("IMPROVING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("IMPROVING")}
            className="cursor-pointer rounded-xl border border-emerald-950/60 bg-emerald-950/20 p-3 transition hover:border-emerald-700 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          >
            <span className="text-xs text-emerald-400">Tăng trưởng</span>
            <div className="mt-1 text-xl font-bold text-emerald-300">+{kpis.improvingCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("STABLE")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("STABLE")}
            className="cursor-pointer rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition hover:border-slate-600 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          >
            <span className="text-xs text-slate-400">Ổn định / Khác chiều</span>
            <div className="mt-1 text-xl font-bold text-slate-200">{kpis.stableOrMixedCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("DECLINING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("DECLINING")}
            className="cursor-pointer rounded-xl border border-rose-950/60 bg-rose-950/20 p-3 transition hover:border-rose-700 focus:outline-none focus:ring-1 focus:ring-rose-500"
          >
            <span className="text-xs text-rose-400">Suy giảm</span>
            <div className="mt-1 text-xl font-bold text-rose-300">{kpis.decliningCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("COLLECTING")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("COLLECTING")}
            className="cursor-pointer rounded-xl border border-sky-950/60 bg-sky-950/20 p-3 transition hover:border-sky-700 focus:outline-none focus:ring-1 focus:ring-sky-500"
          >
            <span className="text-xs text-sky-400">Đang thu thập</span>
            <div className="mt-1 text-xl font-bold text-sky-300">{kpis.collectingOrInsufficientCount}</div>
          </div>

          <div
            role="button"
            tabIndex={0}
            onClick={() => onStatusSelect?.("TECHNICAL_REVIEW")}
            onKeyDown={e => (e.key === "Enter" || e.key === " ") && onStatusSelect?.("TECHNICAL_REVIEW")}
            className="cursor-pointer rounded-xl border border-purple-950/60 bg-purple-950/20 p-3 transition hover:border-purple-700 focus:outline-none focus:ring-1 focus:ring-purple-500"
          >
            <span className="text-xs text-purple-400">Cần rà soát kỹ thuật</span>
            <div className="mt-1 text-xl font-bold text-purple-300">{kpis.technicalIssuesCount}</div>
          </div>
        </div>
      </div>

      {/* Cohort Performance KPIs */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
          <div>
            <h3 className="text-sm font-semibold text-slate-200">Hiệu quả Cohort đủ điều kiện</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              Tổng hợp cho {kpis.eligibleCount} sản phẩm có đủ 2 cửa sổ đối chứng Before & After. CTR tính bằng tỷ lệ tổng; Position tính bằng trọng số Impressions.
            </p>
          </div>
          <span className="rounded bg-slate-800 px-2.5 py-1 text-xs text-slate-300">
            Aligned per-version cohort
          </span>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {/* Clicks */}
          <div className="rounded-lg bg-slate-950/50 p-3">
            <span className="text-xs text-slate-400">Tổng Clicks</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">{cohort.afterClicks.toLocaleString("vi-VN")}</span>
              <span
                className={`text-xs font-semibold ${
                  cohort.clicksDeltaAbsolute > 0
                    ? "text-emerald-400"
                    : cohort.clicksDeltaAbsolute < 0
                      ? "text-rose-400"
                      : "text-slate-400"
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
          <div className="rounded-lg bg-slate-950/50 p-3">
            <span className="text-xs text-slate-400">Tổng Impressions</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">{cohort.afterImpressions.toLocaleString("vi-VN")}</span>
              <span
                className={`text-xs font-semibold ${
                  cohort.impressionsDeltaAbsolute > 0
                    ? "text-emerald-400"
                    : cohort.impressionsDeltaAbsolute < 0
                      ? "text-rose-400"
                      : "text-slate-400"
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
          <div className="rounded-lg bg-slate-950/50 p-3">
            <span className="text-xs text-slate-400">CTR trung bình</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">
                {cohort.afterCtr != null ? `${(cohort.afterCtr * 100).toFixed(2)}%` : "—"}
              </span>
              <span
                className={`text-xs font-semibold ${
                  (cohort.ctrDeltaPp ?? 0) > 0
                    ? "text-emerald-400"
                    : (cohort.ctrDeltaPp ?? 0) < 0
                      ? "text-rose-400"
                      : "text-slate-400"
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
          <div className="rounded-lg bg-slate-950/50 p-3">
            <span className="text-xs text-slate-400">Vị trí trung bình</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">
                {cohort.afterPosition != null ? cohort.afterPosition.toFixed(1) : "—"}
              </span>
              <span
                className={`text-xs font-semibold ${
                  (cohort.positionImprovement ?? 0) > 0
                    ? "text-emerald-400"
                    : (cohort.positionImprovement ?? 0) < 0
                      ? "text-rose-400"
                      : "text-slate-400"
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
          <div className="rounded-lg bg-slate-950/50 p-3">
            <span className="text-xs text-slate-400">Google Organic Sessions</span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-100">
                {cohort.afterOrganicSessions != null ? cohort.afterOrganicSessions.toLocaleString("vi-VN") : "—"}
              </span>
              <span
                className={`text-xs font-semibold ${
                  (cohort.organicSessionsDelta ?? 0) > 0
                    ? "text-emerald-400"
                    : (cohort.organicSessionsDelta ?? 0) < 0
                      ? "text-rose-400"
                      : "text-slate-400"
                }`}
              >
                {(cohort.organicSessionsDelta ?? 0) > 0 ? "+" : ""}
                {cohort.organicSessionsDelta ?? "—"}
              </span>
            </div>
            <div className="mt-1 text-xs text-slate-500">
              Kỳ trước: {cohort.beforeOrganicSessions != null ? cohort.beforeOrganicSessions.toLocaleString("vi-VN") : "—"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
