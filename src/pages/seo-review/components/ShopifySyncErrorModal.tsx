import { useEffect, useState } from "react";

import type { SeoProductUiViewModel } from "../types";

export interface ShopifySyncErrorModalProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRetry?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
}

export function ShopifySyncErrorModal({
  product,
  isOpen,
  onClose,
  onRetry,
  onDelete,
}: ShopifySyncErrorModalProps): React.JSX.Element | null {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !product) {
    return null;
  }

  const errorMessage =
    product.shopifySyncError?.trim() ||
    "Không thể đồng bộ sản phẩm lên Shopify. Vui lòng kiểm tra lại kết nối Store.";

  function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(errorMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const formattedTime = product.shopifySyncedAt
    ? new Date(product.shopifySyncedAt).toLocaleString("vi-VN")
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fadeIn">
      {/* Modal Dialog Card */}
      <div
        className="w-full max-w-2xl rounded-2xl border border-rose-500/40 bg-slate-900 shadow-2xl overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-gradient-to-r from-rose-950/80 to-slate-950/90 border-b border-rose-900/60 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-500/20 text-rose-300 font-bold text-base border border-rose-500/30">
              ⚠️
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-100">
                Chi tiết lỗi đồng bộ Shopify Store
              </h3>
              <p className="text-[11px] text-rose-300/80">
                Sản phẩm không thể đẩy lên Store chính thành công
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 transition"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs text-slate-300">
          {/* Product info summary */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-1.5">
            <div className="text-[10px] text-slate-500 font-semibold uppercase tracking-wider">
              Sản phẩm bị lỗi
            </div>
            <div className="font-semibold text-slate-100 text-sm leading-snug">
              {product.productTitle.value}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-400 font-mono pt-1">
              <span>Handle: /{product.handle.value}</span>
              {product.asin && <span>• ASIN: {product.asin}</span>}
              {product.productId && <span>• Product ID: {product.productId}</span>}
              {formattedTime && <span>• Thời gian: {formattedTime}</span>}
            </div>
          </div>

          {/* Raw Error Message */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400">
                Nội dung lỗi chi tiết (Error Payload)
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 transition text-[11px] flex items-center gap-1 cursor-pointer"
              >
                <span>{copied ? "✓" : "📋"}</span>
                <span>{copied ? "Đã sao chép" : "Copy nội dung lỗi"}</span>
              </button>
            </div>
            <div className="rounded-xl border border-rose-900/60 bg-slate-950 p-3.5 font-mono text-[11px] text-rose-300 whitespace-pre-wrap leading-relaxed break-words select-all max-h-64 overflow-y-auto">
              {errorMessage}
            </div>
          </div>

          {/* Troubleshooting hints */}
          <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3.5 space-y-1.5 text-amber-200/90">
            <div className="font-semibold text-amber-300 flex items-center gap-1.5">
              <span>💡</span>
              <span>Gợi ý khắc phục:</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-amber-200/80 leading-relaxed">
              <li>
                Kiểm tra kết nối và quyền hạn của app/store trong tab Cài đặt Store (`write_products`, `write_files`, `write_metafields`).
              </li>
              <li>
                Nếu thông báo là lỗi mạng hoặc gateway timeout, hãy thử lại sau ít giây.
              </li>
              <li>
                Nếu sản phẩm có định dạng hoặc trường dữ liệu không hợp lệ, có thể bấm nút <strong>Chỉnh sửa</strong> để sửa lại nội dung trước khi duyệt lại.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition cursor-pointer"
            >
              Đóng
            </button>
            {onDelete && (
              <button
                type="button"
                onClick={() => {
                  onDelete(product.id);
                  onClose();
                }}
                className="px-3.5 py-2 rounded-xl border border-rose-800/60 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm shadow-rose-950/40"
                title="Xóa sản phẩm này khỏi danh sách SEO Review"
              >
                <span>🗑️</span>
                <span>Xóa khỏi Review</span>
              </button>
            )}
          </div>

          {onRetry && (
            <button
              type="button"
              onClick={() => {
                onRetry(product.id);
                onClose();
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-600 to-rose-700 hover:from-rose-500 hover:to-rose-600 text-white text-xs font-bold shadow-lg shadow-rose-900/30 transition flex items-center gap-1.5 cursor-pointer"
            >
              <span>🔄</span>
              <span>Thử lại đẩy Store ngay</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
