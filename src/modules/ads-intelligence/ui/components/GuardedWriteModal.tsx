import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../../shared/hooks/useDialogFocus";
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
  const dialogRef = useDialogFocus({ isOpen: proposal !== null, onClose: () => { if (!executing) onClose(); } });

  if (!proposal) return null;

  const isPause = proposal.action === "PAUSE";
  const isBudget = proposal.action === "ADJUST_BUDGET";

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Xác nhận Guarded Write" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-lg border border-slate-300 bg-white p-6 shadow-sm space-y-5 animate-in zoom-in-95 duration-200">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-50 text-xl shadow-sm">
              <AppIcon name="lock" />
            </span>
            <div>
              <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                Xác nhận Guarded Write (Ghi có kiểm soát)
              </h3>
              <p className="text-xs text-slate-600">
                Thao tác thay đổi trực tiếp tài khoản quảng cáo Meta
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={executing}
            onClick={onClose}
            className="text-slate-600 hover:text-slate-900 p-1 rounded-lg text-lg cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Execution Result Feedback */}
        {executionResult ? (
          <div className="space-y-4">
            <div
              className={`p-4 rounded-lg border ${
                executionResult.success
                  ? "bg-emerald-50 border-emerald-200 text-emerald-700"
                  : "bg-rose-50 border-rose-200 text-rose-700"
              }`}
            >
              <div className="font-bold text-sm flex items-center gap-2">
                <span>{executionResult.success ? "✅ Thành công!" : "❌ Không thành công"}</span>
              </div>
              <p className="text-xs mt-1 leading-relaxed">{executionResult.message}</p>
              {executionResult.auditLogId && (
                <div className="text-xs font-mono mt-2 text-slate-600">
                  Mã kiểm toán (Audit ID): {executionResult.auditLogId}
                </div>
              )}
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 rounded-lg bg-slate-50 text-slate-900 hover:bg-slate-100 text-xs font-semibold cursor-pointer"
              >
                Đóng cửa sổ
              </button>
            </div>
          </div>
        ) : (
          /* Verification & Details Form */
          <div className="space-y-4">
            {/* Diff details */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Loại hành động:</span>
                <span
                  className={`font-mono font-bold px-2 py-0.5 rounded ${
                    isPause
                      ? "bg-rose-50 text-rose-700 border border-rose-200"
                      : "bg-emerald-50 text-emerald-700 border border-emerald-200"
                  }`}
                >
                  {proposal.action}
                </span>
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-600">Đối tượng tác động:</span>
                <span className="font-semibold text-slate-900">
                  {proposal.targetName} ({proposal.targetType}: {proposal.targetId})
                </span>
              </div>

              {isBudget && (
                <div className="flex items-center justify-between text-xs bg-white p-2.5 rounded-lg border border-slate-200">
                  <span className="text-slate-600">Điều chỉnh ngân sách:</span>
                  <div className="flex items-center gap-2 font-mono font-bold">
                    <span className="text-slate-600">${proposal.currentBudget}/ngày</span>
                    <span className="text-blue-700">&rarr;</span>
                    <span className="text-emerald-700">${proposal.proposedBudget}/ngày</span>
                    <span className="text-xs text-emerald-700 font-normal">(+20% max)</span>
                  </div>
                </div>
              )}

              <div className="space-y-1 text-xs">
                <span className="text-slate-600">Lý do & Bằng chứng:</span>
                <div className="text-slate-700 bg-white p-2 rounded border border-slate-200 text-xs leading-relaxed">
                  {proposal.reason}
                </div>
              </div>
            </div>

            {/* Safety Safeguards Alert */}
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700 space-y-1">
              <div className="font-semibold text-amber-700 flex items-center gap-1.5">
                <span><AppIcon name="lock" /></span> Hàng rào an toàn 3 lớp (Safety Fence)
              </div>
              <ul className="text-xs text-amber-700 list-disc list-inside space-y-0.5">
                <li>Giới hạn ngân sách tối đa +20% mỗi lần tăng.</li>
                <li>Kiểm tra độ trôi trạng thái (State drift check) trước khi ghi.</li>
                <li>Tự động ghi sổ nhật ký kiểm toán (Audit Trail) có chữ ký số.</li>
              </ul>
            </div>

            {/* Confirmation checkbox */}
            <label className="flex items-center gap-2.5 text-xs text-slate-900 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded border-slate-300 bg-white text-blue-700 focus:ring-blue-300 h-4 w-4"
              />
              <span>
                Tôi đã kiểm tra số liệu và đồng ý thực hiện hành động này trên tài khoản quảng cáo.
              </span>
            </label>

            {/* Actions */}
            <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
              <button
                type="button"
                onClick={onClose}
                disabled={executing}
                className="px-4 py-2 rounded-lg border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition cursor-pointer"
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                onClick={() => onExecute("Xác nhận bởi Media Buyer")}
                disabled={!confirmed || executing}
                className={`px-4 py-2 rounded-lg text-xs font-bold transition flex items-center gap-2 cursor-pointer ${
                  !confirmed || executing
                    ? "bg-slate-50 text-slate-500 cursor-not-allowed opacity-60"
                    : isPause
                    ? "bg-blue-600 text-white shadow-sm "
                    : "bg-blue-600 text-white shadow-sm "
                }`}
              >
                {executing && <span className="inline-block animate-spin"><AppIcon name="refresh" /></span>}
                <span>{executing ? "Đang ghi an toàn..." : isPause ? "Xác nhận Tắt" : "Xác nhận Điều chỉnh"}</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
