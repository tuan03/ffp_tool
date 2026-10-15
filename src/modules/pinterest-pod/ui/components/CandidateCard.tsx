import { AppIcon } from "../../../../shared/components/AppIcon";
import type { CandidateItem } from "../../types";

export interface CandidateCardProps {
  readonly candidate: CandidateItem;
  readonly isSelected: boolean;
  readonly onToggle: (id: string) => void;
  readonly onPreview?: (candidate: CandidateItem) => void;
  readonly onUseAsRoomTemplate?: (candidate: CandidateItem) => void;
  readonly onRescue?: (candidate: CandidateItem) => void;
  readonly isRoomTemplate?: boolean;
}

export function CandidateCard({
  candidate,
  isSelected,
  onToggle,
  onPreview,
  onUseAsRoomTemplate,
  onRescue,
  isRoomTemplate = false,
}: CandidateCardProps): React.JSX.Element {
  const candId = candidate.id || candidate.candidate_id || candidate.image_id || "";
  const isRejected = Boolean(candidate.is_rejected || candidate.candidate_category === "rejected");
  const isBreakthrough = Boolean(
    candidate.is_breakthrough_concept || candidate.candidate_category === "breakthrough_concept"
  );
  const isDirectPrintable = Boolean(
    !isBreakthrough && !isRejected && (candidate.is_direct_printable || candidate.candidate_category === "direct_printable")
  );
  const hasLowInformationWarning = candidate.quality_warnings?.includes("low_information") === true;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => {
        if (!isRejected) onToggle(candId);
      }}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          if (!isRejected) onToggle(candId);
        }
      }}
      className={`group relative flex flex-col overflow-hidden rounded-lg border transition-all duration-200 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-2 focus:ring-blue-300 dark:focus:ring-blue-400 ${
        isRejected
          ? "border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 shadow opacity-90 hover:opacity-100"
          : isRoomTemplate
          ? "border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 shadow-sm ring-2 ring-blue-300 dark:ring-blue-400 cursor-pointer"
          : isSelected
          ? "border-blue-300 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 shadow-sm ring-2 ring-blue-300 dark:ring-blue-400 cursor-pointer"
          : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 shadow cursor-pointer"
      }`}
    >
      {/* Top badges & selection checkbox overlay */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-white">
        <img
          src={candidate.image_url}
          alt={candidate.title}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src =
              "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#f8fafc"/><text x="200" y="150" fill="#94a3b8" font-family="sans-serif" font-size="14" text-anchor="middle">${candidate.title.slice(0, 30)}</text></svg>`,
              );
          }}
          className={`h-full w-full object-cover transition duration-300 ${isRejected ? "grayscale-30" : "group-hover:scale-105"}`}
        />

        {/* Checkbox (only for non-rejected) */}
        {!isRejected && (
          <div
            className="absolute top-2.5 left-2.5 z-10 flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={isSelected}
              onChange={() => onToggle(candId)}
              aria-label={`Chọn mẫu ${candidate.title}`}
              className="h-5 w-5 rounded border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300 accent-blue-300 shadow focus:ring-0 cursor-pointer"
            />
          </div>
        )}

        {/* Badges */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1">
          {isRejected && (
            <span className="flex items-center gap-1 rounded-full border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-2 py-0.5 text-xs font-bold text-rose-700 dark:text-rose-300 shadow">
              <span>✕</span>
              <span>Bị loại</span>
            </span>
          )}

          {isRoomTemplate && (
            <span className="flex items-center gap-1 rounded-full border border-blue-300 dark:border-blue-800 bg-blue-600 px-2 py-0.5 text-xs font-bold text-white shadow">
              <span>🛋️</span>
              <span>Phòng Mẫu</span>
            </span>
          )}

          {hasLowInformationWarning && (
            <span className="flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300 shadow">
              <span><AppIcon name="warning" /></span>
              <span>Ít chi tiết</span>
            </span>
          )}

          {!isRejected && candidate.recommended && (
            <span className="flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-700 px-2 py-0.5 text-xs font-bold text-white shadow">
              <span><AppIcon name="star" /></span>
              <span>Khuyên chọn</span>
            </span>
          )}

          {/* Direct Printable vs Breakthrough Concept Badges */}
          {isDirectPrintable && (
            <span className="flex items-center gap-1 rounded-full border border-emerald-300 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 shadow backdrop-blur-xs">
              <span>🖨️</span>
              <span>Chuẩn in 2D</span>
            </span>
          )}

          {isBreakthrough && (
            <span className="flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300 shadow backdrop-blur-xs">
              <span><AppIcon name="info" /></span>
              <span>Ý tưởng đột phá</span>
            </span>
          )}
        </div>

        {/* Pinterest external link */}
        <a
          href={candidate.pin_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white backdrop-blur-xs transition hover:bg-rose-700"
          title="Xem Pin gốc trên Pinterest"
        >
          ↗
        </a>

        {/* Action buttons: Soi HD & Đặt làm phòng mẫu */}
        <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
          {onPreview && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onPreview(candidate);
              }}
              className="flex items-center gap-1 rounded-md bg-slate-50 dark:bg-slate-800 px-2 py-1 text-xs font-medium text-slate-900 dark:text-slate-100 backdrop-blur-xs transition hover:bg-blue-700 hover:text-white shadow"
              title="Soi ảnh phóng to HD"
            >
              <span><AppIcon name="search" /></span>
              <span>Soi HD</span>
            </button>
          )}

          {!isRejected && onUseAsRoomTemplate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUseAsRoomTemplate(candidate);
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium backdrop-blur-xs transition shadow ${
                isRoomTemplate
                  ? "bg-blue-600 text-white font-semibold ring-1 ring-blue-300 dark:ring-blue-400"
                  : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-blue-700 hover:text-white"
              }`}
              title={isRoomTemplate ? "Bỏ dùng ảnh này làm phòng mẫu" : "Dùng ảnh này làm Phòng Mẫu tham chiếu"}
            >
              <span>🛋️</span>
              <span>{isRoomTemplate ? "Phòng Mẫu ✓" : "Làm phòng"}</span>
            </button>
          )}
        </div>
      </div>

      {/* Content & Metrics */}
      <div className="flex flex-1 flex-col p-3.5 gap-2.5">
        <h3 className="line-clamp-2 text-xs font-semibold text-slate-900 dark:text-slate-100" title={candidate.title}>
          {candidate.title}
        </h3>

        {/* 3 AI Vision Scores */}
        <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-2 text-center text-xs">
          <div>
            <p className="text-slate-600 dark:text-slate-400">Điểm nét</p>
            <p className="font-bold text-blue-700 dark:text-blue-300">{candidate.image_score}/100</p>
          </div>
          <div className="border-x border-slate-200 dark:border-slate-700">
            <p className="text-slate-600 dark:text-slate-400">Chuẩn in</p>
            <p className="font-bold text-emerald-700 dark:text-emerald-300">{candidate.printability_score}/100</p>
          </div>
          <div>
            <p className="text-slate-600 dark:text-slate-400">Độ phẳng</p>
            <p className="font-bold text-amber-700 dark:text-amber-300">{candidate.flat_artwork_score}/100</p>
          </div>
        </div>

        {/* Rejection notice and Rescue Button */}
        {isRejected ? (
          <div className="flex flex-col gap-2 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-2 text-xs">
            <div className="flex flex-col gap-0.5">
              <span className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider">
                Lý do bị loại:
              </span>
              <p className="text-xs text-rose-700 dark:text-rose-300 line-clamp-2">
                {candidate.reject_reason || candidate.reason || "Ảnh không đạt chuẩn in ấn tự động"}
              </p>
            </div>

            {onRescue && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRescue(candidate);
                }}
                className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 px-3 py-1.5 text-xs font-bold text-slate-950 dark:text-slate-100 shadow transition cursor-pointer"
              >
                <span><AppIcon name="seo" /></span>
                <span>Khôi phục / Rescue (Ý tưởng đột phá)</span>
              </button>
            )}
          </div>
        ) : (
          candidate.reason && (
            <p className="text-xs italic text-slate-600 dark:text-slate-400 line-clamp-2">
              &ldquo;{candidate.reason}&rdquo;
            </p>
          )
        )}
      </div>
    </div>
  );
}
