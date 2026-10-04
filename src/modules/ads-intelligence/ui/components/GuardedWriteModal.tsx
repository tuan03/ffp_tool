import React, { useState } from "react";

export interface GuardedWriteProposal {
  readonly proposalId: string;
  readonly action: "PAUSE" | "ADJUST_BUDGET";
  readonly targetType: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly currentBudget?: number;
  readonly proposedBudget?: number;
  readonly reason: string;
}

export interface GuardedWriteExecutionResult {
  readonly success: boolean;
  readonly message: string;
  readonly auditLogId?: string;
}

export interface GuardedWriteModalProps {
  readonly proposal: GuardedWriteProposal | null;
  readonly executing: boolean;
  readonly executionResult: GuardedWriteExecutionResult | null;
  readonly onClose: () => void;
  readonly onExecute: (operatorConfirmText?: string) => Promise<void>;
}

export function GuardedWriteModal({
  proposal,
  executing,
  executionResult,
  onClose,
  onExecute,
}: GuardedWriteModalProps): React.JSX.Element | null {
  const [confirmed, setConfirmed] = useState(false);

  if (!proposal) return null;

  const isPause = proposal.action === "PAUSE";
  const isBudget = proposal.action === "ADJUST_BUDGET";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-tr from-amber-500 to-rose-600 text-xl shadow-lg">
              🛡️
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-100 flex items-center gap-2">
                Xác nhận Guarded Write (Ghi có kiểm soát)
              </h3>
              <p className="text-xs text-slate-400">
                Thao tác thay đổi trực tiếp tài khoản quảng cáo Meta
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Execution Result Feedback */}
        {executionResult ? (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-xl border ${
                executionResult.success
                  ? "bg-emerald-950/60 border-emerald-800 text-emerald-200"
                  : "bg-rose-950/60 border-rose-800 text-rose-200"
              }`}
            >
              <div className="font-bold text-sm flex items-center gap-2">
                <span>{executionResult.success ? "✅ Thành công!" : "❌ Không thành công"}</span>
              </div>
              <p className="text-xs mt-1 leading-relaxed">{executionResult.message}</p>
              {executionResult.auditLogId && (
                <div className="text-[11px] font-mono mt-2 text-slate-400">
                  Mã kiểm toán (Audit ID): {executionResult.auditLogId}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs font-semibold cursor-pointer"
              >
                Đóng cửa sổ
              </button>
            </div>
          </div>
        ) : (
          /* Verification & Details Form */
          <div className="space-y-4">
            {/* Diff details */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Loại hành động:</span>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded ${
                    isPause
                      ? "bg-rose-950 text-rose-300 border border-rose-800"
                      : "bg-emerald-950 text-emerald-300 border border-emerald-800"
                  }`}
                >
                  {proposal.action}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Đối tượng tác động:</span>
                <span className="font-semibold text-slate-200">
                  {proposal.targetName} ({proposal.targetType}: {proposal.targetId})
                </span>
              </div>

              {isBudget && (
                <div className="flex items-center justify-between text-xs bg-slate-900 p-2.5 rounded-lg border border-slate-800">
                  <span className="text-slate-400">Điều chỉnh ngân sách:</span>
                  <div className="flex items-center gap-2 font-mono font-bold">
                    <span className="text-slate-400">${proposal.currentBudget}/ngày</span>
                    <span className="text-cyan-400">&rarr;</span>
                    <span className="text-emerald-400">${proposal.proposedBudget}/ngày</span>
                    <span className="text-[10px] text-emerald-500 font-normal">(+20% max)</span>
                  </div>
                </div>
              )}

              <div className="space-y-1 text-xs">
                <span className="text-slate-400">Lý do & Bằng chứng:</span>
                <div className="text-slate-300 bg-slate-900 p-2 rounded border border-slate-800 text-[11px] leading-relaxed">
                  {proposal.reason}
                </div>
              </div>
            </div>

            {/* Safety Safeguards Alert */}
            <div className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-3 text-xs text-amber-200/90 space-y-1">
              <div className="font-semibold text-amber-300 flex items-center gap-1.5">
                <span>🛡️</span> Hàng rào an toàn 3 lớp (Safety Fence)
              </div>
              <ul className="text-[11px] text-amber-200/80 list-disc list-inside space-y-0.5">
                <li>Giới hạn ngân sách tối đa +20% mỗi lần tăng.</li>
                <li>Kiểm tra độ trôi trạng thái (State drift check) trước khi ghi.</li>
                <li>Tự động ghi sổ nhật ký kiểm toán (Audit Trail) có chữ ký số.</li>
              </ul>
            </div>

            {/* Confirmation checkbox */}
            <label className="flex items-center gap-2.5 text-xs text-slate-200 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/20 h-4 w-4"
              />
              <span>
                Tôi đã kiểm tra số liệu và đồng ý thực hiện hành động này trên tài khoản quảng cáo.
              </span>
            </label>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={onClose}
                disabled={executing}
                className="px-4 py-2 rounded-lg border border-slate-700 bg-slate-800 text-xs font-semibold text-slate-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => onExecute("Xác nhận bởi Media Buyer")}
                disabled={!confirmed || executing}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  !confirmed || executing
                    ? "bg-slate-800 text-slate-500 cursor-not-allowed opacity-60"
                    : isPause
                    ? "bg-gradient-to-r from-rose-600 to-red-600 text-white hover:from-rose-500 hover:to-red-500 shadow-lg shadow-rose-900/30"
                    : "bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:from-emerald-500 hover:to-teal-500 shadow-lg shadow-emerald-900/30"
                }`}
              >
                {executing && <span className="inline-block animate-spin">🔄</span>}
                <span>{executing ? "Đang ghi an toàn..." : isPause ? "Xác nhận Tắt" : "Xác nhận Điều chỉnh"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
