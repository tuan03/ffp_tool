import { useState } from "react";

import { crawlerProductToSeoInput } from "../../service";
import type { CrawlerProduct, SeoContentInput } from "../../types";

interface CrawlerHandoffModalProps {
  products: CrawlerProduct[];
  onClose(): void;
  onSuccess?(payload: SeoContentInput[]): void;
}

export function CrawlerHandoffModal({
  products,
  onClose,
  onSuccess,
}: CrawlerHandoffModalProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [isHandedOff, setIsHandedOff] = useState(false);

  const seoPayload: SeoContentInput[] = products.map(crawlerProductToSeoInput);
  const totalImages = seoPayload.reduce((acc, p) => acc + p.images.length, 0);

  const handleCopy = (): void => {
    navigator.clipboard.writeText(JSON.stringify(seoPayload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleConfirmHandoff = (): void => {
    setIsHandedOff(true);
    if (onSuccess) {
      onSuccess(seoPayload);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-2xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 p-5 bg-slate-900/95">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-lg">
              🚀
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-100">Bàn giao sang module SEO + Content</h2>
              <p className="text-xs text-slate-400">
                Chuyển đổi dữ liệu {products.length} sản phẩm theo chuẩn hợp đồng SEO Content Adapter.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary Stat Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-xs text-slate-400 block mb-1">Sản phẩm bàn giao</span>
              <span className="text-2xl font-bold font-mono text-cyan-400">{products.length}</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-xs text-slate-400 block mb-1">Hình ảnh sạch (Media)</span>
              <span className="text-2xl font-bold font-mono text-emerald-400">{totalImages}</span>
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <span className="text-xs text-slate-400 block mb-1">Có cấu hình tùy biến</span>
              <span className="text-2xl font-bold font-mono text-amber-400">
                {products.filter((p) => Boolean(p.customization)).length}
              </span>
            </div>
          </div>

          {/* Handoff Status feedback */}
          {isHandedOff && (
            <div className="rounded-xl border border-emerald-800 bg-emerald-950/50 p-4 text-emerald-200 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">✓</span>
                <span className="font-semibold">
                  Đã bàn giao thành công payload {products.length} sản phẩm sang SEO + Content Pipeline!
                </span>
              </div>
              <span className="rounded bg-emerald-900 px-2 py-0.5 text-[10px] uppercase font-bold text-emerald-300">
                HANDOFF COMPLETED
              </span>
            </div>
          )}

          {/* List of items being passed */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Danh sách sản phẩm được chọn
            </h3>
            <div className="divide-y divide-slate-800/80 rounded-xl border border-slate-800 bg-slate-950/50 max-h-48 overflow-y-auto">
              {products.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-3 pr-2">
                    <span className="font-mono text-[11px] text-cyan-400">
                      {p.productDetails?.ASIN || p.parentAsin || p.id}
                    </span>
                    <span className="font-medium text-slate-200 line-clamp-1">{p.title}</span>
                  </div>
                  <span className="text-slate-400 whitespace-nowrap text-[11px]">
                    {p.variants.length} biến thể
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Transformed Payload JSON Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Xem trước Payload Adapter (SeoContentInput[])
              </h3>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
              >
                {copied ? "✓ Đã sao chép!" : "📋 Sao chép JSON"}
              </button>
            </div>

            <pre className="max-h-60 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] text-emerald-300">
              {JSON.stringify(seoPayload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-900/90 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-slate-700 transition"
          >
            Đóng
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-slate-700 transition"
            >
              Sao chép JSON
            </button>

            <button
              type="button"
              onClick={handleConfirmHandoff}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2 text-xs font-bold text-slate-950 shadow-md shadow-emerald-500/20 hover:from-emerald-400 hover:to-teal-500 transition"
            >
              <span>🚀</span> Xác nhận chuyển sang SEO + Content
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
