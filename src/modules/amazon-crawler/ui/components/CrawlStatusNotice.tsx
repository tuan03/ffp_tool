import { useEffect, useState } from "react";

import type { CrawlStatus } from "../crawl-status";

const COLORS = {
  working: "border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200",
  success: "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
  error: "border-rose-300 bg-rose-50 text-rose-800 dark:border-rose-800 dark:bg-rose-950 dark:text-rose-200",
  idle: "border-slate-200 bg-slate-50 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200",
};

export function CrawlStatusNotice({ status, errors, id }: {
  readonly status: CrawlStatus;
  readonly errors: readonly string[];
  readonly id?: string;
}) {
  const [unchangedMinutes, setUnchangedMinutes] = useState(0);
  useEffect(() => {
    setUnchangedMinutes(0);
    if (status.tone !== "working") return;
    const startedAt = Date.now();
    const timer = window.setInterval(() => setUnchangedMinutes(Math.floor((Date.now() - startedAt) / 60_000)), 30_000);
    return () => window.clearInterval(timer);
  }, [status.title, status.detail, status.tone]);
  return <div id={id} aria-label="Trạng thái phiên cào" className={`min-w-0 rounded-xl border px-3.5 py-2 ${COLORS[status.tone]}`}>
    <div role="status" aria-live="polite" aria-atomic="true" className="flex items-center gap-3">
      {status.tone === "working" ? (
        <span aria-hidden="true" className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent motion-reduce:animate-none" />
      ) : (
        <span
          aria-hidden="true"
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
            status.tone === "success"
              ? "bg-emerald-600"
              : status.tone === "error"
                ? "bg-rose-600"
                : status.tone === "warning"
                  ? "bg-amber-500"
                  : "bg-blue-600"
          }`}
        >
          {status.tone === "success" ? "✓" : status.tone === "error" || status.tone === "warning" ? "⚠" : "i"}
        </span>
      )}
      <div className="min-w-0">
        <p className="text-sm font-bold leading-tight">{status.title}</p>
        <p className="mt-0.5 break-words text-xs leading-5 opacity-90">{status.detail}</p>
      </div>
    </div>
    {unchangedMinutes >= 2 ? <p className="mt-1 text-xs">Tiến trình chưa thay đổi trong {unchangedMinutes} phút. Mở Phiên &amp; kết quả để kiểm tra; chưa thể kết luận phiên bị lỗi.</p> : null}
    {errors.length > 0 ? <details className="mt-1 text-xs">
      <summary className="cursor-pointer font-semibold underline underline-offset-2">Xem lỗi ({errors.length})</summary>
      <ul className="mt-2 max-h-32 space-y-2 overflow-y-auto break-words">{errors.map(message => <li key={message}>{message}</li>)}</ul>
    </details> : null}
  </div>;
}

