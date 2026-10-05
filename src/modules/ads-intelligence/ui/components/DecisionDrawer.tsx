import React from "react";
import type { DecisionCard } from "../../types";

export interface DecisionDrawerProps {
  readonly card: DecisionCard | null;
  readonly onClose: () => void;
  readonly onTriggerGuardedWrite?: (card: DecisionCard) => void;
  readonly onCreateBrief?: (decisionId: string) => void;
}

export function DecisionDrawer({
  card,
  onClose,
  onTriggerGuardedWrite,
  onCreateBrief,
}: DecisionDrawerProps): React.JSX.Element | null {
  if (!card) return null;

  const isPause = card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
  const isScale = card.decision === "SCALE_CANDIDATE";
  const isCreative = card.decision === "TEST_CREATIVE";
  const isWait = card.decision === "WAIT";

  const decisionColor = isPause
    ? "bg-rose-950/80 text-rose-300 border-rose-800"
    : isScale
    ? "bg-emerald-950/80 text-emerald-300 border-emerald-800"
    : isCreative
    ? "bg-amber-950/80 text-amber-300 border-amber-800"
    : "bg-slate-800 text-slate-300 border-slate-700";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Background click to close */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      {/* Drawer content panel */}
      <div className="w-full max-w-xl bg-slate-900 border-l border-slate-800 h-full overflow-y-auto p-6 flex flex-col justify-between shadow-2xl space-y-6 animate-in slide-in-from-right duration-300">
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-800 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-slate-800 text-slate-300 border border-slate-700">
                  {card.entity.type}: {card.entity.id}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${decisionColor}`}>
                  {card.decision}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    card.priority === "HIGH"
                      ? "bg-rose-950/60 text-rose-300 border border-rose-800"
                      : "bg-amber-950/60 text-amber-300 border border-amber-800"
                  }`}
                >
                  Ưu tiên {card.priority}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-800 text-slate-300 border border-slate-700">
                  Độ tin cậy: <strong className="text-cyan-300">{card.confidence}</strong>
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-100">{card.title}</h2>
              <div className="text-xs text-slate-400 font-mono mt-0.5">
                Đối tượng: {card.entity.name}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-slate-800 text-lg cursor-pointer"
              aria-label="Đóng bảng chi tiết"
            >
              ✕
            </button>
          </div>

          {/* Executive Summary */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              Tóm tắt chẩn đoán
            </h3>
            <p className="text-xs text-slate-200 bg-slate-950/50 p-3 rounded-lg border border-slate-800/80 leading-relaxed">
              {card.summary}
            </p>
          </div>

          {/* Quantitative Evidence Pack Table */}
          {card.observations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span>📋</span> Bằng chứng định lượng (Current vs Benchmark)
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 text-[10px] uppercase font-mono border-b border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Chỉ số</th>
                      <th className="py-2 px-3">Thực tế</th>
                      <th className="py-2 px-3">Ngưỡng chuẩn</th>
                      <th className="py-2 px-3">Đơn vị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono text-[11px] bg-slate-950/30">
                    {card.observations.map((obs, idx) => (
                      <tr key={idx} className="hover:bg-slate-800/30">
                        <td className="py-2 px-3 text-cyan-300 font-semibold">{obs.metric}</td>
                        <td className="py-2 px-3 text-slate-100 font-bold">{String(obs.current)}</td>
                        <td className="py-2 px-3 text-slate-400">{String(obs.benchmark)}</td>
                        <td className="py-2 px-3 text-slate-500">{obs.unit}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Hypotheses */}
          {card.hypotheses.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <span>🔬</span> Giả thuyết & Nguyên nhân khả dĩ
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-300 bg-slate-950/40 p-3 rounded-lg border border-slate-800">
                {card.hypotheses.map((hyp, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-cyan-400 font-bold mt-0.5">•</span>
                    <span>{hyp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Evidence */}
          {card.missingEvidence && card.missingEvidence.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-400 flex items-center gap-1.5">
                <span>🔎</span> Bằng chứng cần kiểm tra bổ sung (Missing Evidence)
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {card.missingEvidence.map((ev, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-950 text-amber-200/90 border border-amber-900/40"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Next Step & Blocked Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="rounded-lg border border-cyan-900/50 bg-cyan-950/20 p-3 space-y-1">
              <div className="text-[10px] font-bold text-cyan-300 uppercase tracking-wider flex items-center gap-1">
                <span>👉</span> Hành động đề xuất
              </div>
              <div className="text-xs text-slate-200 leading-relaxed">
                {card.recommendedNextStep}
              </div>
            </div>

            <div className="rounded-lg border border-rose-900/50 bg-rose-950/20 p-3 space-y-1">
              <div className="text-[10px] font-bold text-rose-300 uppercase tracking-wider flex items-center gap-1">
                <span>🚫</span> Hành động bị cấm (Blocked)
              </div>
              <ul className="text-xs text-slate-200 space-y-1">
                {card.blockedActions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-rose-400 font-bold">•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Review Trigger */}
          <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded-lg border border-slate-800">
            <strong>Kích hoạt xem xét lại:</strong> {card.reviewTrigger}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-800 pt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            {isCreative && onCreateBrief && (
              <button
                type="button"
                onClick={() => onCreateBrief(card.id)}
                className="px-4 py-2 rounded-lg border border-amber-600/70 bg-gradient-to-r from-amber-950 to-orange-950 text-amber-200 hover:text-white text-xs font-semibold hover:border-amber-400 hover:shadow-lg transition cursor-pointer flex items-center gap-1.5"
              >
                <span>✨</span>
                <span>Tạo Creative Brief ngay</span>
              </button>
            )}

            {(isPause || isScale) && onTriggerGuardedWrite && !isWait && (
              <button
                type="button"
                onClick={() => onTriggerGuardedWrite(card)}
                className={`px-4 py-2 rounded-lg border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  isPause
                    ? "border-rose-600/70 bg-gradient-to-r from-rose-950 to-red-950 text-rose-200 hover:text-white hover:border-rose-400"
                    : "border-emerald-600/70 bg-gradient-to-r from-emerald-950 to-teal-950 text-emerald-200 hover:text-white hover:border-emerald-400"
                }`}
              >
                <span>🛡️</span>
                <span>{isPause ? "Tắt quảng cáo an toàn (Guarded)" : "Scale ngân sách +20% (Guarded)"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
