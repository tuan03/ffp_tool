import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
  const [isOpen, setIsOpen] = useState(false);
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
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-md">
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
        className="flex cursor-pointer items-center justify-between px-4 py-3 transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-blue-600/30"
      >
        <div className="flex items-center gap-2">
          <span className="text-sm"><AppIcon name="folder" /></span>
          <span className="text-xs font-bold text-slate-900">
            Lịch sử Job &amp; Thư mục Run có sẵn
          </span>
          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold text-blue-700">
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
              className="rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs text-slate-700 hover:border-blue-300 hover:text-blue-700 disabled:opacity-50"
            >
              {isLoading ? "↻ Đang tải..." : "↻ Làm mới"}
            </button>
          )}
          <span className="text-xs text-slate-600">{isOpen ? "▲" : "▼"}</span>
        </div>
      </div>

      {/* Accordion Body */}
      {isOpen && (
        <div className="border-t border-slate-200 p-3">
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
                    className={`flex flex-col gap-2.5 rounded-lg border p-3 transition ${
                      isActive
                        ? "border-blue-300 bg-blue-50 shadow-md ring-1 ring-blue-300"
                        : "border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-slate-50"
                    }`}
                  >
                    {/* Top Row: Title + Status Badge */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong className="truncate text-xs font-bold text-slate-900" title={itemNiche}>
                            {itemNiche}
                          </strong>
                          <span className="rounded bg-slate-50 px-1.5 py-0.5 text-xs font-semibold text-slate-700 uppercase">
                            {itemProduct}
                          </span>
                          {item.createdAt && (
                            <span className="text-xs text-slate-600">
                              {item.createdAt}
                            </span>
                          )}
                        </div>

                        {/* Status Badges & Counts */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          {isCompleted && (
                            <span className="rounded-full bg-emerald-50 border border-emerald-300 px-2 py-0.5 text-xs font-bold text-emerald-700">
                              ✓ Thành phẩm hoàn tất
                            </span>
                          )}
                          {isReview && (
                            <span className="rounded-full bg-amber-50 border border-amber-300 px-2 py-0.5 text-xs font-bold text-amber-700">
                              <AppIcon name="clock" /> Chờ duyệt ({candCount} mẫu)
                            </span>
                          )}
                          {isFailed && (
                            <span className="rounded-full bg-rose-50 border border-rose-300 px-2 py-0.5 text-xs font-bold text-rose-700">
                              ✕ Lỗi
                            </span>
                          )}
                          {isCancelled && (
                            <span className="rounded-full bg-slate-50 border border-slate-300 px-2 py-0.5 text-xs text-slate-600">
                              ⏹ Đã dừng
                            </span>
                          )}
                          {!isCompleted && !isReview && !isFailed && !isCancelled && (
                            <span className="rounded-full bg-blue-50 border border-blue-300 px-2 py-0.5 text-xs font-bold text-blue-700">
                              <AppIcon name="refresh" /> {item.status || "đang chạy"}
                            </span>
                          )}

                          {cmykCount > 0 && (
                            <span className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-blue-700 font-medium">
                              🖨️ {cmykCount} file CMYK
                            </span>
                          )}
                          {mockupCount > 0 && (
                            <span className="rounded bg-slate-50 px-1.5 py-0.5 text-xs text-blue-700 font-medium">
                              🛋️ {mockupCount} mockup
                            </span>
                          )}

                          <code className="text-xs text-slate-600 font-mono">
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
                          className="rounded-lg border border-slate-200 p-1.5 text-xs text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-50 transition"
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
                            className="group relative h-14 w-14 flex-shrink-0 cursor-pointer overflow-hidden rounded-lg border border-slate-300 bg-white hover:border-blue-300 hover:scale-105 transition"
                          >
                            <img
                              src={thumbUrl}
                              alt={`Thumbnail ${tIdx + 1}`}
                              className="h-full w-full object-cover"
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition text-xs text-white">
                              <AppIcon name="search" />
                            </div>
                          </div>
                        ))}
                        {item.thumbnails.length > 4 && (
                          <span className="text-xs text-slate-600">
                            +{item.thumbnails.length - 4} ảnh
                          </span>
                        )}
                      </div>
                    )}

                    {/* Bottom Row: Quick Action Buttons */}
                    <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-2 text-xs">
                      <div className="flex items-center gap-1.5">
                        {onReuseNiche && item.niche && (
                          <button
                            type="button"
                            onClick={() => onReuseNiche(item.niche ?? itemNiche, itemProduct as PinterestProductType)}
                            title="Lấy lại từ khóa và sản phẩm này lên form để tạo đợt mới"
                            className="flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-1 text-xs font-medium text-slate-700 hover:border-blue-300 hover:text-slate-900 transition"
                          >
                            <span><AppIcon name="play" /></span>
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
                            ? "bg-blue-600 text-white font-bold"
                            : isCompleted
                              ? "bg-emerald-700 text-white hover:bg-emerald-700"
                              : isReview
                                ? "bg-amber-700 text-white hover:bg-amber-700"
                                : "border border-slate-300 bg-slate-50 text-slate-900 hover:bg-slate-100"
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
