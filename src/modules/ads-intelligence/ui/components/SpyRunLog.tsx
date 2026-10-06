import { useEffect, useState } from "react";

import type { SpyJob } from "../../types";

function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)} phút ${seconds % 60} giây`;
}

export function SpyRunLog({ job }: { readonly job: SpyJob }): React.JSX.Element {
  const [now, setNow] = useState(Date.now);
  const [onlyErrors, setOnlyErrors] = useState(false);
  useEffect(() => {
    setNow(Date.now());
    if (job.status !== "running") return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [job.id, job.status]);
  const entries = job.events ?? [];
  const latest = entries.at(-1);
  const visible = (onlyErrors ? entries.filter(event => event.level === "error") : entries).slice().reverse();
  const lastActivity = latest?.at ?? job.startedAt;
  const elapsed = Date.parse(job.finishedAt ?? "") || now;
  return <section aria-label="Nhật ký Spy" className="space-y-3 rounded-xl border border-slate-700 bg-slate-950 p-3 text-xs">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="font-semibold text-slate-200">Nhật ký Spy</h4>
      <span className="text-slate-400">Thời gian: {duration(elapsed - Date.parse(job.startedAt))}</span>
    </div>
    <p className="text-slate-400">{job.status === "running" ? `Tự cập nhật mỗi 2,5 giây · Sự kiện gần nhất cách đây ${duration(now - Date.parse(lastActivity))}` : "Lượt chạy đã kết thúc · Nhật ký được giữ lại khi tải trang."}</p>
    {latest && <p aria-live="polite" className={latest.level === "error" ? "text-amber-300" : "text-cyan-200"}>Gần nhất: {latest.message}</p>}
    <label className="flex items-center gap-2 text-slate-300"><input type="checkbox" checked={onlyErrors} onChange={event => setOnlyErrors(event.target.checked)} />Chỉ hiện lỗi</label>
    {job.events === undefined && now - Date.parse(job.startedAt) > 10000 && <p className="text-amber-300">Backend của lượt này chưa hỗ trợ log trực tiếp. Cần nạp lại backend sau khi lượt đang chạy kết thúc.</p>}
    {visible.length ? <ol aria-label="Các sự kiện Spy, mới nhất trước" className="max-h-72 space-y-2 overflow-y-auto rounded-lg bg-slate-900/60 p-3">
      {visible.map(event => <li key={event.id} className="flex items-start gap-3 border-b border-slate-800 pb-2 last:border-0">
        <time dateTime={event.at} className="shrink-0 font-mono text-slate-500">{new Date(event.at).toLocaleTimeString("vi-VN", { hour12: false })}</time>
        <span className={event.level === "error" ? "break-words text-amber-300" : event.level === "success" ? "break-words text-emerald-300" : "break-words text-slate-300"}>{event.level === "error" ? "Lỗi · " : ""}{event.message}</span>
      </li>)}
    </ol> : <p className="rounded-lg bg-slate-900 p-3 text-slate-400">{onlyErrors ? "Chưa có sự kiện lỗi trong nhật ký." : job.status === "running" ? "Đang chờ sự kiện đầu tiên từ backend…" : "Lượt cũ chưa ghi nhật ký chi tiết. Nhật ký trực tiếp có từ các lượt chạy sau khi cập nhật."}</p>}
    <p className="text-slate-500">Hiển thị tối đa 200 sự kiện gần nhất. Hoạt động công cụ không đồng nghĩa nghiên cứu đã hoàn tất.</p>
  </section>;
}
