import { useState } from "react";
import type { PinterestPodDeliverables } from "../../types";

interface SeoHandoffModalProps {
  readonly payload: PinterestPodDeliverables;
  readonly onClose: () => void;
}

export function SeoHandoffModal({ payload, onClose }: SeoHandoffModalProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const jsonText = JSON.stringify(payload, null, 2);

  function handleCopy(): void {
    void navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function handleDownload(): void {
    const blob = new Blob([jsonText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pinterest_pod_to_seo_${payload.workflowId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-xs"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-5">
          <div className="flex items-center gap-2.5">
            <span className="text-xl">✨</span>
            <div>
              <h3 className="text-base font-bold text-slate-100">
                Gói Bàn Giao: Pinterest POD ➔ SEO + CONTENT
              </h3>
              <p className="text-xs text-emerald-400 font-medium">
                ✓ Tuân thủ 100% hợp đồng dữ liệu docs/CONTRACT_PINTEREST_POD_TO_SEO.md
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white"
          >
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-4">
          {/* Overview Cards */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Workflow ID</p>
              <p className="font-mono text-xs font-bold text-cyan-300 truncate" title={payload.workflowId}>
                {payload.workflowId}
              </p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Loại sản phẩm</p>
              <p className="text-xs font-bold text-slate-200 uppercase">{payload.productType}</p>
            </div>
            <div className="rounded-xl border border-slate-800 bg-slate-950 p-3">
              <p className="text-[10px] text-slate-400 uppercase font-semibold">Tổng sản phẩm bàn giao</p>
              <p className="text-xs font-bold text-emerald-400">{payload.totalProduced} thiết kế</p>
            </div>
          </div>

          {/* JSON Preview */}
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between text-xs text-slate-400">
              <span>Đặc tả Payload JSON gửi sang Module SEO:</span>
              <span>{payload.items.length} designs, {payload.items.reduce((acc, it) => acc + it.composedMockups.length, 0)} mockups</span>
            </div>
            <pre className="max-h-80 overflow-y-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs leading-relaxed text-cyan-200">
              {jsonText}
            </pre>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 border-t border-slate-800 p-4">
          <button
            type="button"
            onClick={handleDownload}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 transition hover:bg-slate-700 hover:text-white"
          >
            Tải file JSON ↓
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-bold text-slate-950 shadow transition hover:bg-cyan-400"
          >
            {copied ? "✓ Đã sao chép vào bộ nhớ tạm" : "Sao chép JSON"}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-700 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-600 hover:text-white"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
