import { useState } from "react";
import type { SeoProvider } from "../../../modules/custom-gpt-seo";

export interface RequeueModalProps {
  readonly isOpen: boolean;
  readonly count: number;
  readonly defaultProvider?: SeoProvider;
  readonly onClose: () => void;
  readonly onConfirm: (options: { provider: SeoProvider; instructions?: string }) => Promise<void>;
  readonly isBusy?: boolean;
}

export function RequeueModal({
  isOpen,
  count,
  defaultProvider = "custom_gpt",
  onClose,
  onConfirm,
  isBusy = false,
}: RequeueModalProps): React.JSX.Element | null {
  const [provider, setProvider] = useState<SeoProvider>(defaultProvider);
  const [instructions, setInstructions] = useState("");

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (isBusy) return;
    await onConfirm({
      provider,
      instructions: instructions.trim() ? instructions.trim() : undefined,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in duration-150"
      role="dialog"
      aria-modal="true"
      aria-labelledby="requeue-modal-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl space-y-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-cyan-950 text-cyan-400 border border-cyan-800 text-lg">
              🔄
            </span>
            <div>
              <h2 id="requeue-modal-title" className="text-base font-bold text-white">
                Đưa vào Queue SEO lại
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Đưa <strong className="text-cyan-400 font-semibold">{count}</strong> sản phẩm đã chọn trở lại hàng đợi để AI xử lý lại.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isBusy}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
            aria-label="Đóng"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">
              Chọn AI xử lý:
            </label>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => setProvider("custom_gpt")}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  provider === "custom_gpt"
                    ? "border-cyan-500 bg-cyan-950/60 text-cyan-200 ring-1 ring-cyan-500/30 font-semibold"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <span>🤖</span>
                <span className="mt-1">GPT Custom</span>
                <span className="text-[10px] text-slate-500">Xử lý batch</span>
              </button>

              <button
                type="button"
                onClick={() => setProvider("gemini")}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  provider === "gemini"
                    ? "border-cyan-500 bg-cyan-950/60 text-cyan-200 ring-1 ring-cyan-500/30 font-semibold"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <span>⚡</span>
                <span className="mt-1">Gemini API</span>
                <span className="text-[10px] text-slate-500">Tự động ngay</span>
              </button>

              <button
                type="button"
                onClick={() => setProvider("codex_mcp")}
                className={`flex flex-col items-center justify-center p-2.5 rounded-xl border text-xs font-medium transition cursor-pointer ${
                  provider === "codex_mcp"
                    ? "border-cyan-500 bg-cyan-950/60 text-cyan-200 ring-1 ring-cyan-500/30 font-semibold"
                    : "border-slate-800 bg-slate-950/60 text-slate-400 hover:border-slate-700 hover:text-slate-200"
                }`}
              >
                <span>💻</span>
                <span className="mt-1">Codex MCP</span>
                <span className="text-[10px] text-slate-500">Máy trạm MCP</span>
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="requeue-instructions" className="text-xs font-semibold text-slate-300">
              Quy tắc / Prompt bổ sung cho đợt này (Tùy chọn):
            </label>
            <textarea
              id="requeue-instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Ví dụ: Viết tiêu đề ngắn gọn < 70 ký tự, bỏ từ vintage, tập trung vào quà tặng sinh nhật..."
              rows={3}
              className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-100 placeholder-slate-600 focus:border-cyan-500 focus:outline-hidden focus:ring-1 focus:ring-cyan-500 transition resize-none"
            />
            <p className="text-[11px] text-slate-500">
              Quy tắc này sẽ được cập nhật vào cấu hình xử lý của các sản phẩm được chọn khi nạp lại vào hàng đợi.
            </p>
          </div>

          <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-800/80">
            <button
              type="button"
              onClick={onClose}
              disabled={isBusy}
              className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:bg-slate-800 transition cursor-pointer disabled:opacity-50"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isBusy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 transition cursor-pointer shadow-md shadow-cyan-950/50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isBusy ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Đang nạp vào Queue...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Xác nhận đưa vào Queue ({count})</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
