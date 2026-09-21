import { useState } from "react";
import type { AutoSeoOutput } from "../../types";

interface AutoSeoOutputPanelProps {
  output: AutoSeoOutput | null;
  onClearOutput(): void;
}

export function AutoSeoOutputPanel({ output, onClearOutput }: AutoSeoOutputPanelProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  if (!output) {
    return null;
  }

  const handleCopyJson = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(output, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  const handleDownloadJson = (): void => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(output, null, 2));
    const downloadAnchor = document.createElement("a");
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${output.workflowId}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  return (
    <div className="rounded-xl border border-cyan-800/80 bg-slate-900/80 p-6 shadow-2xl backdrop-blur-sm space-y-6">
      {/* Header with Title and Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan-950 text-cyan-400 border border-cyan-700 text-xs font-bold">
              ✓
            </span>
            <h2 className="text-base font-bold text-slate-100">
              Prepared SEO Content Inputs
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Payload đầu vào chuẩn hóa đã sẵn sàng để chuyển tiếp tới module SEO Content Generator.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClearOutput}
            className="rounded-lg bg-slate-800/80 px-2.5 py-1.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800 border border-slate-700 transition"
          >
            Đóng kết quả ✕
          </button>
        </div>
      </div>

      {/* Meta Stats Badges */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Workflow ID:</span>
          <span className="font-mono text-cyan-400 font-semibold">{output.workflowId}</span>
        </div>

        <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Số lượng sản phẩm:</span>
          <span className="text-emerald-400 font-bold">{output.selectedCount}</span>
        </div>

        <div className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Cảnh báo (Warnings):</span>
          <span className={output.warnings.length > 0 ? "text-amber-400 font-bold" : "text-slate-400"}>
            {output.warnings.length}
          </span>
        </div>
      </div>

      {/* Warnings Box if any */}
      {output.warnings.length > 0 && (
        <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-300">
            <span>⚠️</span> Auto SEO Warnings ({output.warnings.length})
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs text-amber-200/90 pl-1">
            {output.warnings.map((warning) => (
              <li key={warning} className="font-mono text-[11px]">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SEO Content Inputs Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-slate-400">
            Danh sách đầu vào SEO ({output.seoContentInputs.length})
          </span>
          <span className="text-slate-500">Mỗi mục chứa toàn bộ ngữ cảnh và ảnh đã gắn thứ tự 1-indexed</span>
        </div>

        <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/70">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-300">
              <thead className="border-b border-slate-800 bg-slate-900/90 text-[11px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="py-2.5 px-3 text-center w-12">STT</th>
                  <th className="py-2.5 px-3">Product ID</th>
                  <th className="py-2.5 px-3">Handle</th>
                  <th className="py-2.5 px-3">Niche</th>
                  <th className="py-2.5 px-3">Tiêu đề gốc</th>
                  <th className="py-2.5 px-3 text-center">Số ảnh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                {output.seoContentInputs.map((item, idx) => (
                  <tr key={item.productId} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-3 text-center text-slate-500 font-sans">{idx + 1}</td>
                    <td className="py-2.5 px-3 text-slate-400 truncate max-w-[140px]" title={item.productId}>
                      {item.productId.replace("gid://shopify/Product/", "prod:")}
                    </td>
                    <td className="py-2.5 px-3 text-cyan-400 truncate max-w-[150px]">{item.handle}</td>
                    <td className="py-2.5 px-3 font-sans text-amber-300">{item.niche}</td>
                    <td className="py-2.5 px-3 font-sans text-slate-200 max-w-xs truncate">{item.sourceTitle}</td>
                    <td className="py-2.5 px-3 text-center text-slate-300 font-sans">
                      <span className="inline-block rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-semibold">
                        {item.images.length} ảnh
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Action Buttons: Copy JSON, Download JSON, Send to SEO Content */}
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-800">
        <div className="flex flex-wrap items-center gap-2">
          {/* Copy JSON */}
          <button
            type="button"
            onClick={handleCopyJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 border border-slate-700 hover:bg-slate-700 transition"
          >
            {copied ? (
              <>
                <span className="text-emerald-400">✓</span> Đã sao chép!
              </>
            ) : (
              <>
                <span>📋</span> Sao chép JSON
              </>
            )}
          </button>

          {/* Download JSON */}
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-3.5 py-2 text-xs font-semibold text-slate-200 border border-slate-700 hover:bg-slate-700 transition"
          >
            <span>💾</span> Tải về JSON
          </button>
        </div>

        {/* Send to SEO Content (Disabled) */}
        <div className="relative group">
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-2 rounded-lg bg-slate-800/50 px-4 py-2 text-xs font-semibold text-slate-500 border border-slate-800 cursor-not-allowed"
          >
            <span>📤</span> Gửi sang SEO Content
          </button>
          <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block z-20 w-64 rounded-lg bg-slate-950 p-2 text-[11px] text-slate-400 border border-slate-800 shadow-xl text-center">
            SEO Content module is not connected yet.
          </div>
        </div>
      </div>
    </div>
  );
}
