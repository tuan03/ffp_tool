import { useState } from "react";
import type { ConnectionsSyncData } from "../../types";
import { displayDate, JOB_LABELS } from "../presentation";

interface ConnectionsSyncViewProps {
  readonly data: ConnectionsSyncData;
  readonly storeId: string;
  readonly onSyncGsc: () => Promise<void>;
  readonly onSyncGa4: () => Promise<void>;
  readonly onBackfill: (source: "gsc" | "ga4", days: number) => Promise<void>;
  readonly onCrawlWebsite: () => Promise<void>;
  readonly onReconnect: () => Promise<void>;
}

export function ConnectionsSyncView({
  data,
  storeId,
  onSyncGsc,
  onSyncGa4,
  onBackfill,
  onCrawlWebsite,
  onReconnect,
}: ConnectionsSyncViewProps): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [backfillDays, setBackfillDays] = useState<number>(28);

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
        <h2 className="text-lg font-bold text-slate-100">Kết nối & Đồng bộ Dữ liệu (Connections & Sync)</h2>
        <p className="mt-1 text-sm text-slate-400">
          Quản lý kết nối Google Search Console, Google Analytics 4, quyền truy cập API, mức độ hoàn tất dữ liệu và tác vụ Backfill cho cửa hàng <strong className="text-cyan-300">{storeId}</strong>.
        </p>
      </div>

      {message && (
        <div role="status" className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-3 text-xs text-emerald-300">
          {message}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-rose-800 bg-rose-950/40 p-3 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Main Connection Cards */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* GOOGLE SEARCH CONSOLE */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-100">Google Search Console</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  data.gsc.status === "CONNECTED" && !data.gsc.stale
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    : "bg-amber-950 text-amber-300 border border-amber-800"
                }`}
              >
                {data.gsc.status}
              </span>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(onReconnect, "Đang chuyển hướng kết nối lại Google...")}
              className="text-xs text-cyan-400 hover:underline"
            >
              Kết nối lại
            </button>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">GSC Property:</span>
              <code className="text-cyan-300">{data.gsc.property ?? "Chưa cấu hình"}</code>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Storefront Origin:</span>
              <span className="text-slate-200">{data.gsc.origin ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Dữ liệu hoàn tất tới:</span>
              <span className="font-semibold text-slate-200">{data.gsc.dataThroughDate ?? "Chưa có"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Đồng bộ thành công gần nhất:</span>
              <span className="text-slate-200">{displayDate(data.gsc.lastSuccessfulSync)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Hạn mức API Quota:</span>
              <span className="text-slate-200">
                {data.gsc.quota ? `${data.gsc.quota.used} / ${data.gsc.quota.limit} requests` : "Bình thường"}
              </span>
            </div>
            <div>
              <span className="text-slate-400">Quyền Scopes đã cấp:</span>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px] text-slate-400 font-mono">
                {data.gsc.grantedScopes.map(scope => (
                  <li key={scope} className="truncate" title={scope}>
                    {scope.replace("https://www.googleapis.com/auth/", "")}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Actions for GSC */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(onSyncGsc, "Đã yêu cầu đồng bộ Google Search Console.")}
              className="rounded-lg border border-cyan-500 bg-cyan-950/60 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900 disabled:opacity-40"
            >
              Đồng bộ GSC ngay
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <select
                aria-label="Số ngày backfill GSC"
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-xs text-slate-200"
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
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Backfill GSC
              </button>
            </div>
          </div>
        </div>

        {/* GOOGLE ANALYTICS 4 */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <span className="text-base font-bold text-slate-100">Google Analytics 4</span>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                  data.ga4.status === "CONNECTED" && !data.ga4.stale
                    ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                    : "bg-amber-950 text-amber-300 border border-amber-800"
                }`}
              >
                {data.ga4.status}
              </span>
            </div>
            <span className="text-xs text-slate-400">Stream: {data.ga4.streamId ?? "Web"}</span>
          </div>

          <div className="space-y-2 text-xs text-slate-300">
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">GA4 Property ID:</span>
              <code className="text-cyan-300">{data.ga4.propertyId ?? "Chưa cấu hình"}</code>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Hostname Scope:</span>
              <span className="text-slate-200">{data.ga4.hostnameScope ?? "—"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Múi giờ & Tiền tệ:</span>
              <span className="text-slate-200">
                {data.ga4.timezone ?? "—"} · {data.ga4.currency ?? "USD"}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Dữ liệu hoàn tất tới:</span>
              <span className="font-semibold text-slate-200">{data.ga4.dataThroughDate ?? "Chưa có"}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-slate-800/60">
              <span className="text-slate-400">Đồng bộ thành công gần nhất:</span>
              <span className="text-slate-200">{displayDate(data.ga4.lastSuccessfulSync)}</span>
            </div>
            <div>
              <span className="text-slate-400">Quyền Scopes đã cấp:</span>
              <ul className="mt-1 list-disc list-inside space-y-0.5 text-[11px] text-slate-400 font-mono">
                {data.ga4.grantedScopes.map(scope => (
                  <li key={scope} className="truncate" title={scope}>
                    {scope.replace("https://www.googleapis.com/auth/", "")}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Actions for GA4 */}
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              disabled={busy}
              onClick={() => runAction(onSyncGa4, "Đã yêu cầu đồng bộ Google Analytics 4.")}
              className="rounded-lg border border-cyan-500 bg-cyan-950/60 px-3 py-1.5 text-xs font-semibold text-cyan-300 hover:bg-cyan-900 disabled:opacity-40"
            >
              Đồng bộ GA4 ngay
            </button>
            <div className="flex items-center gap-1.5 ml-auto">
              <button
                type="button"
                disabled={busy}
                onClick={() => runAction(() => onBackfill("ga4", backfillDays), `Đã khởi động Backfill GA4 ${backfillDays} ngày.`)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
              >
                Backfill GA4 ({backfillDays}d)
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Website Inspection / Crawl Banner */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">Kiểm tra website (Audit & URL Inspection)</h3>
          <p className="mt-0.5 text-xs text-slate-400">
            Thu thập bằng chứng HTML công khai (tối đa 1.000 URL/lần). Không sửa đổi hay xóa bất kỳ sản phẩm nào trên storefront.
          </p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => runAction(onCrawlWebsite, "Đã yêu cầu kiểm tra website (tối đa 1.000 URL/lần).")}
          className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-700 disabled:opacity-40"
        >
          Bắt đầu kiểm tra website
        </button>
      </div>

      {/* Recent Sync Jobs */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold text-slate-200">Lịch sử tác vụ đồng bộ gần đây (Recent Jobs)</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-800">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/80 text-slate-400 uppercase">
              <tr>
                <th className="px-4 py-2.5">Loại tác vụ</th>
                <th className="px-4 py-2.5">Trạng thái</th>
                <th className="px-4 py-2.5 text-right">Tiến độ</th>
                <th className="px-4 py-2.5">Thời gian cập nhật</th>
                <th className="px-4 py-2.5">Chi tiết / Lỗi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {data.recentJobs.map(job => (
                <tr key={job.id} className="hover:bg-slate-850">
                  <td className="px-4 py-2.5 font-medium text-slate-200">
                    {JOB_LABELS[job.kind] ?? job.kind}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                        job.status === "done"
                          ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                          : job.status === "failed"
                            ? "bg-rose-950 text-rose-300 border border-rose-800"
                            : "bg-cyan-950 text-cyan-300 border border-cyan-800"
                      }`}
                    >
                      {JOB_LABELS[job.status] ?? job.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{job.progress}%</td>
                  <td className="px-4 py-2.5 text-slate-400">{displayDate(job.updatedAt)}</td>
                  <td className="px-4 py-2.5 text-slate-400">{job.error ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
