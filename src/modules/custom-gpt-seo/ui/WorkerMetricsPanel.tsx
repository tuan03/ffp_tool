import { useEffect, useState } from "react";
import type { CustomGptClient } from "../service";
import type { WorkerMetrics } from "../types";
import { describeWorkerActivity } from "./worker-metrics-presentation";

const percent = (value: number | null): string => value === null ? "Chưa đủ dữ liệu" : `${(value * 100).toFixed(1)}%`;
export function WorkerMetricsPanel({ client, storeId }: { readonly client: CustomGptClient; readonly storeId: string }): React.JSX.Element {
  const [hours, setHours] = useState(24);
  const [refresh, setRefresh] = useState(0);
  const [snapshot, setSnapshot] = useState<{ storeId: string; hours: number; report: WorkerMetrics } | null>(null);
  const [hasError, setHasError] = useState(false);
  useEffect(() => {
    let isActive = true;
    setSnapshot(null); setHasError(false);
    void client.workerMetrics(storeId, hours).then(report => { if (isActive) setSnapshot({ storeId, hours, report }); }).catch(() => { if (isActive) setHasError(true); });
    return () => { isActive = false; };
  }, [client, storeId, hours, refresh]);
  const report = snapshot?.storeId === storeId && snapshot.hours === hours ? snapshot.report : null;
  const cards = report ? [
    ["Còn chờ xử lý", report.queueDepth, "Số sản phẩm Codex chưa nhận"],
    ["Đã hoàn thành", report.successfulJobs, "Bản nháp đã vào SEO Review trong kỳ"],
    ["Tốc độ trung bình", `${report.jobsPerHour.toFixed(2)} sản phẩm/giờ`, "Tính trên khoảng thời gian đã chọn"],
    ["Một sản phẩm mất", report.averageProcessingMs === null ? "Chưa đủ dữ liệu" : `${(report.averageProcessingMs / 60000).toFixed(1)} phút`, "Gồm xử lý, kiểm tra và chuyển sang Review"],
  ] : [];
  const incidents = report ? [
    ["Phải xử lý lại", `${percent(report.retryRate)} (${report.retriedAttempts}/${report.attemptsStarted})`],
    ["Dừng hoặc không hoàn tất", `${percent(report.failureRate)} (${report.failedAttempts}/${report.attemptsEnded})`],
    ["Mất kết nối, trả lại hàng đợi", report.leaseExpirations],
    ["Bị giới hạn quota", report.quotaFailures],
    ["Token hết hạn", report.tokenExpirations],
    ["Đã chặn gửi kết quả trùng", report.duplicateSubmissionsPrevented],
    ["Đã chặn thao tác từ phiên cũ", report.staleLeaseRejections],
    ["Đã chặn vì dữ liệu sản phẩm đổi", report.staleSourceRejections],
  ] : [];
  const maximum = Math.max(1, ...(report?.series.map(bucket => bucket.completed) ?? []));
  return <section aria-label="Chỉ số vận hành Worker" className="space-y-4 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
    <div className="flex flex-wrap items-center gap-4"><div className="mr-auto"><h3 className="text-lg font-semibold text-blue-700 dark:text-blue-300">Hoạt động của Codex</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Theo dõi tiến độ xử lý SEO của store {storeId}.</p></div>
      <label className="flex items-center gap-2 text-sm">Xem trong<select className="rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-2" value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>24 giờ</option><option value={168}>7 ngày</option><option value={720}>30 ngày</option></select></label>
      <button type="button" className="rounded border border-slate-300 dark:border-slate-700 px-3 py-2 text-blue-700 dark:text-blue-300" onClick={() => setRefresh(value => value + 1)}>Làm mới</button>
    </div>
    {hasError ? <p role="alert" className="text-red-700 dark:text-red-300">Không tải được chỉ số. Kiểm tra quyền quản trị/kết nối và thử lại; dữ liệu cũ đã được ẩn.</p> : !report ? <p role="status">Đang tải chỉ số…</p> : <>
      <p className="text-sm text-slate-600 dark:text-slate-400">Cập nhật: {new Date(report.generatedAt).toLocaleString()}</p>
      <p className={`rounded-lg border p-3 text-sm ${report.failedAttempts || report.quotaFailures ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300" : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300"}`}>{describeWorkerActivity(report)}</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value, hint]) => <div key={label} className="rounded-lg border border-slate-300 dark:border-slate-700 p-3"><p className="text-sm text-slate-600 dark:text-slate-400">{label}</p><p className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">{value}</p><p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p></div>)}</div>
      <details className="rounded-lg border border-slate-200 dark:border-slate-700 p-3"><summary className="cursor-pointer text-sm text-blue-700 dark:text-blue-300">Chi tiết sự cố</summary>
      <div className="mt-3 divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700">{incidents.map(([label, value]) => <div key={label} className="flex items-center justify-between gap-4 px-3 py-2 text-sm"><span className="text-slate-600 dark:text-slate-400">{label}</span><strong className="text-slate-900 dark:text-slate-100">{value}</strong></div>)}</div>
      <p className="mt-3 text-sm text-slate-600 dark:text-slate-400">Chỉ tính Codex Worker; không gồm batch cũ, Gemini hoặc Custom GPT.</p>
      <p className="text-sm text-amber-700 dark:text-amber-300">Sự kiện chặn request bắt đầu được ghi từ {new Date(report.eventCoverageSince).toLocaleString()}. {report.eventCoverageSince > report.start ? "Khoảng chọn có phần lịch sử chưa được đo; không diễn giải là không có lỗi." : "Các số đếm phản ánh sự kiện đã ghi nhận."}</p>
      <p className="text-sm text-slate-600 dark:text-slate-400">Yêu cầu bị từ chối vì token hết hạn: {report.expiredTokenRequests}. Token đã thu hồi trước hạn không tính vào số này.</p>
      </details>
      <h4 className="font-semibold">Sản phẩm hoàn tất theo {report.bucketHours === 1 ? "giờ" : "ngày"}</h4>
      <div role="img" aria-label={`Biểu đồ ${report.successfulJobs} draft thành công trong ${hours} giờ; số liệu chi tiết bên dưới`} className="flex h-32 items-end gap-1 border-b border-slate-300 dark:border-slate-700">{report.series.map(bucket => <div key={bucket.start} title={`${new Date(bucket.start).toLocaleString()}: ${bucket.completed}`} className="min-w-0 flex-1 rounded-t bg-blue-600" style={{ height: `${bucket.completed / maximum * 100}%` }} />)}</div>
      <details><summary className="cursor-pointer text-blue-700 dark:text-blue-300">Xem số liệu theo từng khoảng</summary><table className="mt-3 w-full text-left text-sm"><caption className="sr-only">Số sản phẩm đã lưu vào SEO Review</caption><thead><tr><th>Thời gian</th><th>Hoàn tất</th></tr></thead><tbody>{report.series.map(bucket => <tr key={bucket.start}><td>{new Date(bucket.start).toLocaleString()}</td><td>{bucket.completed}</td></tr>)}</tbody></table></details>
    </>}
  </section>;
}
