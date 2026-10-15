import { useMemo, useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
  const [rescueBanner, setRescueBanner] = useState<string | null>(null);

  const handleRescue = (cand: CandidateItem): void => {
    onRescueCandidate?.(cand);
    setRescueBanner(
      `Đã giải cứu thành công mẫu "${(cand.title || "Ứng viên").slice(0, 35)}..."! Mẫu đã được chuyển sang danh sách Ứng viên Hợp lệ (Ý tưởng đột phá).`,
    );
  };

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
    <section className="flex flex-col gap-5 rounded-lg border border-slate-200 bg-slate-50 p-5 shadow-sm">
      {/* Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-4">
        <div>
          <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
            <span><AppIcon name="search" /></span>
            <span>Duyệt &amp; Chọn mẫu ứng viên Pinterest ({candidates.length} mẫu đạt chuẩn)</span>
          </h2>
          <p className="text-xs text-slate-600 mt-0.5">
            Phân loại phôi: <strong>Chuẩn in 2D</strong> (giữ nguyên file) &amp; <strong>Ý tưởng đột phá</strong> (AI bóc tách hoa văn).
          </p>
        </div>

        {/* Action button */}
        <button
          type="button"
          onClick={onProduce}
          disabled={selectedCount === 0 || isProducing}
          className="flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span><AppIcon name="play" /></span>
          <span>{isProducing ? "Đang gửi lệnh..." : `Sản xuất File In & Mockup (${selectedCount})`}</span>
        </button>
      </div>

      {/* Rescue Feedback Banner */}
      {rescueBanner && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3.5 text-xs text-emerald-700 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="text-base">🎉</span>
            <span className="font-semibold">{rescueBanner}</span>
          </div>
          <button
            type="button"
            onClick={() => setActiveTab("passed")}
            className="shrink-0 rounded-lg bg-emerald-700 hover:bg-emerald-700 px-3 py-1 font-bold text-white transition cursor-pointer"
          >
            Xem trong tab Hợp lệ →
          </button>
        </div>
      )}

      {/* Main Mode Tabs: Passed Candidates vs. Rejected Images (Rescue) */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("passed")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
            activeTab === "passed"
              ? "bg-blue-600 text-white shadow"
              : "bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span>✓ Ứng viên Hợp lệ ({candidates.length})</span>
          <span className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">
            {directPrintableCount} Chuẩn 2D • {breakthroughCount} Đột phá
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("rejected")}
          className={`flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-bold transition cursor-pointer ${
            activeTab === "rejected"
              ? "bg-rose-600 text-white shadow"
              : "bg-slate-50 text-rose-700 hover:bg-slate-100 hover:text-slate-900"
          }`}
        >
          <span><AppIcon name="lock" /> Ảnh bị loại &amp; Đề xuất giải cứu ({rejectedCandidates.length})</span>
        </button>
      </div>

      {/* Room Template Status & Pairing Bar */}
      <div className="rounded-lg border border-blue-300 bg-blue-50 p-3.5 backdrop-blur-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-base">
              <AppIcon name="image" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-blue-700">
                  Bối cảnh Mockup: {roomTemplates.length > 0 ? `${roomTemplates.length} ảnh phòng tham chiếu` : "Tự động sinh ngẫu nhiên"}
                </span>
                {roomTemplates.length > 0 && (
                  <span className="rounded bg-blue-50 px-1.5 py-0.5 text-xs font-semibold text-blue-700">
                    Ghép phòng thực tế
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-600 mt-0.5">
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
                  <div key={rt.id} className="group relative h-10 w-14 overflow-hidden rounded-md border border-blue-300 bg-white shadow">
                    <img src={rt.url} alt={rt.name || "Room"} className="h-full w-full object-cover" />
                    {onRemoveRoomTemplate && (
                      <button
                        type="button"
                        onClick={() => onRemoveRoomTemplate(rt.id)}
                        className="absolute inset-0 flex items-center justify-center bg-black/75 opacity-0 group-hover:opacity-100 transition text-xs font-bold text-white cursor-pointer"
                        title="Xóa phòng mẫu này"
                      >
                        ✕ Gỡ
                      </button>
                    )}
                  </div>
                ))}
                {roomTemplates.length > 4 && (
                  <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700 border border-blue-300">
                    +{roomTemplates.length - 4}
                  </span>
                )}
              </div>
            )}

            {onOpenRoomManager && (
              <button
                type="button"
                onClick={onOpenRoomManager}
                className="flex items-center gap-1.5 rounded-lg border border-blue-300 bg-blue-50 hover:bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:text-slate-900 transition shadow-sm cursor-pointer"
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
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3 text-xs">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setActiveFilter("all")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "all"
                    ? "bg-blue-600 text-white font-bold shadow"
                    : "bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                }`}
              >
                Tất cả ({candidates.length})
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("recommended")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "recommended"
                    ? "bg-amber-700 text-white font-bold shadow"
                    : "bg-slate-50 text-amber-700 hover:bg-slate-100"
                }`}
              >
                <span><AppIcon name="star" /></span>
                <span>Khuyên chọn ({recommendedCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("direct")}
                className={`flex items-center gap-1 rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "direct"
                    ? "bg-emerald-700 text-white font-bold shadow"
                    : "bg-slate-50 text-emerald-700 hover:bg-slate-100"
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
                    ? "bg-amber-700 text-white font-bold shadow"
                    : "bg-slate-50 text-amber-700 hover:bg-slate-100"
                }`}
              >
                <span><AppIcon name="info" /></span>
                <span>Ý tưởng đột phá ({breakthroughCount})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveFilter("selected")}
                className={`rounded-lg px-3 py-1.5 font-medium transition ${
                  activeFilter === "selected"
                    ? "bg-blue-600 text-white font-bold shadow"
                    : "bg-slate-50 text-blue-700 hover:bg-slate-100"
                }`}
              >
                Đã chọn ({selectedCount})
              </button>
            </div>

            {/* Sort Controls */}
            <div className="flex items-center gap-2">
              <span className="text-slate-600">Sắp xếp:</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortType)}
                className="rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs text-slate-900 focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30"
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
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-medium text-slate-900 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Chọn tất cả ({candidates.length})
            </button>
            <button
              type="button"
              onClick={onSelectDirectPrintableOnly}
              className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-1.5 font-medium text-blue-700 transition hover:bg-blue-50"
            >
              Chỉ chọn mẫu Chuẩn In (Direct)
            </button>
            <button
              type="button"
              onClick={onDeselectAll}
              className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              Bỏ chọn
            </button>

            <span className="ml-auto text-xs font-semibold text-blue-700">
              Hiển thị: {displayedCandidates.length}/{candidates.length} mẫu • Đã chọn: {selectedCount} mẫu
            </span>
          </div>

          {/* Grid of Passed Candidates */}
          {displayedCandidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs text-slate-600">
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
          <div className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-xs text-amber-700">
            <span className="text-xl"><AppIcon name="info" /></span>
            <div className="flex flex-col gap-1">
              <strong className="text-amber-700 font-bold text-sm">
                Cơ chế Giải cứu Ứng viên (Rescue Capability)
              </strong>
              <p className="text-slate-700 leading-relaxed">
                Đừng vội bỏ qua các bức ảnh người mẫu, chụp góc nghiêng hoặc ảnh lifestyle nếu họa tiết hoa văn trên sản phẩm thực sự độc đáo!
                Bấm nút <strong><AppIcon name="seo" /> Khôi phục / Rescue</strong> trên thẻ ảnh để chuyển sang danh mục <em>Ý tưởng đột phá</em>.
                Ở Stage 2, AI Gemini sẽ tự động bóc tách phần hoa văn, loại bỏ tay cầm, quai đeo và bóng 3D để tạo thành file in phẳng 2D chuẩn xưởng.
              </p>
            </div>
          </div>

          {rejectedCandidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-xs text-slate-600">
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
                    onRescue={handleRescue}
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
