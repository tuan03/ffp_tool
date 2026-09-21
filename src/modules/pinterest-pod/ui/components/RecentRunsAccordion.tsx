import { useState } from "react";

import type { PodRecentRunItem } from "../../types";

interface RecentRunsAccordionProps {
  readonly recentRuns: readonly PodRecentRunItem[];
  readonly activeJobId: string | null;
  readonly onLoadJob: (jobId: string) => void;
  readonly onDeleteJob?: (jobId: string) => Promise<void> | void;
  readonly isLoading?: boolean;
  readonly onRefresh?: () => void;
}

export function RecentRunsAccordion({
  recentRuns,
  activeJobId,
  onLoadJob,
  onDeleteJob,
  isLoading = false,
  onRefresh,
}: RecentRunsAccordionProps): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(true);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, targetId: string): Promise<void> {
    e.stopPropagation();
    if (!onDeleteJob) return;

    const confirmed = window.confirm(
      `Bạn có chắc chắn muốn xóa job "${targetId}" và toàn bộ file liên quan trên ổ đĩa không?\nThao tác này không thể hoàn tác.`,
    );
    if (!confirmed) return;

    setDeletingId(targetId);
    try {
      await onDeleteJob(targetId);
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70 shadow-md">
      {/* Header Bar / Toggle */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsOpen((prev) => !prev);
          }
        }}
        className="flex cursor-pointer items-center justify-between px-4 py-3 transition hover:bg-slate-900/60 focus:outline-none"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm">📁</span>
          <span className="text-xs font-bold text-slate-200">
            Lịch sử Job &amp; Thư mục Run có sẵn
          </span>
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-cyan-400">
            {recentRuns.length}
          </span>
        </div>

        <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={isLoading}
              title="Làm mới danh sách"
              className="rounded-md border border-slate-700 bg-slate-800 px-2 py-1 text-[11px] text-slate-300 hover:border-cyan-500 hover:text-cyan-300 disabled:opacity-50"
            >
              {isLoading ? "↻ Đang tải..." : "↻ Làm mới"}
            </button>
          )}
          <span className="text-xs text-slate-400">{isOpen ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Accordion Body */}
      {isOpen && (
        <div className="border-t border-slate-800/80 p-3">
          {recentRuns.length === 0 ? (
            <div className="py-4 text-center text-xs text-slate-500">
              {isLoading ? "Đang quét lịch sử job..." : "Chưa có job hoặc thư mục run nào gần đây."}
            </div>
          ) : (
            <div className="flex max-h-64 flex-col gap-2 overflow-y-auto pr-1">
              {recentRuns.map((item) => {
                const targetId = item.jobId || item.job_id || item.id;
                const isActive = activeJobId === targetId;
                const isCompleted = item.status === "completed";
                const isReview = item.status === "ready_for_review";
                const isFailed = item.status === "failed";
                const isCancelled = item.status === "cancelled";
                const isDeleting = deletingId === targetId;

                const candCount = item.candidateCount ?? 0;

                return (
                  <div
                    key={targetId}
                    className={`flex items-center justify-between gap-3 rounded-lg border p-2.5 transition ${
                      isActive
                        ? "border-cyan-500/80 bg-cyan-950/30 shadow-sm"
                        : "border-slate-800/90 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
                    }`}
                  >
                    {/* Left: Info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <strong className="truncate text-xs font-semibold text-slate-100">
                          {item.niche || item.title || targetId}
                        </strong>
                        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-400">
                          {item.product || item.productType || "rug"}
                        </span>
                      </div>

                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        {/* Status Badge */}
                        {isCompleted && (
                          <span className="rounded bg-emerald-950/80 border border-emerald-700 px-1.5 py-0.5 text-[10px] font-bold text-emerald-300">
                            ✓ Thành phẩm
                          </span>
                        )}
                        {isReview && (
                          <span className="rounded bg-amber-950/80 border border-amber-700 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                            ⏳ Chờ duyệt {candCount > 0 ? `(${candCount} mẫu)` : ""}
                          </span>
                        )}
                        {isFailed && (
                          <span className="rounded bg-rose-950/80 border border-rose-700 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
                            ✕ Lỗi
                          </span>
                        )}
                        {isCancelled && (
                          <span className="rounded bg-slate-800 border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400">
                            ⏹ Đã dừng
                          </span>
                        )}
                        {!isCompleted && !isReview && !isFailed && !isCancelled && (
                          <span className="rounded bg-cyan-950/80 border border-cyan-700 px-1.5 py-0.5 text-[10px] font-bold text-cyan-300">
                            🔄 {item.status || "đang chạy"}
                          </span>
                        )}

                        {/* Job ID code badge */}
                        <code className="text-[10px] text-slate-400">
                          {targetId}
                        </code>
                      </div>
                    </div>

                    {/* Right: Actions */}
                    <div className="flex flex-shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onLoadJob(targetId)}
                        disabled={isDeleting}
                        className={`flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-semibold transition ${
                          isActive
                            ? "bg-cyan-500 text-slate-950 shadow"
                            : isCompleted
                              ? "bg-emerald-600 text-white hover:bg-emerald-500"
                              : isReview
                                ? "bg-amber-600 text-white hover:bg-amber-500"
                                : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        {isActive
                          ? "✓ Đang xem"
                          : isCompleted
                            ? "🎉 Xem"
                            : isReview
                              ? "🔍 Duyệt mẫu"
                              : "Tải lại"}
                      </button>

                      {onDeleteJob && (
                        <button
                          type="button"
                          onClick={(e) => void handleDelete(e, targetId)}
                          disabled={isDeleting}
                          title="Xóa job và dữ liệu liên quan trên ổ đĩa"
                          className="rounded-lg border border-rose-800/60 bg-rose-950/40 p-1.5 text-xs text-rose-400 hover:bg-rose-900/60 hover:text-white disabled:opacity-50"
                        >
                          {isDeleting ? "..." : "🗑"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
