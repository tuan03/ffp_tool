import React, { useState } from "react";
import type { CreativeBrief, AdsExperiment } from "../../types";

export interface ExperimentsTabProps {
  readonly briefs: readonly CreativeBrief[];
  readonly experiments: readonly AdsExperiment[];
  readonly onApproveBrief: (briefId: string) => Promise<void>;
  readonly onCreateExperiment: (briefId: string) => Promise<void>;
  readonly onCopyMarkdown: (brief: CreativeBrief) => void;
  readonly onOpenOutcomeModal: (experiment: AdsExperiment) => void;
}

export function ExperimentsTab({
  briefs,
  experiments,
  onApproveBrief,
  onCreateExperiment,
  onCopyMarkdown,
  onOpenOutcomeModal,
}: ExperimentsTabProps): React.JSX.Element {
  const [activeSection, setActiveSection] = useState<"KANBAN" | "BRIEFS_DETAIL">("KANBAN");
  const [selectedBrief, setSelectedBrief] = useState<CreativeBrief | null>(briefs[0] || null);

  // Group items by stage for Kanban
  const draftBriefs = briefs.filter((b) => b.status === "DRAFT");
  const approvedBriefs = briefs.filter((b) => b.status === "APPROVED" || b.status === "IN_PRODUCTION" || b.status === "READY_FOR_TEST");
  const activeExps = experiments.filter((e) => e.status === "RUNNING" || e.status === "MATURING" || e.status === "APPROVED");
  const completedExps = experiments.filter((e) => e.status === "COMPLETED" || e.status === "INCONCLUSIVE" || e.status === "ABORTED");

  return (
    <div className="space-y-6">
      {/* Top Controls & View Mode Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-100 flex items-center gap-2">
            <span>🧪</span> Quy trình Thử nghiệm & Creative Briefs (Testing Pipeline)
          </h3>
          <p className="text-xs text-slate-400">
            Từ ý tưởng AI/đối thủ ➔ Duyệt kịch bản ➔ Chạy test 7 ngày ➔ Đánh giá Win/Loss
          </p>
        </div>

        <div className="flex rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveSection("KANBAN")}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              activeSection === "KANBAN"
                ? "bg-slate-800 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            📋 Bảng Kanban Pipeline
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("BRIEFS_DETAIL")}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              activeSection === "BRIEFS_DETAIL"
                ? "bg-slate-800 text-cyan-300"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            🎬 Chi tiết Kịch bản Storyboard ({briefs.length})
          </button>
        </div>
      </div>

      {activeSection === "KANBAN" ? (
        /* Visual Kanban Pipeline (4 Columns) */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Column 1: Draft Briefs */}
          <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>📝</span> 1. Bản nháp (Draft)
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950 font-mono font-bold text-slate-400">
                {draftBriefs.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {draftBriefs.length === 0 ? (
                <div className="text-[11px] text-slate-500 text-center py-6">
                  Chưa có brief nào ở trạng thái nháp.
                </div>
              ) : (
                draftBriefs.map((b) => (
                  <div
                    key={b.briefId}
                    className="p-3 rounded-lg border border-slate-800 bg-slate-950/80 space-y-2 hover:border-slate-700 transition"
                  >
                    <div className="text-xs font-bold text-slate-200">{b.title}</div>
                    <div className="text-[11px] text-slate-400 line-clamp-2">
                      {b.creativeConcept.conceptSummary}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                      <span className="text-[10px] text-slate-500 font-mono">{b.creativeConcept.format}</span>
                      <button
                        type="button"
                        onClick={() => void onApproveBrief(b.briefId)}
                        className="px-2 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-800 text-[10px] font-semibold hover:bg-cyan-900 cursor-pointer"
                      >
                        ✓ Duyệt Brief
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 2: Approved / Ready */}
          <div className="rounded-xl border border-blue-900/50 bg-slate-900/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🎨</span> 2. Đã duyệt (Approved)
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950 font-mono font-bold text-blue-400">
                {approvedBriefs.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {approvedBriefs.length === 0 ? (
                <div className="text-[11px] text-slate-500 text-center py-6">
                  Không có brief chờ khởi tạo.
                </div>
              ) : (
                approvedBriefs.map((b) => (
                  <div
                    key={b.briefId}
                    className="p-3 rounded-lg border border-blue-900/40 bg-slate-950/80 space-y-2"
                  >
                    <div className="text-xs font-bold text-slate-200">{b.title}</div>
                    <div className="text-[10px] text-cyan-300 font-mono">
                      Hook: {b.creativeConcept.hookAngle}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-900">
                      <button
                        type="button"
                        onClick={() => onCopyMarkdown(b)}
                        className="text-[10px] text-slate-400 hover:text-white cursor-pointer"
                      >
                        📋 Copy MD
                      </button>
                      <button
                        type="button"
                        onClick={() => void onCreateExperiment(b.briefId)}
                        className="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 text-[10px] font-semibold hover:bg-blue-900 cursor-pointer"
                      >
                        + Tạo Test
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 3: Active Testing */}
          <div className="rounded-xl border border-indigo-900/50 bg-slate-900/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-indigo-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🚀</span> 3. Đang chạy test
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950 font-mono font-bold text-indigo-400">
                {activeExps.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {activeExps.length === 0 ? (
                <div className="text-[11px] text-slate-500 text-center py-6">
                  Chưa có thử nghiệm nào đang live.
                </div>
              ) : (
                activeExps.map((exp) => (
                  <div
                    key={exp.id}
                    className="p-3 rounded-lg border border-indigo-900/50 bg-slate-950/80 space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-200">{exp.title}</span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono font-bold">
                        {exp.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-400">
                      Ngân sách: <strong>${exp.limits.budgetCapUsd}/ngày</strong> • Thời hạn: {exp.limits.reviewWindowDays} ngày
                    </div>
                    <div className="pt-1 border-t border-slate-900 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenOutcomeModal(exp)}
                        className="px-2.5 py-1 rounded bg-gradient-to-r from-emerald-950 to-teal-950 text-emerald-300 border border-emerald-800 text-[10px] font-bold hover:border-emerald-500 cursor-pointer"
                      >
                        🏆 Ghi nhận Kết quả
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Column 4: Outcome (Win / Loss) */}
          <div className="rounded-xl border border-emerald-900/50 bg-slate-900/50 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-bold text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🏆</span> 4. Tổng kết (Win/Loss)
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-slate-950 font-mono font-bold text-emerald-400">
                {completedExps.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {completedExps.length === 0 ? (
                <div className="text-[11px] text-slate-500 text-center py-6">
                  Chưa có thử nghiệm hoàn tất.
                </div>
              ) : (
                completedExps.map((exp) => {
                  const isWin = exp.learning?.verdict === "WIN";
                  return (
                    <div
                      key={exp.id}
                      className={`p-3 rounded-lg border bg-slate-950/80 space-y-1.5 ${
                        isWin ? "border-emerald-800/80" : "border-rose-800/80"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-200">{exp.title}</span>
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded font-bold font-mono ${
                            isWin
                              ? "bg-emerald-950 text-emerald-300 border border-emerald-800"
                              : "bg-rose-950 text-rose-300 border border-rose-800"
                          }`}
                        >
                          {exp.learning?.verdict || "COMPLETED"}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-300 font-mono">
                        Biến thiên: <strong className="text-cyan-300">{exp.results?.deltaPercent ?? 0}%</strong>
                      </div>
                      <p className="text-[10px] text-slate-400 line-clamp-2">
                        {exp.learning?.conclusion || "Không có ghi chú kết luận."}
                      </p>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Detailed Storyboard View */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Brief List Selector */}
          <div className="lg:col-span-4 space-y-2">
            <h4 className="text-xs font-semibold uppercase text-slate-400 mb-2">
              Danh sách kịch bản Creative Briefs
            </h4>
            {briefs.map((b) => (
              <div
                key={b.briefId}
                onClick={() => setSelectedBrief(b)}
                className={`p-3 rounded-xl border text-xs cursor-pointer transition space-y-1 ${
                  selectedBrief?.briefId === b.briefId
                    ? "bg-slate-800 border-cyan-500/60 shadow-md"
                    : "bg-slate-900/60 border-slate-800 hover:bg-slate-850 hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">{b.title}</span>
                  <span className="text-[10px] px-2 py-0.2 rounded bg-slate-950 font-mono text-cyan-300 border border-slate-800">
                    {b.status}
                  </span>
                </div>
                <div className="text-slate-400 text-[11px] line-clamp-1">
                  {b.creativeConcept.hookAngle}
                </div>
              </div>
            ))}
          </div>

          {/* Storyboard Viewer */}
          <div className="lg:col-span-8 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 space-y-5">
            {selectedBrief ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">{selectedBrief.title}</h3>
                    <div className="text-xs text-slate-400 font-mono mt-0.5">
                      Định dạng: {selectedBrief.creativeConcept.format} ({selectedBrief.creativeConcept.aspectRatio}) • Style: {selectedBrief.creativeConcept.visualStyle}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCopyMarkdown(selectedBrief)}
                    className="px-3 py-1.5 rounded-lg border border-purple-600/50 bg-purple-950/40 text-purple-200 text-xs font-semibold hover:bg-purple-900/50 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span>📋</span>
                    <span>Sao chép Markdown (Notion/Trello)</span>
                  </button>
                </div>

                {/* Storyboard Scenes Table */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Phân cảnh Storyboard (30 Giây Video)
                  </h4>
                  <div className="overflow-x-auto rounded-xl border border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                        <tr>
                          <th className="py-2 px-3">Thời gian</th>
                          <th className="py-2 px-3">Cảnh quay</th>
                          <th className="py-2 px-3">Hành động thị giác</th>
                          <th className="py-2 px-3">Lời thoại / Âm thanh</th>
                          <th className="py-2 px-3">Chữ trên màn hình</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800 text-xs bg-slate-950/30">
                        {selectedBrief.storyboard.map((scene, idx) => (
                          <tr key={idx} className="hover:bg-slate-850/40">
                            <td className="py-2 px-3 font-mono text-cyan-300 font-bold whitespace-nowrap">
                              {scene.timestamp}
                            </td>
                            <td className="py-2 px-3 text-slate-200 font-semibold">{scene.scene}</td>
                            <td className="py-2 px-3 text-slate-300">{scene.visualAction}</td>
                            <td className="py-2 px-3 text-slate-400 italic">"{scene.audioVoiceover}"</td>
                            <td className="py-2 px-3 text-amber-300 font-medium">{scene.onScreenText}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 text-xs">
                Chọn một kịch bản ở cột bên trái để xem chi tiết.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
