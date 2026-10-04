import { useEffect, useState } from "react";
import type { CustomGptClient } from "../service";
import type { WorkerMetrics } from "../types";

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
    ["Đang chờ (READY + RETRY_WAIT)", report.queueDepth], ["Draft thành công", report.successfulJobs],
    ["Job / giờ", report.jobsPerHour.toFixed(2)], ["Thời gian attempt thành công TB", report.averageProcessingMs === null ? "Chưa đủ dữ liệu" : `${(report.averageProcessingMs / 60000).toFixed(1)} phút`],
    ["Tỷ lệ retry", percent(report.retryRate)], ["Tỷ lệ attempt thất bại", percent(report.failureRate)],
    ["Lease hết hạn / phục hồi", report.leaseExpirations], ["Attempt lỗi quota", report.quotaFailures],
    ["Token hết hạn trong kỳ", report.tokenExpirations], ["Submission trùng đã ngăn", report.duplicateSubmissionsPrevented],
    ["Request lease cũ đã chặn", report.staleLeaseRejections], ["Request nguồn cũ đã chặn", report.staleSourceRejections],
  ] : [];
  const maximum = Math.max(1, ...(report?.series.map(bucket => bucket.completed) ?? []));
  return <section aria-label="Chỉ số vận hành Worker" className="space-y-4 rounded-xl border border-slate-700 bg-slate-950/40 p-4">
    <div className="flex flex-wrap items-center gap-4"><h3 className="text-lg font-semibold text-cyan-300">Sức khỏe SEO Worker</h3>
      <label className="flex items-center gap-2">Khoảng đo<select className="rounded border border-slate-600 bg-slate-900 p-2" value={hours} onChange={event => setHours(Number(event.target.value))}><option value={24}>24 giờ</option><option value={168}>7 ngày</option><option value={720}>30 ngày</option></select></label>
      <button type="button" className="rounded border border-slate-600 px-3 py-2 text-cyan-300" onClick={() => setRefresh(value => value + 1)}>Làm mới chỉ số</button>
    </div>
    {hasError ? <p role="alert" className="text-red-300">Không tải được chỉ số. Kiểm tra quyền quản trị/kết nối và thử lại; dữ liệu cũ đã được ẩn.</p> : !report ? <p role="status">Đang tải chỉ số…</p> : <>
      <p className="text-sm text-slate-400">Store: {storeId} · Cập nhật: {new Date(report.generatedAt).toLocaleString()} · Chỉ worker Codex mới, không gồm batch cũ/Gemini/Custom GPT.</p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([label, value]) => <div key={label} className="rounded-lg border border-slate-700 p-3"><p className="text-sm text-slate-400">{label}</p><p className="mt-2 text-xl font-semibold text-white">{value}</p></div>)}</div>
      <p className="text-sm text-amber-200">Sự kiện chặn request bắt đầu được ghi từ {new Date(report.eventCoverageSince).toLocaleString()}. {report.eventCoverageSince > report.start ? "Khoảng chọn có phần lịch sử chưa được đo; không diễn giải là không có lỗi." : "Các số đếm phản ánh sự kiện đã ghi nhận."}</p>
      <p className="text-sm text-slate-400">Request bị từ chối vì token hết hạn: {report.expiredTokenRequests}. Token đã thu hồi trước khi hết hạn không được tính là hết hạn tự nhiên.</p>
      <p className="text-sm text-slate-400">Retry = attempt bắt đầu lại / attempt bắt đầu trong kỳ ({report.retriedAttempts}/{report.attemptsStarted}). Thất bại = attempt kết thúc không SUCCESS / attempt kết thúc ({report.failedAttempts}/{report.attemptsEnded}), gồm cả hủy/dừng. Thời gian TB gồm validation và giao Review, không gồm chờ Queue hay publish. Số chờ là trạng thái hiện tại.</p>
      <h4 className="font-semibold">Draft thành công theo {report.bucketHours === 1 ? "giờ" : "ngày"}</h4>
      <div role="img" aria-label={`Biểu đồ ${report.successfulJobs} draft thành công trong ${hours} giờ; số liệu chi tiết bên dưới`} className="flex h-32 items-end gap-1 border-b border-slate-600">{report.series.map(bucket => <div key={bucket.start} title={`${new Date(bucket.start).toLocaleString()}: ${bucket.completed}`} className="min-w-0 flex-1 rounded-t bg-cyan-400" style={{ height: `${bucket.completed / maximum * 100}%` }} />)}</div>
      <details><summary className="cursor-pointer text-cyan-300">Xem số liệu và trạng thái chi tiết</summary><p className="my-2 break-words text-sm">{Object.entries(report.states).map(([state, count]) => `${state}: ${count}`).join(" · ") || "Chưa có job Worker"}</p><table className="w-full text-left text-sm"><caption>Số draft đã lưu Review — thời gian theo máy của bạn</caption><thead><tr><th>Bắt đầu khoảng</th><th>Thành công</th></tr></thead><tbody>{report.series.map(bucket => <tr key={bucket.start}><td>{new Date(bucket.start).toLocaleString()}</td><td>{bucket.completed}</td></tr>)}</tbody></table></details>
    </>}
  </section>;
}
