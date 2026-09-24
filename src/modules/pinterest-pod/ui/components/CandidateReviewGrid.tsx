import { useMemo, useState } from "react";

import type { CandidateItem, ReferenceImage } from "../../types";
import { CandidateCard } from "./CandidateCard";

export interface CandidateReviewGridProps {
  readonly candidates: readonly CandidateItem[];
  readonly rejectedCandidates?: readonly CandidateItem[];
  readonly selectedIds: readonly string[];
  readonly onToggleCandidate: (id: string) => void;
  readonly onSelectAll: () => void;
  readonly onSelectDirectPrintableOnly: () => void;
  readonly onDeselectAll: () => void;
  readonly onProduce: () => void;
  readonly isProducing?: boolean;
  readonly onPreviewCandidate?: (candidate: CandidateItem) => void;
  readonly roomTemplates?: readonly ReferenceImage[];
  readonly onRemoveRoomTemplate?: (id: string) => void;
  readonly onUseCandidateAsRoomTemplate?: (candidate: CandidateItem) => void;
  readonly onOpenRoomManager?: () => void;
  readonly onRescueCandidate?: (candidate: CandidateItem) => void;
}

type MainTab = "passed" | "rejected";
type FilterType = "all" | "recommended" | "direct" | "breakthrough" | "selected";
type SortType = "default" | "printability_desc" | "score_desc";

export function CandidateReviewGrid({
  candidates,
  rejectedCandidates = [],
  selectedIds,
  onToggleCandidate,
  onSelectAll,
  onSelectDirectPrintableOnly,
  onDeselectAll,
  onProduce,
  isProducing = false,
  onPreviewCandidate,
  roomTemplates = [],
  onRemoveRoomTemplate,
  onUseCandidateAsRoomTemplate,
  onOpenRoomManager,
  onRescueCandidate,
}: CandidateReviewGridProps): React.JSX.Element {
  const [activeTab, setActiveTab] = useState<MainTab>("passed");
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [sortBy, setSortBy] = useState<SortType>("default");

  const selectedCount = selectedIds.length;
  const recommendedCount = useMemo(() => candidates.filter((c) => c.recommended).length, [candidates]);
  const directPrintableCount = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.candidate_category === "direct_printable" ||
          (c.is_direct_printable && !c.is_breakthrough_concept),
      ).length,
    [candidates],
  );
  const breakthroughCount = useMemo(
    () =>
      candidates.filter(
        (c) =>
          c.candidate_category === "breakthrough_concept" ||
          c.is_breakthrough_concept ||
          (!c.is_direct_printable && !c.is_rejected),
      ).length,
    [candidates],
  );

  const displayedCandidates = useMemo(() => {
    let list = [...candidates];
    if (activeFilter === "recommended") {
      list = list.filter((c) => c.recommended);
    } else if (activeFilter === "direct") {
      list = list.filter(
        (c) =>
          c.candidate_category === "direct_printable" ||
          (c.is_direct_printable && !c.is_breakthrough_concept),
      );
    } else if (activeFilter === "breakthrough") {
      list = list.filter(
        (c) =>
          c.candidate_category === "breakthrough_concept" ||
          c.is_breakthrough_concept ||
          (!c.is_direct_printable && !c.is_rejected),
      );
    } else if (activeFilter === "selected") {
      list = list.filter((c) => {
        const cid = c.id || c.candidate_id || c.image_id || "";
        return selectedIds.includes(cid);
      });
    }

    if (sortBy === "printability_desc") {
      list.sort((a, b) => b.printability_score - a.printability_score);
    } else if (sortBy === "score_desc") {
      list.sort((a, b) => b.image_score - a.image_score);
    }
    return list;
  }, [candidates, activeFilter, sortBy, selectedIds]);

  return (
    <section className="flex flex-col gap-5 rounded-xl border border-slate-800 bg-slate-900/90 p-5 shadow-xl">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
            <span>🔍</span>
            <span>Duyệt &amp; Chọn mẫu ứng viên Pinterest ({candidates.length} mẫu đạt chuẩn)</span>
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Phân loại phôi: <strong>Chuẩn in 2D</strong> (giữ nguyên file) &amp; <strong>Ý tưởng đột phá</strong> (AI bóc tách hoa văn).
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

      {/* Main Mode Tabs: Passed Candidates vs. Rejected Images (Rescue) */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("passed")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
            activeTab === "passed"
              ? "bg-cyan-500 text-slate-950 shadow"
              : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span>✓ Ứng viên Hợp lệ ({candidates.length})</span>
          <span className="rounded-full bg-slate-950/30 px-1.5 py-0.2 text-[10px]">
            {directPrintableCount} Chuẩn 2D • {breakthroughCount} Đột phá
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("rejected")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
            activeTab === "rejected"
              ? "bg-rose-500 text-white shadow"
              : "bg-slate-800/80 text-rose-300 hover:bg-slate-700 hover:text-white"
          }`}
        >
          <span>🛡️ Ảnh bị loại &amp; Đề xuất giải cứu ({rejectedCandidates.length})</span>
        </button>
      </div>

      {/* Room Template Status & Pairing Bar */}
      <div className="rounded-xl border border-purple-500/30 bg-purple-950/20 p-3.5 backdrop-blur-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-900/60 text-base">
              🛋️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-purple-200">
                  Bối cảnh Mockup: {roomTemplates.length > 0 ? `${roomTemplates.length} ảnh phòng tham chiếu` : "Tự động sinh ngẫu nhiên"}
                </span>
                {roomTemplates.length > 0 && (
                  <span className="rounded bg-purple-500/30 px-1.5 py-0.5 text-[10px] font-semibold text-purple-300">
                    Ghép phòng thực tế
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                {roomTemplates.length > 0
                  ? "AI sẽ giữ nguyên căn phòng này và ghép hoa văn các mẫu đã chọn vào đúng vị trí sản phẩm."
                  : "Chưa có ảnh phòng mẫu riêng. Bạn có thể bấm nút 'Làm phòng' ở thẻ ảnh bên dưới hoặc tải ảnh từ máy tính!"}
              </p>
            </div>
          </div>

          {/* Room thumbnails & Action buttons */}
          <div className="flex flex-wrap items-center gap-2">
            {roomTemplates.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {roomTemplates.slice(0, 4).map((rt) => (
                  <div key={rt.id} className="group relative h-10 w-14 overflow-hidden rounded-md border border-purple-400/50 bg-slate-900 shadow">
                    <img src={rt.url} alt={rt.name || "Room"} className="h-full w-full object-cover" />
                    {onRemoveRoomTemplate && (
                      <button
                        type="button"
                        onClick={() => onRemoveRoomTemplate(rt.id)}
                        className="absolute inset-0 flex items-center justify-center bg-black/75 opacity-0 group-hover:opacity-100 transition text-[10px] font-bold text-rose-400 cursor-pointer"
                        title="Xóa phòng mẫu này"
                      >
                        ✕ Gỡ
                      </button>
                    )}
                  </div>
                ))}
                {roomTemplates.length > 4 && (
                  <span className="rounded-md bg-purple-900/60 px-2 py-1 text-[11px] font-semibold text-purple-300 border border-purple-500/30">
                    +{roomTemplates.length - 4}
                  </span>
                )}
              </div>
            )}

            {onOpenRoomManager && (
              <button
                type="button"
                onClick={onOpenRoomManager}
                className="flex items-center gap-1.5 rounded-lg border border-purple-500/50 bg-purple-900/40 hover:bg-purple-800/60 px-3 py-1.5 text-xs font-semibold text-purple-200 hover:text-white transition shadow-sm cursor-pointer"
              >
                <span>{roomTemplates.length > 0 ? "⚙️" : "📁"}</span>
                <span>
                  {roomTemplates.length > 0
                    ? `Quản lý phòng mẫu (${roomTemplates.length})`
                    : "Tải / Thêm ảnh phòng mẫu"}
                </span>
              </button>
            )}
          </div>
        </div>
      </div>

      {activeTab === "passed" ? (
        <>
          {/* Filter Tabs & Sort Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800/80 pb-3 text-xs">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "all"
                    ? "bg-cyan-500 text-slate-950 font-bold shadow"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-white"
                }`}
              >
                Tất cả ({candidates.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("recommended")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "recommended"
                    ? "bg-amber-500 text-slate-950 font-bold shadow"
                    : "bg-slate-800 text-amber-300 hover:bg-slate-700"
                }`}
              >
                <span>⭐</span>
                <span>Khuyên chọn ({recommendedCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("direct")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "direct"
                    ? "bg-emerald-500 text-slate-950 font-bold shadow"
                    : "bg-slate-800 text-emerald-300 hover:bg-slate-700"
                }`}
              >
                <span>🖨️</span>
                <span>Chuẩn in 2D ({directPrintableCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("breakthrough")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "breakthrough"
                    ? "bg-amber-600 text-white font-bold shadow"
                    : "bg-slate-800 text-amber-300 hover:bg-slate-700"
                }`}
              >
                <span>💡</span>
                <span>Ý tưởng đột phá ({breakthroughCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("selected")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "selected"
                    ? "bg-indigo-500 text-white font-bold shadow"
                    : "bg-slate-800 text-indigo-300 hover:bg-slate-700"
                }`}
              >
                Đã chọn ({selectedCount})
              </button>
            </div>

            {/* Sort Controls */}
            <div className="flex items-center gap-2">
              <span className="text-slate-400">Sắp xếp:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortType)}
                className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
              >
                <option value="default">Mặc định cào về</option>
                <option value="printability_desc">Điểm Chuẩn in (Cao → Thấp)</option>
                <option value="score_desc">Điểm Nét AI (Cao → Thấp)</option>
              </select>
            </div>
          </div>

          {/* Quick Batch Selection Buttons */}
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
              Hiển thị: {displayedCandidates.length}/{candidates.length} mẫu • Đã chọn: {selectedCount} mẫu
            </span>
          </div>

          {/* Grid of Passed Candidates */}
          {displayedCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
              Không có mẫu nào phù hợp với bộ lọc &ldquo;{activeFilter}&rdquo;. Hãy thử chọn bộ lọc khác.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {displayedCandidates.map((cand, idx) => {
                const candId = cand.id || cand.candidate_id || cand.image_id || `cand_${idx + 1}`;
                const isRt = roomTemplates.some(
                  (rt) => rt.id === candId || rt.url === cand.image_url,
                );
                return (
                  <CandidateCard
                    key={candId}
                    candidate={cand}
                    isSelected={selectedIds.includes(candId)}
                    onToggle={onToggleCandidate}
                    onPreview={onPreviewCandidate}
                    onUseAsRoomTemplate={onUseCandidateAsRoomTemplate}
                    isRoomTemplate={isRt}
                  />
                );
              })}
            </div>
          )}
        </>
      ) : (
        /* Rejected Images & Rescue View */
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-950/20 p-4 text-xs text-amber-200">
            <span className="text-xl">💡</span>
            <div className="flex flex-col gap-1">
              <strong className="text-amber-300 font-bold text-sm">
                Cơ chế Giải cứu Ứng viên (Rescue Capability)
              </strong>
              <p className="text-slate-300 leading-relaxed">
                Đừng vội bỏ qua các bức ảnh người mẫu, chụp góc nghiêng hoặc ảnh lifestyle nếu họa tiết hoa văn trên sản phẩm thực sự độc đáo!
                Bấm nút <strong>⚡ Khôi phục / Rescue</strong> trên thẻ ảnh để chuyển sang danh mục <em>Ý tưởng đột phá</em>.
                Ở Stage 2, AI Gemini sẽ tự động bóc tách phần hoa văn, loại bỏ tay cầm, quai đeo và bóng 3D để tạo thành file in phẳng 2D chuẩn xưởng.
              </p>
            </div>
          </div>

          {rejectedCandidates.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-400">
              Không có ảnh nào bị loại trong job này. Tất cả ảnh cào về đều đã đạt chuẩn in ấn!
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {rejectedCandidates.map((cand, idx) => {
                const candId = cand.id || cand.candidate_id || cand.image_id || `rej_${idx + 1}`;
                return (
                  <CandidateCard
                    key={candId}
                    candidate={cand}
                    isSelected={false}
                    onToggle={() => {}}
                    onPreview={onPreviewCandidate}
                    onRescue={onRescueCandidate}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
