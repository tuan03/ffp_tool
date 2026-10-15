import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import type { AutoSeoOutput } from "../../types";

export interface AutoSeoOutputPanelProps {
  output: AutoSeoOutput | null;
  onClearOutput(): void;
  onSendToSeoContent?(): void;
  isSendingToSeo?: boolean;
}

export function AutoSeoOutputPanel({
  output,
  onClearOutput,
  onSendToSeoContent,
  isSendingToSeo = false,
}: AutoSeoOutputPanelProps): React.JSX.Element | null {
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
    <div className="rounded-lg border border-blue-200 bg-slate-50 p-6 shadow-sm backdrop-blur-sm space-y-6">
      {/* Header with Title and Metrics */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-50 text-blue-700 border border-blue-200 text-xs font-bold">
              ✓
            </span>
            <h2 className="text-base font-bold text-slate-900">
              Prepared SEO Content Inputs
            </h2>
          </div>
          <p className="text-xs text-slate-600 mt-1">
            Payload đầu vào chuẩn hóa đã sẵn sàng để chuyển tiếp tới module SEO Content Generator.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onClearOutput}
            className="rounded-lg bg-slate-50 px-2.5 py-1.5 text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-300 transition"
          >
            Đóng kết quả ✕
          </button>
        </div>
      </div>

      {/* Meta Stats Badges */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Workflow ID:</span>
          <span className="font-mono text-blue-700 font-semibold">{output.workflowId}</span>
        </div>

        <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Số lượng sản phẩm:</span>
          <span className="text-emerald-700 font-bold">{output.selectedCount}</span>
        </div>

        <div className="rounded-lg bg-white border border-slate-200 px-3 py-1.5">
          <span className="text-slate-500 mr-1.5">Cảnh báo (Warnings):</span>
          <span className={output.warnings.length > 0 ? "text-amber-700 font-bold" : "text-slate-600"}>
            {output.warnings.length}
          </span>
        </div>
      </div>

      {/* Warnings Box if any */}
      {output.warnings.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-xs font-bold text-amber-700">
            <span><AppIcon name="warning" /></span> Auto SEO Warnings ({output.warnings.length})
          </div>
          <ul className="list-disc list-inside space-y-1 text-xs text-amber-700 pl-1">
            {output.warnings.map((warning) => (
              <li key={warning} className="font-mono text-xs">
                {warning}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* SEO Content Inputs Table */}
      <div className="space-y-3">
        <div className="flex items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-slate-600">
            Danh sách đầu vào SEO ({output.seoContentInputs.length})
          </span>
          <span className="text-slate-500">Mỗi mục chứa toàn bộ ngữ cảnh và ảnh đã gắn thứ tự 1-indexed</span>
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs text-slate-700">
              <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wider text-slate-600">
                <tr>
                  <th className="py-2.5 px-3 text-center w-12">STT</th>
                  <th className="py-2.5 px-3">Product ID</th>
                  <th className="py-2.5 px-3">Handle</th>
                  <th className="py-2.5 px-3">SEO Title</th>
                  <th className="py-2.5 px-3">Tiêu đề gốc</th>
                  <th className="py-2.5 px-3 text-center">Số ảnh</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 font-mono text-xs">
                {output.seoContentInputs.map((item, idx) => (
                  <tr key={item.productId} className="hover:bg-slate-50">
                    <td className="py-2.5 px-3 text-center text-slate-500 font-sans">{idx + 1}</td>
                    <td className="py-2.5 px-3 text-slate-600 truncate max-w-[140px]" title={item.productId}>
                      {item.productId.replace("gid://shopify/Product/", "prod:")}
                    </td>
                    <td className="py-2.5 px-3 text-blue-700 truncate max-w-[150px]">{item.handle}</td>
                    <td className="py-2.5 px-3 font-sans text-blue-700 truncate max-w-[150px]" title={item.sourceSeoTitle ?? ""}>
                      {item.sourceSeoTitle ?? "—"}
                    </td>
                    <td className="py-2.5 px-3 font-sans text-slate-900 max-w-xs truncate">{item.sourceTitle}</td>
                    <td className="py-2.5 px-3 text-center text-slate-700 font-sans">
                      <span className="inline-block rounded-full bg-slate-50 px-2 py-0.5 text-xs font-semibold">
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
      <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-slate-200">
        <div className="flex flex-wrap items-center gap-2">
          {/* Copy JSON */}
          <button
            type="button"
            onClick={handleCopyJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 border border-slate-300 hover:bg-slate-100 transition"
          >
            {copied ? (
              <>
                <span className="text-emerald-700">✓</span> Đã sao chép!
              </>
            ) : (
              <>
                <span><AppIcon name="queue" /></span> Sao chép JSON
              </>
            )}
          </button>

          {/* Download JSON */}
          <button
            type="button"
            onClick={handleDownloadJson}
            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-900 border border-slate-300 hover:bg-slate-100 transition"
          >
            <span><AppIcon name="download" /></span> Tải về JSON
          </button>
        </div>

        {/* Send to SEO Content */}
        <div className="relative group">
          <button
            type="button"
            disabled={isSendingToSeo || !onSendToSeoContent}
            onClick={onSendToSeoContent}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold border transition ${
              isSendingToSeo
                ? "bg-blue-50 text-blue-700 border-blue-200 cursor-wait animate-pulse"
                : onSendToSeoContent
                  ? "bg-blue-600 text-white border-blue-300 shadow-md cursor-pointer"
                  : "bg-slate-50 text-slate-500 border-slate-200 cursor-not-allowed"
            }`}
          >
            {isSendingToSeo ? (
              <>
                <span className="animate-spin"><AppIcon name="clock" /></span> Đang chạy SEO Pipeline (B1 → B6)...
              </>
            ) : (
              <>
                <span><AppIcon name="upload" /></span> Gửi sang SEO Content
              </>
            )}
          </button>
          {!onSendToSeoContent && (
            <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block z-20 w-64 rounded-lg bg-white p-2 text-xs text-slate-600 border border-slate-200 shadow-sm text-center">
              SEO Content handler is not provided.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
