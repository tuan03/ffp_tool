import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { AdsExperiment } from "../../types";

export type ExperimentOutcomeVerdict = "WIN" | "LOSS" | "INCONCLUSIVE";

export interface ExperimentOutcomeModalProps {
  readonly experiment: AdsExperiment | null;
  readonly saving: boolean;
  readonly onClose: () => void;
  readonly onSave: (verdict: ExperimentOutcomeVerdict, deltaPct: number, learningNotes: string) => Promise<void>;
}

export function ExperimentOutcomeModal({
  experiment,
  saving,
  onClose,
  onSave,
}: ExperimentOutcomeModalProps): React.JSX.Element | null {
  const [verdict, setVerdict] = useState<ExperimentOutcomeVerdict>("WIN");
  const [deltaPct, setDeltaPct] = useState<number>(-25.0);
  const [learningNotes, setLearningNotes] = useState<string>(
    "Creative angle mới đã cải thiện đáng kể CTR và giảm CPA thực tế."
  );

  if (!experiment) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSave(verdict, deltaPct, learningNotes);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-md rounded-lg border border-slate-300 bg-white p-6 shadow-sm space-y-5 animate-in zoom-in-95 duration-200">
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-xl shadow-sm">
              🏆
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900">Ghi nhận kết quả thử nghiệm</h3>
              <p className="text-xs text-slate-600 font-mono mt-0.5">{experiment.title}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          {/* Verdict selector */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700">Đánh giá chung (Verdict):</label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "WIN", label: "🟢 Thắng (Win)", border: "border-emerald-300 bg-emerald-50 text-emerald-700" },
                { value: "LOSS", label: "🔴 Thua (Loss)", border: "border-rose-300 bg-rose-50 text-rose-700" },
                { value: "INCONCLUSIVE", label: "⚪ Không rõ", border: "border-slate-300 bg-slate-50 text-slate-700" },
              ].map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setVerdict(opt.value as ExperimentOutcomeVerdict)}
                  className={`p-2.5 rounded-lg border text-center font-bold text-xs transition cursor-pointer ${
                    verdict === opt.value
                      ? opt.border
                      : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Metric Delta */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700">
              Mức thay đổi chỉ số chính (%) (Ví dụ: -28.5% CPA):
            </label>
            <input
              type="number"
              step="0.1"
              value={deltaPct}
              onChange={(e) => setDeltaPct(Number(e.target.value))}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 font-mono focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300"
            />
          </div>

          {/* Learning notes */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-700">Bài học & Kết luận kinh nghiệm:</label>
            <textarea
              rows={3}
              value={learningNotes}
              onChange={(e) => setLearningNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white p-2.5 text-slate-900 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 resize-none text-xs leading-relaxed"
            />
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 hover:text-slate-900 cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white font-bold text-xs shadow-md transition flex items-center gap-1.5 cursor-pointer"
            >
              {saving && <span className="inline-block animate-spin"><AppIcon name="refresh" /></span>}
              <span>{saving ? "Đang lưu..." : "Lưu kết quả"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
