import React from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
    ? "bg-rose-50 text-rose-700 border-rose-200"
    : isScale
    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
    : isCreative
    ? "bg-amber-50 text-amber-700 border-amber-200"
    : "bg-slate-50 text-slate-700 border-slate-300";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-50 backdrop-blur-sm animate-in fade-in duration-200">
      {/* Background click to close */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      {/* Drawer content panel */}
      <div className="w-full max-w-xl bg-white border-l border-slate-200 h-full overflow-y-auto p-6 flex flex-col justify-between shadow-sm space-y-6 animate-in slide-in-from-right duration-300">
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-[10px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-slate-50 text-slate-700 border border-slate-300">
                  {card.entity.type}: {card.entity.id}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${decisionColor}`}>
                  {card.decision}
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded font-bold uppercase ${
                    card.priority === "HIGH"
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-amber-50 text-amber-700 border border-amber-200"
                  }`}
                >
                  Ưu tiên {card.priority}
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded font-mono bg-slate-50 text-slate-700 border border-slate-300">
                  Độ tin cậy: <strong className="text-blue-700">{card.confidence}</strong>
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900">{card.title}</h2>
              <div className="text-xs text-slate-600 font-mono mt-0.5">
                Đối tượng: {card.entity.name}
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-slate-600 hover:text-slate-900 p-1 rounded-lg hover:bg-slate-50 text-lg cursor-pointer"
              aria-label="Đóng bảng chi tiết"
            >
              ✕
            </button>
          </div>

          {/* Executive Summary */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600">
              Tóm tắt chẩn đoán
            </h3>
            <p className="text-xs text-slate-900 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
              {card.summary}
            </p>
          </div>

          {/* Quantitative Evidence Pack Table */}
          {card.observations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span><AppIcon name="queue" /></span> Bằng chứng định lượng (Current vs Benchmark)
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white text-slate-600 text-[10px] uppercase font-mono border-b border-slate-200">
                    <tr>
                      <th className="py-2 px-3">Chỉ số</th>
                      <th className="py-2 px-3">Thực tế</th>
                      <th className="py-2 px-3">Ngưỡng chuẩn</th>
                      <th className="py-2 px-3">Đơn vị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-mono text-[11px] bg-slate-50">
                    {card.observations.map((obs, idx) => (
                      <tr key={idx} className="hover:bg-slate-50">
                        <td className="py-2 px-3 text-blue-700 font-semibold">{obs.metric}</td>
                        <td className="py-2 px-3 text-slate-900 font-bold">{String(obs.current)}</td>
                        <td className="py-2 px-3 text-slate-600">{String(obs.benchmark)}</td>
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 flex items-center gap-1.5">
                <span>🔬</span> Giả thuyết & Nguyên nhân khả dĩ
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                {card.hypotheses.map((hyp, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-700 font-bold mt-0.5">•</span>
                    <span>{hyp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Evidence */}
          {card.missingEvidence && card.missingEvidence.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1.5">
                <span><AppIcon name="search" /></span> Bằng chứng cần kiểm tra bổ sung (Missing Evidence)
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {card.missingEvidence.map((ev, idx) => (
                  <span
                    key={idx}
                    className="text-[10px] px-2 py-0.5 rounded bg-white text-amber-700 border border-amber-200"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Next Step & Blocked Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 space-y-1">
              <div className="text-[10px] font-bold text-blue-700 uppercase tracking-wider flex items-center gap-1">
                <span>👉</span> Hành động đề xuất
              </div>
              <div className="text-xs text-slate-900 leading-relaxed">
                {card.recommendedNextStep}
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 space-y-1">
              <div className="text-[10px] font-bold text-rose-700 uppercase tracking-wider flex items-center gap-1">
                <span>🚫</span> Hành động bị cấm (Blocked)
              </div>
              <ul className="text-xs text-slate-900 space-y-1">
                {card.blockedActions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-rose-700 font-bold">•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Review Trigger */}
          <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
            <strong>Kích hoạt xem xét lại:</strong> {card.reviewTrigger}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 pt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            {isCreative && onCreateBrief && (
              <button
                type="button"
                onClick={() => onCreateBrief(card.id)}
                className="px-4 py-2 rounded-lg border border-amber-300 bg-blue-50 text-amber-700 hover:text-slate-900 text-xs font-semibold hover:border-amber-300 hover:shadow-sm transition cursor-pointer flex items-center gap-1.5"
              >
                <span><AppIcon name="seo" /></span>
                <span>Tạo Creative Brief ngay</span>
              </button>
            )}

            {(isPause || isScale) && onTriggerGuardedWrite && !isWait && (
              <button
                type="button"
                onClick={() => onTriggerGuardedWrite(card)}
                className={`px-4 py-2 rounded-lg border text-xs font-bold transition cursor-pointer flex items-center gap-1.5 ${
                  isPause
                    ? "border-rose-300 bg-blue-50 text-rose-700 hover:text-slate-900 hover:border-rose-300"
                    : "border-emerald-300 bg-blue-50 text-emerald-700 hover:text-slate-900 hover:border-emerald-300"
                }`}
              >
                <span><AppIcon name="lock" /></span>
                <span>{isPause ? "Tắt quảng cáo an toàn (Guarded)" : "Scale ngân sách +20% (Guarded)"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
