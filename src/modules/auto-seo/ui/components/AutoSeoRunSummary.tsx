import type { AutoSeoBackupBatchProgress } from "../../types";

export interface AutoSeoRunSummaryProps {
  readonly progress: AutoSeoBackupBatchProgress;
  readonly onOpenQueue: () => void;
  readonly onOpenReview: () => void;
}

export function AutoSeoRunSummary({ progress, onOpenQueue, onOpenReview }: AutoSeoRunSummaryProps): React.JSX.Element {
  const isFinished = progress.phase === "completed" || progress.phase === "failed";
  const remaining = progress.total - progress.handedOver - progress.skipped;
  const title = progress.phase === "loading" ? "Đang tải dữ liệu sản phẩm"
    : progress.phase === "backup" ? "Đang bàn giao Auto SEO"
    : progress.phase === "failed" ? "Lô Auto SEO đã dừng; kết quả đã xác nhận được giữ nguyên"
    : "Kết quả Auto SEO";

  return <section role="status" aria-label="Tiến độ Auto SEO" className={`rounded-lg border p-4 text-sm ${progress.phase === "failed" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
    <p className="font-semibold">{title}</p>
    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
      <span>Đã chọn: <strong>{progress.total}</strong></span>
      <span>Bàn giao mới: <strong>{progress.handedOver}</strong></span>
      <span>Đang trong Queue/Review: <strong>{progress.alreadyQueued}</strong></span>
      <span>Không đổi/đã xử lý: <strong>{progress.unchanged}</strong></span>
      {remaining > 0 ? <span>Chưa xác nhận: <strong>{remaining}</strong></span> : null}
    </div>
    {!isFinished ? <p className="mt-2 text-xs">Đã tải {progress.hydrated}/{progress.total} · {progress.completedBatches} batch hoàn tất</p> : <div className="mt-3 flex gap-3">
      <button type="button" onClick={onOpenQueue} className="rounded-lg border border-blue-200 px-3 py-2 hover:bg-blue-50">Mở SEO Queue</button>
      <button type="button" onClick={onOpenReview} className="rounded-lg border border-slate-300 px-3 py-2 hover:bg-slate-50">Mở SEO Review</button>
    </div>}
  </section>;
}
