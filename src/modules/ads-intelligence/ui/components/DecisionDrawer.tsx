import React from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../../shared/hooks/useDialogFocus";
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
  const dialogRef = useDialogFocus({ isOpen: card !== null, onClose });
  if (!card) return null;

  const isPause = card.decision === "PAUSE_CANDIDATE" || card.decision === "REDUCE_CANDIDATE";
  const isScale = card.decision === "SCALE_CANDIDATE";
  const isCreative = card.decision === "TEST_CREATIVE";
  const isWait = card.decision === "WAIT";

  const decisionColor = isPause
    ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800"
    : isScale
    ? "bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800"
    : isCreative
    ? "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800"
    : "bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700";

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Chi tiết đề xuất quảng cáo" className="fixed inset-0 z-50 flex justify-end bg-slate-900/30 backdrop-blur-sm">
      {/* Background click to close */}
      <div className="flex-1" onClick={onClose} aria-hidden="true" />

      {/* Drawer content panel */}
      <div className="w-full max-w-xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 h-full overflow-y-auto p-6 flex flex-col justify-between shadow-sm space-y-6 animate-in slide-in-from-right duration-300">
        <div className="space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between border-b border-slate-200 dark:border-slate-700 pb-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-1.5">
                <span className="text-xs px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                  {card.entity.type}: {card.entity.id}
                </span>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${decisionColor}`}>
                  {card.decision}
                </span>
                <span
                  className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                    card.priority === "HIGH"
                      ? "bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800"
                      : "bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  }`}
                >
                  Ưu tiên {card.priority}
                </span>
                <span className="text-xs px-2 py-0.5 rounded font-mono bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700">
                  Độ tin cậy: <strong className="text-blue-700 dark:text-blue-300">{card.confidence}</strong>
                </span>
              </div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{card.title}</h2>
              <div className="text-xs text-slate-600 dark:text-slate-400 font-mono mt-0.5">
                Đối tượng: {card.entity.name}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 p-1 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700 text-lg cursor-pointer"
              aria-label="Đóng bảng chi tiết"
            >
              ✕
            </button>
          </div>

          {/* Executive Summary */}
          <div className="space-y-1.5">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400">
              Tóm tắt chẩn đoán
            </h3>
            <p className="text-xs text-slate-900 dark:text-slate-100 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700 leading-relaxed">
              {card.summary}
            </p>
          </div>

          {/* Quantitative Evidence Pack Table */}
          {card.observations.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span><AppIcon name="queue" /></span> Bằng chứng định lượng (Current vs Benchmark)
              </h3>
              <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 text-xs uppercase font-mono border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2 px-3">Chỉ số</th>
                      <th className="py-2 px-3">Thực tế</th>
                      <th className="py-2 px-3">Ngưỡng chuẩn</th>
                      <th className="py-2 px-3">Đơn vị</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs bg-slate-50 dark:bg-slate-800">
                    {card.observations.map((obs, idx) => (
                      <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                        <td className="py-2 px-3 text-blue-700 dark:text-blue-300 font-semibold">{obs.metric}</td>
                        <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-bold">{String(obs.current)}</td>
                        <td className="py-2 px-3 text-slate-600 dark:text-slate-400">{String(obs.benchmark)}</td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{obs.unit}</td>
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
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-400 flex items-center gap-1.5">
                <span>🔬</span> Giả thuyết & Nguyên nhân khả dĩ
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-3 rounded-lg border border-slate-200 dark:border-slate-700">
                {card.hypotheses.map((hyp, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="text-blue-700 dark:text-blue-300 font-bold mt-0.5">•</span>
                    <span>{hyp}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missing Evidence */}
          {card.missingEvidence && card.missingEvidence.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
                <span><AppIcon name="search" /></span> Bằng chứng cần kiểm tra bổ sung (Missing Evidence)
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {card.missingEvidence.map((ev, idx) => (
                  <span
                    key={idx}
                    className="text-xs px-2 py-0.5 rounded bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800"
                  >
                    {ev}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Recommended Next Step & Blocked Actions */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-3 space-y-1">
              <div className="text-xs font-bold text-blue-700 dark:text-blue-300 uppercase tracking-wider flex items-center gap-1">
                <span>👉</span> Hành động đề xuất
              </div>
              <div className="text-xs text-slate-900 dark:text-slate-100 leading-relaxed">
                {card.recommendedNextStep}
              </div>
            </div>

            <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-3 space-y-1">
              <div className="text-xs font-bold text-rose-700 dark:text-rose-300 uppercase tracking-wider flex items-center gap-1">
                <span>🚫</span> Hành động bị cấm (Blocked)
              </div>
              <ul className="text-xs text-slate-900 dark:text-slate-100 space-y-1">
                {card.blockedActions.map((action, idx) => (
                  <li key={idx} className="flex items-start gap-1.5">
                    <span className="text-rose-700 dark:text-rose-300 font-bold">•</span>
                    <span>{action}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Review Trigger */}
          <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded-lg border border-slate-200 dark:border-slate-700">
            <strong>Kích hoạt xem xét lại:</strong> {card.reviewTrigger}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="border-t border-slate-200 dark:border-slate-700 pt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Đóng
          </button>

          <div className="flex items-center gap-2">
            {isCreative && onCreateBrief && (
              <button
                type="button"
                onClick={() => onCreateBrief(card.id)}
                className="px-4 py-2 rounded-lg border border-amber-300 dark:border-amber-800 bg-blue-50 dark:bg-blue-950/60 text-amber-700 dark:text-amber-300 hover:text-slate-900 dark:hover:text-slate-100 text-xs font-semibold hover:border-amber-300 dark:hover:border-amber-800 hover:shadow-sm transition cursor-pointer flex items-center gap-1.5"
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
                    ? "border-rose-300 dark:border-rose-800 bg-blue-50 dark:bg-blue-950/60 text-rose-700 dark:text-rose-300 hover:text-slate-900 dark:hover:text-slate-100 hover:border-rose-300 dark:hover:border-rose-800"
                    : "border-emerald-300 dark:border-emerald-800 bg-blue-50 dark:bg-blue-950/60 text-emerald-700 dark:text-emerald-300 hover:text-slate-900 dark:hover:text-slate-100 hover:border-emerald-300 dark:hover:border-emerald-800"
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
