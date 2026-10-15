import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-700 pb-3">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <span>🧪</span> Quy trình Thử nghiệm & Creative Briefs (Testing Pipeline)
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400">
            Từ ý tưởng AI/đối thủ ➔ Duyệt kịch bản ➔ Chạy test 7 ngày ➔ Đánh giá Win/Loss
          </p>
        </div>

        <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-0.5 text-xs">
          <button
            type="button"
            onClick={() => setActiveSection("KANBAN")}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              activeSection === "KANBAN"
                ? "bg-slate-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            <AppIcon name="queue" /> Bảng Kanban Pipeline
          </button>
          <button
            type="button"
            onClick={() => setActiveSection("BRIEFS_DETAIL")}
            className={`px-3 py-1.5 rounded-md font-semibold transition cursor-pointer ${
              activeSection === "BRIEFS_DETAIL"
                ? "bg-slate-50 dark:bg-slate-800 text-blue-700 dark:text-blue-300"
                : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100"
            }`}
          >
            <AppIcon name="play" /> Chi tiết Kịch bản Storyboard ({briefs.length})
          </button>
        </div>
      </div>

      {activeSection === "KANBAN" ? (
        /* Visual Kanban Pipeline (4 Columns) */
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Column 1: Draft Briefs */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                <span><AppIcon name="review" /></span> 1. Bản nháp (Draft)
              </span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white dark:bg-slate-900 font-mono font-bold text-slate-600 dark:text-slate-400">
                {draftBriefs.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {draftBriefs.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  Chưa có brief nào ở trạng thái nháp.
                </div>
              ) : (
                draftBriefs.map((b) => (
                  <div
                    key={b.briefId}
                    className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 space-y-2 hover:border-slate-300 dark:hover:border-slate-700 transition"
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{b.title}</div>
                    <div className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
                      {b.creativeConcept.conceptSummary}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700">
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-mono">{b.creativeConcept.format}</span>
                      <button
                        type="button"
                        onClick={() => void onApproveBrief(b.briefId)}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/80 cursor-pointer"
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
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                <span><AppIcon name="image" /></span> 2. Đã duyệt (Approved)
              </span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white dark:bg-slate-900 font-mono font-bold text-blue-700 dark:text-blue-300">
                {approvedBriefs.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {approvedBriefs.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  Không có brief chờ khởi tạo.
                </div>
              ) : (
                approvedBriefs.map((b) => (
                  <div
                    key={b.briefId}
                    className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 space-y-2"
                  >
                    <div className="text-xs font-bold text-slate-900 dark:text-slate-100">{b.title}</div>
                    <div className="text-xs text-blue-700 dark:text-blue-300 font-mono">
                      Hook: {b.creativeConcept.hookAngle}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-slate-200 dark:border-slate-700">
                      <button
                        type="button"
                        onClick={() => onCopyMarkdown(b)}
                        className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 cursor-pointer"
                      >
                        <AppIcon name="queue" /> Copy MD
                      </button>
                      <button
                        type="button"
                        onClick={() => void onCreateExperiment(b.briefId)}
                        className="px-2 py-0.5 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/80 cursor-pointer"
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
          <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1.5">
                <span><AppIcon name="play" /></span> 3. Đang chạy test
              </span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white dark:bg-slate-900 font-mono font-bold text-blue-700 dark:text-blue-300">
                {activeExps.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {activeExps.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  Chưa có thử nghiệm nào đang live.
                </div>
              ) : (
                activeExps.map((exp) => (
                  <div
                    key={exp.id}
                    className="p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 space-y-2 shadow-sm"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{exp.title}</span>
                      <span className="text-xs px-1.5 py-0.2 rounded bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 font-mono font-bold">
                        {exp.status}
                      </span>
                    </div>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      Ngân sách: <strong>${exp.limits.budgetCapUsd}/ngày</strong> • Thời hạn: {exp.limits.reviewWindowDays} ngày
                    </div>
                    <div className="pt-1 border-t border-slate-200 dark:border-slate-700 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onOpenOutcomeModal(exp)}
                        className="px-2.5 py-1 rounded bg-blue-50 dark:bg-blue-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 text-xs font-bold hover:border-emerald-300 dark:hover:border-emerald-800 cursor-pointer"
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
          <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-2">
              <span className="text-xs font-bold text-emerald-700 dark:text-emerald-300 uppercase tracking-wider flex items-center gap-1.5">
                <span>🏆</span> 4. Tổng kết (Win/Loss)
              </span>
              <span className="text-xs px-1.5 py-0.2 rounded-full bg-white dark:bg-slate-900 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                {completedExps.length}
              </span>
            </div>

            <div className="space-y-2.5">
              {completedExps.length === 0 ? (
                <div className="text-xs text-slate-500 dark:text-slate-400 text-center py-6">
                  Chưa có thử nghiệm hoàn tất.
                </div>
              ) : (
                completedExps.map((exp) => {
                  const isWin = exp.learning?.verdict === "WIN";
                  return (
                    <div
                      key={exp.id}
                      className={`p-3 rounded-lg border bg-slate-50 dark:bg-slate-800 space-y-1.5 ${
                        isWin ? "border-emerald-200 dark:border-emerald-800" : "border-rose-200 dark:border-rose-800"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-slate-900 dark:text-slate-100">{exp.title}</span>
                        <span
                          className={`text-xs px-1.5 py-0.2 rounded font-bold font-mono ${
                            isWin
                              ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800"
                              : "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                          }`}
                        >
                          {exp.learning?.verdict || "COMPLETED"}
                        </span>
                      </div>
                      <div className="text-xs text-slate-700 dark:text-slate-300 font-mono">
                        Biến thiên: <strong className="text-blue-700 dark:text-blue-300">{exp.results?.deltaPercent ?? 0}%</strong>
                      </div>
                      <p className="text-xs text-slate-600 dark:text-slate-400 line-clamp-2">
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
            <h4 className="text-xs font-semibold uppercase text-slate-600 dark:text-slate-400 mb-2">
              Danh sách kịch bản Creative Briefs
            </h4>
            {briefs.map((b) => (
              <div
                key={b.briefId}
                onClick={() => setSelectedBrief(b)}
                className={`p-3 rounded-lg border text-xs cursor-pointer transition space-y-1 ${
                  selectedBrief?.briefId === b.briefId
                    ? "bg-slate-50 dark:bg-slate-800 border-blue-300 dark:border-blue-800 shadow-md"
                    : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-900 dark:text-slate-100">{b.title}</span>
                  <span className="text-xs px-2 py-0.2 rounded bg-white dark:bg-slate-900 font-mono text-blue-700 dark:text-blue-300 border border-slate-200 dark:border-slate-700">
                    {b.status}
                  </span>
                </div>
                <div className="text-slate-600 dark:text-slate-400 text-xs line-clamp-1">
                  {b.creativeConcept.hookAngle}
                </div>
              </div>
            ))}
          </div>

          {/* Storyboard Viewer */}
          <div className="lg:col-span-8 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-5">
            {selectedBrief ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">{selectedBrief.title}</h3>
                    <div className="text-xs text-slate-600 dark:text-slate-400 font-mono mt-0.5">
                      Định dạng: {selectedBrief.creativeConcept.format} ({selectedBrief.creativeConcept.aspectRatio}) • Style: {selectedBrief.creativeConcept.visualStyle}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onCopyMarkdown(selectedBrief)}
                    className="px-3 py-1.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 text-xs font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/80 transition cursor-pointer flex items-center gap-1.5"
                  >
                    <span><AppIcon name="queue" /></span>
                    <span>Sao chép Markdown (Notion/Trello)</span>
                  </button>
                </div>

                {/* Storyboard Scenes Table */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Phân cảnh Storyboard (30 Giây Video)
                  </h4>
                  <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs uppercase font-mono border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2 px-3">Thời gian</th>
                          <th className="py-2 px-3">Cảnh quay</th>
                          <th className="py-2 px-3">Hành động thị giác</th>
                          <th className="py-2 px-3">Lời thoại / Âm thanh</th>
                          <th className="py-2 px-3">Chữ trên màn hình</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-xs bg-slate-50 dark:bg-slate-800">
                        {selectedBrief.storyboard.map((scene, idx) => (
                          <tr key={idx} className="hover:bg-slate-100 dark:hover:bg-slate-700">
                            <td className="py-2 px-3 font-mono text-blue-700 dark:text-blue-300 font-bold whitespace-nowrap">
                              {scene.timestamp}
                            </td>
                            <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-semibold">{scene.scene}</td>
                            <td className="py-2 px-3 text-slate-700 dark:text-slate-300">{scene.visualAction}</td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400 italic">"{scene.audioVoiceover}"</td>
                            <td className="py-2 px-3 text-amber-700 dark:text-amber-300 font-medium">{scene.onScreenText}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12 text-slate-500 dark:text-slate-400 text-xs">
                Chọn một kịch bản ở cột bên trái để xem chi tiết.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
