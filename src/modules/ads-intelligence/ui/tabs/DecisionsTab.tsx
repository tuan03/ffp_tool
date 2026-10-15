import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { DecisionCard, AiStrategicReport, LocalAiRunnerInfo } from "../../types";

export interface DecisionsTabProps {
  readonly decisions: readonly DecisionCard[];
  readonly aiReport?: AiStrategicReport | null;
  readonly aiAnalyzing?: boolean;
  readonly localAiRunners?: readonly LocalAiRunnerInfo[];
  readonly onRunAiAnalysis?: (runner?: "codex" | "agy", model?: string) => void;
  readonly onSelectCard: (card: DecisionCard) => void;
  readonly onTriggerGuardedWrite?: (card: DecisionCard) => void;
  readonly onCreateBrief?: (decisionId: string) => void;
}

export function DecisionsTab({
  decisions,
  onSelectCard,
  onTriggerGuardedWrite,
  onCreateBrief,
}: DecisionsTabProps): React.JSX.Element {
  const [filterType, setFilterType] = useState<"ALL" | "PAUSE" | "SCALE" | "CREATIVE" | "WAIT">("ALL");
  const filterDecision = (card: DecisionCard): boolean => {
    if (filterType === "ALL") return true;
    if (filterType === "PAUSE") return card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
    if (filterType === "SCALE") return card.decision === "SCALE_CANDIDATE";
    if (filterType === "CREATIVE") return card.decision === "TEST_CREATIVE";
    if (filterType === "WAIT") return card.decision === "WAIT";
    return true;
  };

  const filteredDecisions = decisions.filter(filterDecision);

  // Counters
  const countPause = decisions.filter((c) => c.decision === "PAUSE_CANDIDATE" || c.decision === "REDUCE_CANDIDATE").length;
  const countScale = decisions.filter((c) => c.decision === "SCALE_CANDIDATE").length;
  const countCreative = decisions.filter((c) => c.decision === "TEST_CREATIVE").length;
  const countWait = decisions.filter((c) => c.decision === "WAIT").length;

  return (
    <div className="space-y-4">
      {/* 1. Quick Filter Pills */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          {[
            { id: "ALL", label: "Tất cả", count: decisions.length, color: "text-slate-900" },
            { id: "PAUSE", label: "Cần tắt / giảm", count: countPause, color: "text-rose-700" },
            { id: "SCALE", label: "Cơ hội scale", count: countScale, color: "text-emerald-700" },
            { id: "CREATIVE", label: "Test creative", count: countCreative, color: "text-amber-700" },
            { id: "WAIT", label: "Chờ độ chín", count: countWait, color: "text-blue-700" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilterType(tab.id as typeof filterType)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-1.5 ${
                filterType === tab.id
                  ? "bg-slate-50 border border-blue-300 text-blue-700 shadow-sm"
                  : "bg-slate-50 border border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              <span>{tab.label}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white font-mono font-bold">
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className="text-xs text-slate-600">
          Hiển thị <strong className="text-slate-900">{filteredDecisions.length}</strong> / {decisions.length} thẻ
        </div>
      </div>

      {/* 3. Action-Oriented Decision Cards (Streamlined & Ergonomic) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredDecisions.map((card) => {
          const isPause = card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
          const isScale = card.decision === "SCALE_CANDIDATE";
          const isCreative = card.decision === "TEST_CREATIVE";
          const isWait = card.decision === "WAIT";

          const cardBorderColor = isPause
            ? "border-rose-200 hover:border-rose-200 bg-blue-50 "
            : isScale
            ? "border-emerald-200 hover:border-emerald-200 bg-blue-50 "
            : isCreative
            ? "border-amber-200 hover:border-amber-200 bg-blue-50 "
            : "border-slate-200 hover:border-slate-300 bg-slate-50";

          return (
            <div
              key={card.id}
              className={`rounded-lg border p-4 space-y-3.5 shadow-sm transition flex flex-col justify-between ${cardBorderColor}`}
            >
              <div className="space-y-2.5">
                {/* Header row: Action Tag & Target */}
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                        isPause
                          ? "bg-rose-50 text-rose-700 border-rose-200"
                          : isScale
                          ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                          : isCreative
                          ? "bg-amber-50 text-amber-700 border-amber-200"
                          : "bg-slate-50 text-slate-700 border-slate-300"
                      }`}
                    >
                      {card.decision}
                    </span>
                    <span className="text-[10px] px-2 py-0.5 rounded font-mono uppercase bg-white text-slate-600 border border-slate-200">
                      {card.entity.type}: {card.entity.name}
                    </span>
                  </div>

                  <span
                    className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                      card.priority === "HIGH"
                        ? "bg-rose-50 text-rose-700 border border-rose-200"
                        : "bg-amber-50 text-amber-700 border border-amber-200"
                    }`}
                  >
                    Ưu tiên {card.priority}
                  </span>
                </div>

                {/* Title & 1-Line punchy reason */}
                <div>
                  <h4 className="text-sm font-bold text-slate-900">{card.title}</h4>
                  <p className="text-xs text-slate-700 mt-1 leading-relaxed line-clamp-2">
                    {card.summary}
                  </p>
                </div>

                {/* Key Observations Pill Bar */}
                {card.observations.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    {card.observations.slice(0, 3).map((obs, idx) => (
                      <div
                        key={idx}
                        className="text-[10px] px-2 py-1 rounded bg-white border border-slate-200 text-slate-700 font-mono flex items-center gap-1"
                      >
                        <span className="text-slate-600">{obs.metric}:</span>
                        <strong className="text-blue-700">{String(obs.current)}</strong>
                        <span className="text-slate-500">/ {String(obs.benchmark)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom Actions: Quick trigger + Open Detail Drawer */}
              <div className="flex items-center justify-between gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => onSelectCard(card)}
                  className="text-xs text-blue-700 hover:text-blue-700 font-semibold flex items-center gap-1 cursor-pointer"
                >
                  <span><AppIcon name="search" /></span>
                  <span>Xem bằng chứng chi tiết</span>
                </button>

                <div className="flex items-center gap-2">
                  {isCreative && onCreateBrief && (
                    <button
                      type="button"
                      onClick={() => onCreateBrief(card.id)}
                      className="px-2.5 py-1 rounded-lg border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-50 text-xs font-semibold transition cursor-pointer"
                    >
                      <AppIcon name="seo" /> Tạo Brief
                    </button>
                  )}

                  {(isPause || isScale) && onTriggerGuardedWrite && !isWait && (
                    <button
                      type="button"
                      onClick={() => onTriggerGuardedWrite(card)}
                      className={`px-2.5 py-1 rounded-lg text-xs font-bold transition cursor-pointer ${
                        isPause
                          ? "bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-50"
                          : "bg-emerald-50 border border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                      }`}
                    >
                      {isPause ? "🛡️ Tắt" : "🛡️ Scale +20%"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
