import { useEffect, useState } from "react";
import type { CustomGptClient } from "../service";
import type { WorkerReviewHistory } from "../types";

export function WorkerReviewHistoryPanel({ client, storeId, jobId }: { readonly client: CustomGptClient; readonly storeId: string; readonly jobId: string }): React.JSX.Element {
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<WorkerReviewHistory | null>(null);
  const [hasError, setHasError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let isActive = true;
    setHistory(null); setHasError(false);
    void client.workerReviewHistory(storeId, jobId, offset).then(next => { if (isActive) setHistory(next); }).catch(() => { if (isActive) setHasError(true); });
    return () => { isActive = false; };
  }, [client, storeId, jobId, offset, refresh]);
  return <section aria-label="Lịch sử Worker và revision" className="space-y-3 rounded-xl border border-slate-700 p-4">
    <h3 className="font-semibold text-cyan-300">Lịch sử revision · Worker / Run / Validation</h3>
    <button type="button" onClick={() => setRefresh(value => value + 1)} className="text-cyan-300">Làm mới lịch sử</button>
    {hasError ? <p role="alert">Không tải được lịch sử. Kiểm tra quyền quản trị; dữ liệu cũ đã được ẩn.</p> : !history ? <p role="status">Đang tải…</p> : <>
      {history.entries.length === 0 && <p>Chưa có lịch sử.</p>}
      {history.entries.map(entry => <details key={entry.jobId} open={entry.jobId === jobId} className="rounded-lg border border-slate-700 p-3">
        <summary className="cursor-pointer break-all">{entry.jobId === jobId ? "Bản đang xem · " : "Revision · "}{entry.jobId} · {entry.status}</summary>
        <dl className="mt-2 grid gap-2 break-all">
          <div><dt>Bản trước</dt><dd>{entry.previousJobId ?? "Bản gốc"}</dd></div>
          <div><dt>Worker / Run</dt><dd>{entry.workerId ?? "Chưa có"} / {entry.runId ?? "Chưa có"}</dd></div>
          <div><dt>Source version / Rules version</dt><dd>{entry.sourceVersion ?? "Chưa xác minh"} / {entry.rulesVersion ?? "Chưa có"}</dd></div>
          <div><dt>Checkpoint đã lưu</dt><dd>{entry.checkpoints.join(" → ") || "Chưa có"}</dd></div>
          <div><dt>Validation</dt><dd>{entry.status === "REVIEW_READY" ? "Đã qua validator và lưu Review" : entry.status === "VALIDATING" ? "Đang kiểm tra, chưa thành công" : "Chưa có kết quả đạt"}</dd></div>
          <div><dt>Lần xử lý / lượt tải ảnh có biên nhận</dt><dd>{entry.attemptCount} / {entry.imageReceipts}</dd></div>
          <div><dt>Publish / SEO version</dt><dd>{entry.publishState ?? "Chưa Sync"} / {entry.seoVersion ?? "Chưa xác nhận"}</dd></div>
          {entry.errorCode && <div><dt>Lỗi cần xử lý</dt><dd>{entry.errorCode}</dd></div>}
        </dl>
      </details>)}
      <p>{history.total} revision · Trang {offset / 50 + 1}</p>
      <div className="flex gap-4"><button type="button" disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Trước</button><button type="button" disabled={history.nextOffset === null} onClick={() => setOffset(history.nextOffset ?? offset)}>Sau</button></div>
    </>}
  </section>;
}
