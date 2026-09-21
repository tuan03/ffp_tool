import type { CandidateItem } from "../../types";
import { CandidateCard } from "./CandidateCard";

interface CandidateReviewGridProps {
  readonly candidates: readonly CandidateItem[];
  readonly selectedIds: readonly string[];
  readonly onToggleCandidate: (id: string) => void;
  readonly onSelectAll: () => void;
  readonly onSelectDirectPrintableOnly: () => void;
  readonly onDeselectAll: () => void;
  readonly onProduce: () => void;
  readonly isProducing?: boolean;
}

export function CandidateReviewGrid({
  candidates,
  selectedIds,
  onToggleCandidate,
  onSelectAll,
  onSelectDirectPrintableOnly,
  onDeselectAll,
  onProduce,
  isProducing = false,
}: CandidateReviewGridProps): React.JSX.Element {
  const selectedCount = selectedIds.length;

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span>🔍</span>
            <span>Duyệt &amp; Chọn mẫu ứng viên Pinterest ({candidates.length} mẫu)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Chọn các mẫu tiềm năng để hệ thống tạo file in CMYK 300 DPI và ghép phối cảnh mockup AI sống động.
          </p>
        </div>

        {/* Action button */}
        <button
          type="button"
          onClick={onProduce}
          disabled={selectedCount === 0 || isProducing}
          className="flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 px-5 py-2.5 text-sm font-bold text-slate-950 shadow-lg shadow-orange-500/25 transition hover:from-amber-400 hover:to-orange-500 hover:shadow-orange-500/40 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span>🚀</span>
          <span>{isProducing ? "Đang gửi lệnh..." : `Sản xuất File In & Mockup (${selectedCount})`}</span>
        </button>
      </div>

      {/* Quick Selection Buttons */}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <button
          type="button"
          onClick={onSelectAll}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-200 transition hover:bg-slate-700 hover:text-white"
        >
          Chọn tất cả ({candidates.length})
        </button>
        <button
          type="button"
          onClick={onSelectDirectPrintableOnly}
          className="rounded-lg border border-cyan-800/60 bg-cyan-950/40 px-3 py-1.5 font-medium text-cyan-300 transition hover:bg-cyan-900/60"
        >
          Chỉ chọn mẫu Chuẩn In (Direct)
        </button>
        <button
          type="button"
          onClick={onDeselectAll}
          className="rounded-lg border border-slate-700 bg-slate-800 px-3 py-1.5 font-medium text-slate-400 transition hover:bg-slate-700 hover:text-slate-200"
        >
          Bỏ chọn
        </button>

        <span className="ml-auto text-xs font-semibold text-cyan-300">
          Đã chọn: {selectedCount} / {candidates.length} mẫu
        </span>
      </div>

      {/* Grid of Candidates */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
        {candidates.map((cand, idx) => {
          const candId = cand.id || cand.candidate_id || cand.image_id || `cand_${idx + 1}`;
          return (
            <CandidateCard
              key={candId}
              candidate={cand}
              isSelected={selectedIds.includes(candId)}
              onToggle={onToggleCandidate}
            />
          );
        })}
      </div>
    </section>
  );
}
