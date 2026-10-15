import { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
import { crawlerProductToSeoSource } from "../../service";
import type { CrawlerProduct, CrawlerSeoHandoffSource } from "../../types";

interface CrawlerHandoffModalProps {
  products: CrawlerProduct[];
  onClose(): void;
  onSuccess?(payload: CrawlerSeoHandoffSource[]): void;
}

export function CrawlerHandoffModal({
  products,
  onClose,
  onSuccess,
}: CrawlerHandoffModalProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [isHandedOff, setIsHandedOff] = useState(false);

  const seoPayload: CrawlerSeoHandoffSource[] = products.map(crawlerProductToSeoSource);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-800 backdrop-blur-sm animate-fadeIn">
      <div className="flex h-[85vh] w-full max-w-4xl flex-col rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 p-5 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 text-lg">
              <AppIcon name="play" />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Bàn giao sang module SEO + Content</h2>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Chuyển đổi dữ liệu {products.length} sản phẩm theo chuẩn hợp đồng SEO Content Adapter.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Summary Stat Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
              <span className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Sản phẩm bàn giao</span>
              <span className="text-2xl font-bold font-mono text-blue-700 dark:text-blue-300">{products.length}</span>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
              <span className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Hình ảnh sạch (Media)</span>
              <span className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-300">{totalImages}</span>
            </div>

            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
              <span className="text-xs text-slate-600 dark:text-slate-400 block mb-1">Có cấu hình tùy biến</span>
              <span className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-300">
                {products.filter((p) => Boolean(p.customization)).length}
              </span>
            </div>
          </div>

          {/* Handoff Status feedback */}
          {isHandedOff && (
            <div className="rounded-lg border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 p-4 text-emerald-700 dark:text-emerald-300 text-xs flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-base">✓</span>
                <span className="font-semibold">
                  Đã bàn giao thành công payload {products.length} sản phẩm sang SEO + Content Pipeline!
                </span>
              </div>
              <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 text-xs uppercase font-bold text-emerald-700 dark:text-emerald-300">
                HANDOFF COMPLETED
              </span>
            </div>
          )}

          {/* List of items being passed */}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
              Danh sách sản phẩm được chọn
            </h3>
            <div className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 max-h-48 overflow-y-auto">
              {products.map((p) => (
                <div key={p.id} className="flex items-center justify-between p-3 text-xs">
                  <div className="flex items-center gap-3 pr-2">
                    <span className="font-mono text-xs text-blue-700 dark:text-blue-300">
                      {p.productDetails?.ASIN || p.parentAsin || p.id}
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100 line-clamp-1">{p.title}</span>
                  </div>
                  <span className="text-slate-600 dark:text-slate-400 whitespace-nowrap text-xs">
                    {p.variants.length} biến thể
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Transformed Payload JSON Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Xem trước nguồn bàn giao vận hành
              </h3>
              <button
                type="button"
                onClick={handleCopy}
                className="rounded-lg bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
              >
                {copied ? "✓ Đã sao chép!" : "📋 Sao chép JSON"}
              </button>
            </div>

            <pre className="max-h-60 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 font-mono text-xs text-emerald-700 dark:text-emerald-300">
              {JSON.stringify(seoPayload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
          >
            Đóng
          </button>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleCopy}
              className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-4 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Sao chép JSON
            </button>

            <button
              type="button"
              onClick={handleConfirmHandoff}
              className="flex items-center gap-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/60 px-5 py-2 text-xs font-bold text-slate-950 dark:text-slate-100 shadow-md transition"
            >
              <span><AppIcon name="play" /></span> Xác nhận chuyển sang SEO + Content
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
