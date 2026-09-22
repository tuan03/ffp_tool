import type { CandidateItem } from "../../types";

interface CandidateCardProps {
  readonly candidate: CandidateItem;
  readonly isSelected: boolean;
  readonly onToggle: (id: string) => void;
  readonly onPreview?: (candidate: CandidateItem) => void;
  readonly onUseAsRoomTemplate?: (candidate: CandidateItem) => void;
  readonly isRoomTemplate?: boolean;
}

export function CandidateCard({
  candidate,
  isSelected,
  onToggle,
  onPreview,
  onUseAsRoomTemplate,
  isRoomTemplate = false,
}: CandidateCardProps): React.JSX.Element {
  const candId = candidate.id || candidate.candidate_id || candidate.image_id || "";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={isSelected}
      onClick={() => onToggle(candId)}
      onKeyDown={(e) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onToggle(candId);
        }
      }}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-cyan-400 ${
        isRoomTemplate
          ? "border-purple-500 bg-purple-950/20 shadow-lg shadow-purple-500/15 ring-2 ring-purple-400"
          : isSelected
          ? "border-cyan-400 bg-slate-800/95 shadow-lg shadow-cyan-500/15 ring-2 ring-cyan-400"
          : "border-slate-800 bg-slate-900/90 hover:border-slate-600 hover:bg-slate-800/80 shadow"
      }`}
    >
      {/* Top badges & selection checkbox overlay */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
        <img
          src={candidate.image_url}
          alt={candidate.title}
          onError={(e) => {
            e.currentTarget.onerror = null;
            e.currentTarget.src =
              "data:image/svg+xml;charset=utf-8," +
              encodeURIComponent(
                `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect width="400" height="300" fill="#0f172a"/><text x="200" y="150" fill="#94a3b8" font-family="sans-serif" font-size="14" text-anchor="middle">${candidate.title.slice(0, 30)}</text></svg>`,
              );
          }}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />

        {/* Checkbox */}
        <div
          className="absolute top-2.5 left-2.5 z-10 flex items-center justify-center"
          onClick={(e) => e.stopPropagation()}
        >
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onToggle(candId)}
            aria-label={`Chọn mẫu ${candidate.title}`}
            className="h-5 w-5 rounded border-slate-600 bg-slate-900/80 text-cyan-500 accent-cyan-400 shadow focus:ring-0 cursor-pointer"
          />
        </div>

        {/* Badges */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1">
          {isRoomTemplate && (
            <span className="flex items-center gap-1 rounded-full border border-purple-400/80 bg-purple-600 px-2 py-0.5 text-[10px] font-bold text-white shadow">
              <span>🛋️</span>
              <span>Phòng Mẫu</span>
            </span>
          )}
          {candidate.recommended && (
            <span className="flex items-center gap-1 rounded-full border border-amber-500/50 bg-amber-500/90 px-2 py-0.5 text-[10px] font-bold text-slate-950 shadow">
              <span>⭐</span>
              <span>Khuyên chọn</span>
            </span>
          )}
          {candidate.is_direct_printable && (
            <span className="rounded-full border border-cyan-500/40 bg-cyan-950/80 px-2 py-0.5 text-[10px] font-semibold text-cyan-300 shadow backdrop-blur-xs">
              Chuẩn in trực tiếp
            </span>
          )}
        </div>

        {/* Pinterest external link */}
        <a
          href={candidate.pin_url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white backdrop-blur-xs transition hover:bg-rose-600"
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
              className="flex items-center gap-1 rounded-md bg-slate-900/80 px-2 py-1 text-[11px] font-medium text-slate-200 backdrop-blur-xs transition hover:bg-cyan-600 hover:text-white shadow"
              title="Soi ảnh phóng to HD"
            >
              <span>🔍</span>
              <span>Soi HD</span>
            </button>
          )}

          {onUseAsRoomTemplate && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onUseAsRoomTemplate(candidate);
              }}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium backdrop-blur-xs transition shadow ${
                isRoomTemplate
                  ? "bg-purple-600 text-white font-semibold ring-1 ring-purple-300"
                  : "bg-slate-900/80 text-slate-300 hover:bg-purple-600 hover:text-white"
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
        <h3 className="line-clamp-2 text-xs font-semibold text-slate-100" title={candidate.title}>
          {candidate.title}
        </h3>

        {/* 3 AI Vision Scores matching wireframe */}
        <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-center text-[10px]">
          <div>
            <p className="text-slate-400">Điểm nét</p>
            <p className="font-bold text-cyan-300">{candidate.image_score}/100</p>
          </div>
          <div className="border-x border-slate-800">
            <p className="text-slate-400">Chuẩn in</p>
            <p className="font-bold text-emerald-300">{candidate.printability_score}/100</p>
          </div>
          <div>
            <p className="text-slate-400">Độ phẳng</p>
            <p className="font-bold text-amber-300">{candidate.flat_artwork_score}/100</p>
          </div>
        </div>

        {candidate.reason && (
          <p className="text-[11px] italic text-slate-400 line-clamp-2">
            &ldquo;{candidate.reason}&rdquo;
          </p>
        )}
      </div>
    </div>
  );
}
