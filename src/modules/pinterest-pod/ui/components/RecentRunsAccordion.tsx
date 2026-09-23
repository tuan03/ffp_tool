import { useState } from "react";

import type { PinterestProductType, PodRecentRunItem } from "../../types";

interface RecentRunsAccordionProps {
  readonly recentRuns: readonly PodRecentRunItem[];
  readonly activeJobId: string | null;
  readonly onLoadJob: (jobId: string) => void;
  readonly onDeleteJob?: (jobId: string) => Promise<void> | void;
  readonly isLoading?: boolean;
  readonly onRefresh?: () => void;
  readonly onPreviewThumbnail?: (url: string, title: string) => void;
  readonly onReuseNiche?: (niche: string, product: PinterestProductType) => void;
}

export function RecentRunsAccordion({
  recentRuns,
  activeJobId,
  onLoadJob,
  onDeleteJob,
  isLoading = false,
  onRefresh,
  onPreviewThumbnail,
  onReuseNiche,
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
            <div className="flex max-h-96 flex-col gap-3 overflow-y-auto pr-1">
              {recentRuns.map((item) => {
                const targetId = item.jobId || item.job_id || item.id;
                const isActive = activeJobId === targetId;
                const isCompleted = item.status === "completed";
                const isReview = item.status === "ready_for_review";
                const isFailed = item.status === "failed";
                const isCancelled = item.status === "cancelled";
                const isDeleting = deletingId === targetId;

                const candCount = item.candidateCount ?? 0;
                const cmykCount = item.cmykCount ?? 0;
                const mockupCount = item.mockupCount ?? 0;
                const itemProduct = item.product || item.productType || "rug";
                const itemNiche = item.niche || item.title || targetId;

                return (
                  <div
                    key={targetId}
                    className={`flex flex-col gap-2.5 rounded-xl border p-3 transition ${
                      isActive
                        ? "border-cyan-500/80 bg-cyan-950/20 shadow-md ring-1 ring-cyan-500/50"
                        : "border-slate-800/90 bg-slate-900/60 hover:border-slate-700 hover:bg-slate-900/90"
                    }`}
                  >
                    {/* Top Row: Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-xs font-bold text-slate-100" title={itemNiche}>
                            {itemNiche}
                          </strong>
                          <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-semibold text-slate-300 uppercase">
                            {itemProduct}
                          </span>
                          {item.createdAt && (
                            <span className="text-[10px] text-slate-400">
                              {item.createdAt}
                            </span>
                          )}
                        </div>

                        {/* Status Badges & Counts */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {isCompleted && (
                            <span className="rounded-full bg-emerald-950/90 border border-emerald-600/80 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                              ✓ Thành phẩm hoàn tất
                            </span>
                          )}
                          {isReview && (
                            <span className="rounded-full bg-amber-950/90 border border-amber-600/80 px-2 py-0.5 text-[10px] font-bold text-amber-300">
                              ⏳ Chờ duyệt ({candCount} mẫu)
                            </span>
                          )}
                          {isFailed && (
                            <span className="rounded-full bg-rose-950/90 border border-rose-600/80 px-2 py-0.5 text-[10px] font-bold text-rose-300">
                              ✕ Lỗi
                            </span>
                          )}
                          {isCancelled && (
                            <span className="rounded-full bg-slate-800 border border-slate-700 px-2 py-0.5 text-[10px] text-slate-400">
                              ⏹ Đã dừng
                            </span>
                          )}
                          {!isCompleted && !isReview && !isFailed && !isCancelled && (
                            <span className="rounded-full bg-cyan-950/90 border border-cyan-600/80 px-2 py-0.5 text-[10px] font-bold text-cyan-300">
                              🔄 {item.status || "đang chạy"}
                            </span>
                          )}

                          {cmykCount > 0 && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-cyan-300 font-medium">
                              🖨️ {cmykCount} file CMYK
                            </span>
                          )}
                          {mockupCount > 0 && (
                            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-indigo-300 font-medium">
                              🛋️ {mockupCount} mockup
                            </span>
                          )}

                          <code className="text-[10px] text-slate-400 font-mono">
                            {targetId}
                          </code>
                        </div>
                      </div>

                      {/* Delete icon button */}
                      {onDeleteJob && (
                        <button
                          type="button"
                          onClick={(e) => void handleDelete(e, targetId)}
                          disabled={isDeleting}
                          title="Xóa job và dữ liệu liên quan trên ổ đĩa"
                          className="rounded-lg border border-slate-800 p-1.5 text-xs text-slate-400 hover:border-rose-700 hover:bg-rose-950/60 hover:text-rose-300 disabled:opacity-50 transition"
                        >
                          {isDeleting ? "..." : "🗑"}
                        </button>
                      )}
                    </div>

                    {/* Middle Row: Visual Thumbnail Previews */}
                    {item.thumbnails && item.thumbnails.length > 0 && (
                      <div className="flex items-center gap-2 pt-1">
                        {item.thumbnails.slice(0, 4).map((thumbUrl, tIdx) => (
                          <div
                            key={`${thumbUrl}-${tIdx}`}
                            onClick={() => {
                              if (onPreviewThumbnail) {
                                onPreviewThumbnail(thumbUrl, `${itemNiche} (#${tIdx + 1})`);
                              } else {
                                onLoadJob(targetId);
                              }
                            }}
                            title="Click để soi phóng to ảnh"
                            className="group relative h-14 w-14 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-700/80 bg-slate-950 hover:border-cyan-400 hover:scale-105 transition"
                          >
                            <img
                              src={thumbUrl}
                              alt={`Thumbnail ${tIdx + 1}`}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition text-[11px] text-white">
                              🔍
                            </div>
                          </div>
                        ))}
                        {item.thumbnails.length > 4 && (
                          <span className="text-[10px] text-slate-400">
                            +{item.thumbnails.length - 4} ảnh
                          </span>
                        )}
                      </div>
                    )}

                    {/* Bottom Row: Quick Action Buttons */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-800/60 pt-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {onReuseNiche && item.niche && (
                          <button
                            type="button"
                            onClick={() => onReuseNiche(item.niche ?? itemNiche, itemProduct as PinterestProductType)}
                            title="Lấy lại từ khóa và sản phẩm này lên form để tạo đợt mới"
                            className="flex items-center gap-1 rounded-md border border-slate-700/80 bg-slate-800/80 px-2 py-1 text-[11px] font-medium text-slate-300 hover:border-cyan-500 hover:text-white transition"
                          >
                            <span>🚀</span>
                            <span>Làm đợt mới</span>
                          </button>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onLoadJob(targetId)}
                        disabled={isDeleting}
                        className={`flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold shadow-xs transition ${
                          isActive
                            ? "bg-cyan-500 text-slate-950 font-bold"
                            : isCompleted
                              ? "bg-emerald-600 text-white hover:bg-emerald-500"
                              : isReview
                                ? "bg-amber-600 text-white hover:bg-amber-500"
                                : "border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                        }`}
                      >
                        {isActive
                          ? "✓ Đang mở"
                          : isCompleted
                            ? "🎉 Xem thành phẩm"
                            : isReview
                              ? "🔍 Duyệt kho ảnh"
                              : "Mở lại"}
                      </button>
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
