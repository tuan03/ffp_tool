import { useEffect, useState } from "react";

import type {
  AmazonCrawlerDeadLetterTask,
  AmazonCrawlerJobController,
  AmazonCrawlerTaskAttempt,
} from "../../types";

interface AmazonCrawlerDeadLetterPanelProps {
  controller: AmazonCrawlerJobController | undefined;
}

export function AmazonCrawlerDeadLetterPanel({ controller }: AmazonCrawlerDeadLetterPanelProps) {
  const [items, setItems] = useState<readonly AmazonCrawlerDeadLetterTask[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [errorCode, setErrorCode] = useState("");
  const [selectedIds, setSelectedIds] = useState<readonly string[]>([]);
  const [reason, setReason] = useState("");
  const [attempts, setAttempts] = useState<readonly AmazonCrawlerTaskAttempt[]>([]);
  const [attemptTaskId, setAttemptTaskId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function refresh(nextOffset = offset, nextCode = errorCode): Promise<void> {
    if (!controller?.listDeadLetterTasks) return;
    setBusy(true);
    setError("");
    try {
      const page = await controller.listDeadLetterTasks({ errorCode: nextCode || undefined, limit: 100, offset: nextOffset });
      setItems(page.items);
      setTotal(page.total);
      setOffset(page.offset);
      setSelectedIds([]);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Không tải được dead-letter queue.");
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { void refresh(0, ""); }, []);

  async function handleAction(action: "requeue" | "delete", mode: "selected" | "error-type"): Promise<void> {
    if (!controller?.applyDeadLetterAction || reason.trim().length < 10) return;
    const isErrorTypeScope = mode === "error-type" && Boolean(errorCode);
    const scopeCount = isErrorTypeScope ? total : selectedIds.length;
    if (scopeCount < 1 || scopeCount > 100) return;
    const scopeLabel = isErrorTypeScope ? `${scopeCount} task lỗi ${errorCode}` : `${scopeCount} task đã chọn`;
    if (!window.confirm(`${action === "requeue" ? "Đưa lại vào queue" : "Ẩn khỏi DLQ"} ${scopeLabel}? Lịch sử attempt sẽ được giữ.`)) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const result = await controller.applyDeadLetterAction({
        action,
        requestId: globalThis.crypto.randomUUID(),
        taskIds: isErrorTypeScope ? undefined : selectedIds,
        errorCode: isErrorTypeScope ? errorCode : undefined,
        expectedCount: scopeCount,
        reason: reason.trim(),
      });
      setMessage(`${action === "requeue" ? "Đã đưa lại vào queue" : "Đã ẩn khỏi DLQ"}: ${result.changed} task.`);
      await refresh(0, errorCode);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Thao tác DLQ không thành công.");
    } finally {
      setBusy(false);
    }
  }

  async function handleShowAttempts(taskId: string): Promise<void> {
    if (!controller?.listTaskAttempts) return;
    setAttemptTaskId(taskId);
    setAttempts([]);
    try {
      setAttempts(await controller.listTaskAttempts(taskId));
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Không tải được lịch sử attempt.");
    }
  }

  if (!controller?.listDeadLetterTasks || !controller.applyDeadLetterAction || !controller.listTaskAttempts) return null;

  const errorCodes = [...new Set(items.map((item) => item.errorCode))].sort();
  const hasWholeFilterPage = Boolean(errorCode) && offset === 0 && total <= items.length && total <= 100;

  return (
    <section className="rounded-xl border border-amber-500/30 bg-slate-950/70 p-4" aria-labelledby="crawler-dlq-heading">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="crawler-dlq-heading" className="text-lg font-semibold text-amber-200">Dead-letter queue</h2>
          <p className="text-xs text-slate-400">Task hết retry budget hoặc lỗi vĩnh viễn. Thao tác cần operator, lý do và xác nhận số lượng.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => void refresh(0, errorCode)} className="rounded border border-slate-600 px-3 py-2 text-sm disabled:opacity-50">
          Làm mới ({total})
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-xs text-slate-300">Lọc mã lỗi
          <select value={errorCode} disabled={busy} onChange={(event) => { setErrorCode(event.target.value); void refresh(0, event.target.value); }} className="mt-1 block rounded border border-slate-700 bg-slate-900 px-2 py-2">
            <option value="">Tất cả mã lỗi</option>
            {errorCodes.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        </label>
        <label className="min-w-64 flex-1 text-xs text-slate-300">Lý do audit (ít nhất 10 ký tự)
          <input value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} className="mt-1 block w-full rounded border border-slate-700 bg-slate-900 px-3 py-2" />
        </label>
        <button type="button" disabled={busy || selectedIds.length === 0 || selectedIds.length > 100 || reason.trim().length < 10} onClick={() => void handleAction("requeue", "selected")} className="rounded bg-cyan-700 px-3 py-2 text-sm disabled:opacity-50">Retry đã chọn ({selectedIds.length})</button>
        <button type="button" disabled={busy || !hasWholeFilterPage || reason.trim().length < 10} onClick={() => void handleAction("requeue", "error-type")} className="rounded bg-indigo-700 px-3 py-2 text-sm disabled:opacity-50">Retry theo mã lỗi ({total})</button>
        <button type="button" disabled={busy || selectedIds.length === 0 || selectedIds.length > 100 || reason.trim().length < 10} onClick={() => void handleAction("delete", "selected")} className="rounded border border-rose-700 px-3 py-2 text-sm text-rose-200 disabled:opacity-50">Ẩn đã chọn</button>
      </div>

      {error ? <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p> : null}
      {message ? <p role="status" className="mt-3 text-sm text-emerald-300">{message}</p> : null}
      {items.length === 0 ? <p className="mt-4 text-sm text-slate-400">{busy ? "Đang tải…" : "Không có task trong DLQ."}</p> : (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] text-left text-xs">
            <thead className="text-slate-400"><tr><th className="p-2">Chọn</th><th className="p-2">ASIN / lỗi</th><th className="p-2">Retry</th><th className="p-2">Job / task</th><th className="p-2">Lịch sử</th></tr></thead>
            <tbody>{items.map((item) => <tr key={item.taskId} className="border-t border-slate-800 align-top">
              <td className="p-2"><input aria-label={`Chọn task ${item.asin}`} type="checkbox" checked={selectedIds.includes(item.taskId)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, item.taskId] : current.filter((id) => id !== item.taskId))} /></td>
              <td className="p-2"><strong>{item.asin}</strong><p className="mt-1 text-amber-300">{item.errorCode}</p><p className="max-w-xl whitespace-normal text-slate-400">{item.errorMessage}</p></td>
              <td className="p-2">{item.failureCount}/{item.maxRetry}<p className="text-slate-500">Requeue: {item.requeueCount}</p></td>
              <td className="p-2 font-mono">{item.jobId}<p>{item.taskId}</p></td>
              <td className="p-2"><button type="button" onClick={() => void handleShowAttempts(item.taskId)} className="text-cyan-300 underline">Xem {item.attemptCount} attempt</button></td>
            </tr>)}</tbody>
          </table>
        </div>
      )}

      {total > 100 ? <div className="mt-3 flex items-center gap-3 text-xs text-slate-400"><button type="button" disabled={busy || offset === 0} onClick={() => void refresh(Math.max(0, offset - 100), errorCode)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Trang trước</button><span>{offset + 1}–{Math.min(offset + items.length, total)} / {total}</span><button type="button" disabled={busy || offset + items.length >= total} onClick={() => void refresh(offset + 100, errorCode)} className="rounded border border-slate-700 px-2 py-1 disabled:opacity-40">Trang sau</button></div> : null}

      {attemptTaskId ? <div className="mt-4 rounded border border-slate-700 p-3"><div className="flex justify-between"><strong>Lịch sử task {attemptTaskId}</strong><button type="button" onClick={() => setAttemptTaskId(null)} aria-label="Đóng lịch sử">Đóng</button></div>
        {attempts.length === 0 ? <p className="mt-2 text-xs text-slate-400">Không có attempt hoặc chưa tải xong.</p> : <ol className="mt-2 space-y-2">{attempts.map((attempt) => <li key={attempt.attemptId} className="rounded bg-slate-900 p-2 text-xs"><div className="flex flex-wrap justify-between gap-2"><strong>{attempt.status} · {attempt.errorCode ?? "—"}</strong><span>{attempt.durationMs === null ? "đang chạy" : `${attempt.durationMs} ms`}{attempt.archived ? " · archived" : ""}</span></div><p className="text-slate-400">Agent {attempt.agentVersion} · Crawler {attempt.crawlerVersion} · Parser {attempt.parserVersion}</p><p className="text-slate-500">{attempt.errorMessage ?? "Không có lỗi"}</p></li>)}</ol>}
      </div> : null}
    </section>
  );
}
