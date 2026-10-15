import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { ConnectionsSyncData } from "../../types";
import { displayDate, JOB_LABELS } from "../presentation";

interface ConnectionsSyncViewProps {
  readonly data: ConnectionsSyncData;
  readonly storeId: string;
  readonly onSyncGsc: () => Promise<void>;
  readonly onSyncGa4: () => Promise<void>;
  readonly onMapGa4: (input: { readonly propertyId: string; readonly hostnameScope?: string; readonly streamId?: string; readonly timeZone?: string; readonly currencyCode?: string }) => Promise<void>;
  readonly onBackfill: (source: "gsc" | "ga4", days: number) => Promise<void>;
  readonly onCrawlWebsite: () => Promise<void>;
  readonly onReconnect: () => Promise<void>;
}

export function ConnectionsSyncView({
  data,
  storeId,
  onSyncGsc,
  onSyncGa4,
  onMapGa4,
  onBackfill,
  onCrawlWebsite,
  onReconnect,
}: ConnectionsSyncViewProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backfillDays, setBackfillDays] = useState<number>(28);
  const [showGa4Form, setShowGa4Form] = useState(false);
  const [ga4PropertyId, setGa4PropertyId] = useState(data.ga4.propertyId ?? "");
  const [ga4Hostname, setGa4Hostname] = useState(data.ga4.hostnameScope ?? "");

  const runAction = async (task: () => Promise<void>, successText: string) => {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      await task();
      setMessage(successText);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thao tác thất bại.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Kết nối & Đồng bộ Dữ liệu (Connections & Sync)</h2>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Quản lý kết nối Google Search Console, Google Analytics 4, quyền truy cập API, mức độ hoàn tất dữ liệu và tác vụ Backfill cho cửa hàng <strong className="text-blue-700 dark:text-blue-300">{storeId}</strong>.
        </p>
      </div>

      {message && (
        <div role="status" className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 p-3 text-xs text-emerald-700 dark:text-emerald-300">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-3 text-xs text-rose-700 dark:text-rose-300">
          {error}
        </div>
      )}

      {/* Main Connection Cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* GOOGLE SEARCH CONSOLE */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">Google Search Console</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  data.gsc.status === "CONNECTED"
                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                    : data.gsc.status === "ERROR" || data.gsc.status === "PERMISSION_DENIED"
                    ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                    : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                }`}
              >
                {data.gsc.status}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(onReconnect, "Đang chuyển hướng kết nối lại Google...")}
              className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 hover:text-slate-900 dark:hover:text-slate-100 transition shadow-sm disabled:opacity-40"
            >
              <AppIcon name="arrow" /> Kết nối lại Google
            </button>
          </div>

          <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">GSC Property:</span>
              <code className="text-blue-700 dark:text-blue-300">{data.gsc.property ?? "Chưa cấu hình"}</code>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Storefront Origin:</span>
              <span className="text-slate-900 dark:text-slate-100">{data.gsc.origin ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Trạng thái dữ liệu:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.gsc.staleReason === "NEVER_SYNCED"
                  ? "Chưa đồng bộ"
                  : data.gsc.stale
                  ? "Dữ liệu cũ (cần đồng bộ lại)"
                  : "Mới nhất"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Dữ liệu hoàn tất tới:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {data.gsc.staleReason === "NEVER_SYNCED" || !data.gsc.dataThroughDate
                  ? "Chưa có"
                  : data.gsc.dataThroughDate}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Đồng bộ thành công gần nhất:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.gsc.staleReason === "NEVER_SYNCED" || !data.gsc.lastSuccessfulSync
                  ? "Chưa đồng bộ"
                  : displayDate(data.gsc.lastSuccessfulSync)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Hạn mức API Quota:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.gsc.quota ? `${data.gsc.quota.used} / ${data.gsc.quota.limit} requests` : "Bình thường"}
              </span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400">Quyền Scopes đã cấp:</span>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs text-slate-600 dark:text-slate-400 font-mono">
                {data.gsc.grantedScopes.map(scope => (
                  <li key={scope} className="truncate" title={scope}>
                    {scope.replace("https://www.googleapis.com/auth/", "")}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Actions for GSC */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(onSyncGsc, "Đã yêu cầu đồng bộ Google Search Console.")}
              className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 disabled:opacity-40"
            >
              Đồng bộ GSC ngay
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <select
                aria-label="Số ngày backfill GSC"
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                value={backfillDays}
                onChange={e => setBackfillDays(Number(e.target.value))}
              >
                <option value="7">7 ngày</option>
                <option value="14">14 ngày</option>
                <option value="28">28 ngày</option>
                <option value="90">90 ngày</option>
              </select>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => onBackfill("gsc", backfillDays), `Đã khởi động Backfill GSC ${backfillDays} ngày.`)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
              >
                Backfill GSC
              </button>
            </div>
          </div>
        </div>

        {/* GOOGLE ANALYTICS 4 */}
        <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 whitespace-nowrap">Google Analytics 4</span>
              <span
                className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                  data.ga4.status === "CONNECTED"
                    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                    : data.ga4.status === "ERROR" || data.ga4.status === "PERMISSION_DENIED"
                    ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                    : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                }`}
              >
                {data.ga4.status}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => setShowGa4Form(v => !v)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition shadow-sm disabled:opacity-40"
              >
                <AppIcon name="settings" /> {showGa4Form ? "Đóng cấu hình" : "Cấu hình GA4"}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(onReconnect, "Đang chuyển hướng kết nối lại Google...")}
                className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 hover:text-slate-900 dark:hover:text-slate-100 transition shadow-sm disabled:opacity-40"
              >
                <AppIcon name="arrow" /> Kết nối lại Google
              </button>
            </div>
          </div>

          {showGa4Form && (
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 p-3 space-y-3">
              <div className="text-xs font-semibold text-blue-700 dark:text-blue-300">Cấu hình Google Analytics 4 (GA4)</div>
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                    GA4 Property ID (chỉ gồm số, ví dụ 549055707):
                  </label>
                  <input
                    type="text"
                    value={ga4PropertyId}
                    onChange={e => setGa4PropertyId(e.target.value)}
                    placeholder="549055707"
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                  />
                </div>
                <div>
                  <label className="block text-xs text-slate-600 dark:text-slate-400 mb-1">
                    Hostname Scope (tên miền đo lường):
                  </label>
                  <input
                    type="text"
                    value={ga4Hostname}
                    onChange={e => setGa4Hostname(e.target.value)}
                    placeholder="jeminise.com"
                    className="w-full rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowGa4Form(false)}
                  className="rounded px-2.5 py-1 text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
                >
                  Hủy
                </button>
                <button
                  type="button"
                  disabled={busy || !ga4PropertyId.trim()}
                  onClick={() =>
                    runAction(
                      async () => {
                        await onMapGa4({
                          propertyId: ga4PropertyId.trim(),
                          hostnameScope: ga4Hostname.trim() || undefined,
                        });
                        setShowGa4Form(false);
                      },
                      "Đã lưu cấu hình GA4 thành công.",
                    )
                  }
                  className="rounded bg-blue-600 px-3 py-1 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-40"
                >
                  Lưu cấu hình
                </button>
              </div>
            </div>
          )}

          <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">GA4 Property ID:</span>
              <code className="text-blue-700 dark:text-blue-300">{data.ga4.propertyId ?? "Chưa cấu hình"}</code>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Stream ID:</span>
              <span className="text-slate-900 dark:text-slate-100">{data.ga4.streamId ?? "Web"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Hostname Scope:</span>
              <span className="text-slate-900 dark:text-slate-100">{data.ga4.hostnameScope ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Múi giờ & Tiền tệ:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.ga4.timezone ?? "—"} · {data.ga4.currency ?? "USD"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Trạng thái dữ liệu:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.ga4.staleReason === "NEVER_SYNCED"
                  ? "Chưa đồng bộ"
                  : data.ga4.stale
                  ? "Dữ liệu cũ (cần đồng bộ lại)"
                  : "Mới nhất"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Dữ liệu hoàn tất tới:</span>
              <span className="font-semibold text-slate-900 dark:text-slate-100">
                {data.ga4.staleReason === "NEVER_SYNCED" || !data.ga4.dataThroughDate
                  ? "Chưa có"
                  : data.ga4.dataThroughDate}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-200 dark:border-slate-700">
              <span className="text-slate-600 dark:text-slate-400">Đồng bộ thành công gần nhất:</span>
              <span className="text-slate-900 dark:text-slate-100">
                {data.ga4.staleReason === "NEVER_SYNCED" || !data.ga4.lastSuccessfulSync
                  ? "Chưa đồng bộ"
                  : displayDate(data.ga4.lastSuccessfulSync)}
              </span>
            </div>
            <div>
              <span className="text-slate-600 dark:text-slate-400">Quyền Scopes đã cấp:</span>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-xs text-slate-600 dark:text-slate-400 font-mono">
                {data.ga4.grantedScopes.map(scope => (
                  <li key={scope} className="truncate" title={scope}>
                    {scope.replace("https://www.googleapis.com/auth/", "")}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Actions for GA4 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-700">
            <button
              type="button"
              disabled={busy || !data.ga4.propertyId || data.ga4.status === "NOT_CONFIGURED"}
              onClick={() => runAction(onSyncGa4, "Đã yêu cầu đồng bộ Google Analytics 4.")}
              className="rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/80 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Đồng bộ GA4 ngay
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                disabled={busy || !data.ga4.propertyId || data.ga4.status === "NOT_CONFIGURED"}
                onClick={() => runAction(() => onBackfill("ga4", backfillDays), `Đã khởi động Backfill GA4 ${backfillDays} ngày.`)}
                className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Backfill GA4 ({backfillDays}d)
              </button>
            </div>
            {(!data.ga4.propertyId || data.ga4.status === "NOT_CONFIGURED") && (
              <p className="w-full text-xs text-amber-700 dark:text-amber-300 mt-1">
                <AppIcon name="warning" /> Vui lòng bấm <strong>Cấu hình GA4</strong> để lưu Property ID trước khi đồng bộ.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Website Inspection / Crawl Banner */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Kiểm tra website (Audit & URL Inspection)</h3>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
            Thu thập bằng chứng HTML công khai (tối đa 1.000 URL/lần). Không sửa đổi hay xóa bất kỳ sản phẩm nào trên storefront.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => runAction(onCrawlWebsite, "Đã yêu cầu kiểm tra website (tối đa 1.000 URL/lần).")}
          className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-medium text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40"
        >
          Bắt đầu kiểm tra website
        </button>
      </div>

      {/* Recent Sync Jobs */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Lịch sử tác vụ đồng bộ gần đây (Recent Jobs)</h3>
        <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
            <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-2.5">Loại tác vụ</th>
                <th className="px-4 py-2.5">Trạng thái</th>
                <th className="px-4 py-2.5 text-right">Tiến độ</th>
                <th className="px-4 py-2.5">Thời gian cập nhật</th>
                <th className="px-4 py-2.5">Chi tiết / Lỗi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {data.recentJobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-100 dark:hover:bg-slate-700">
                  <td className="px-4 py-2.5 font-medium text-slate-900 dark:text-slate-100">
                    {JOB_LABELS[job.kind] ?? job.kind}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-semibold ${
                        job.status === "done"
                          ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                          : job.status === "failed"
                            ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                            : "bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800"
                      }`}
                    >
                      {JOB_LABELS[job.status] ?? job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{job.progress}%</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{displayDate(job.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-slate-600 dark:text-slate-400">{job.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
