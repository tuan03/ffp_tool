import type { CandidateItem } from "../../types";

interface CandidateCardProps {
  readonly candidate: CandidateItem;
  readonly isSelected: boolean;
  readonly onToggle: (id: string) => void;
}

export function CandidateCard({
  candidate,
  isSelected,
  onToggle,
}: CandidateCardProps): React.JSX.Element {
  return (
    <div
      onClick={() => onToggle(candidate.id)}
      className={`group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border transition-all duration-200 ${
        isSelected
          ? "border-cyan-400 bg-slate-800/95 shadow-lg shadow-cyan-500/15 ring-2 ring-cyan-400"
          : "border-slate-800 bg-slate-900/90 hover:border-slate-600 hover:bg-slate-800/80 shadow"
      }`}
    >
      {/* Top badges & selection checkbox overlay */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-slate-950">
        <img
          src={candidate.image_url}
          alt={candidate.title}
          className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
        />

        {/* Checkbox */}
        <div className="absolute top-2.5 left-2.5 z-10 flex items-center justify-center">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => {
              /* toggled by parent div click */
            }}
            aria-label={`Chọn mẫu ${candidate.title}`}
            className="h-5 w-5 rounded border-slate-600 bg-slate-900/80 text-cyan-500 accent-cyan-400 shadow focus:ring-0 cursor-pointer"
          />
        </div>

        {/* Badges */}
        <div className="absolute top-2.5 right-2.5 z-10 flex flex-col items-end gap-1">
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
      </div>

      {/* Content & Metrics */}
      <div className="flex flex-1 flex-col p-3.5 gap-2.5">
        <h3 className="line-clamp-2 text-xs font-semibold text-slate-100" title={candidate.title}>
          {candidate.title}
        </h3>

        {/* 3 AI Vision Scores */}
        <div className="grid grid-cols-3 gap-1.5 rounded-lg border border-slate-800 bg-slate-950/70 p-2 text-center text-[10px]">
          <div>
            <p className="text-slate-400">Điểm nét</p>
            <p className="font-bold text-cyan-300">{candidate.image_score}</p>
          </div>
          <div className="border-x border-slate-800">
            <p className="text-slate-400">Chuẩn in</p>
            <p className="font-bold text-emerald-300">{candidate.printability_score}</p>
          </div>
          <div>
            <p className="text-slate-400">Độ phẳng</p>
            <p className="font-bold text-amber-300">{candidate.flat_artwork_score}</p>
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
