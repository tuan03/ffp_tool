import { useEffect, useState } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import type { SeoProductUiViewModel } from "../types";

export interface ShopifySyncErrorModalProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onRetry?: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly onOpenVersionConflict?: (product: SeoProductUiViewModel) => void;
}

export function ShopifySyncErrorModal({
  product,
  isOpen,
  onClose,
  onRetry,
  onDelete,
  onOpenVersionConflict,
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

  const isVersionConflict =
    errorMessage.includes("SHOPIFY_VERSION_CONFLICT") ||
    errorMessage.toLowerCase().includes("version conflict") ||
    errorMessage.toLowerCase().includes("xung đột phiên bản");

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
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-50 dark:bg-slate-800 backdrop-blur-sm animate-fadeIn">
      {/* Modal Dialog Card */}
      <div
        className="w-full max-w-2xl rounded-lg border border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden flex flex-col max-h-[90vh] animate-scaleUp"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 bg-blue-50 dark:bg-blue-950/60 border-b border-rose-200 dark:border-rose-800 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300 font-bold text-base border border-rose-300 dark:border-rose-800">
              <AppIcon name="warning" />
            </span>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Chi tiết lỗi đồng bộ Shopify Store
              </h3>
              <p className="text-xs text-rose-700 dark:text-rose-300">
                Sản phẩm không thể đẩy lên Store chính thành công
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
            title="Đóng"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4 overflow-y-auto flex-1 text-xs text-slate-700 dark:text-slate-300">
          {/* Product info summary */}
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-1.5">
            <div className="text-xs text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider">
              Sản phẩm bị lỗi
            </div>
            <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm leading-snug">
              {product.productTitle.value}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600 dark:text-slate-400 font-mono pt-1">
              <span>Handle: /{product.handle.value}</span>
              {product.asin && <span>• ASIN: {product.asin}</span>}
              {product.productId && <span>• Product ID: {product.productId}</span>}
              {formattedTime && <span>• Thời gian: {formattedTime}</span>}
            </div>
          </div>

          {/* Raw Error Message */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-wider text-rose-700 dark:text-rose-300">
                Nội dung lỗi chi tiết (Error Payload)
              </span>
              <button
                type="button"
                onClick={handleCopy}
                className="px-2 py-1 rounded bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition text-xs flex items-center gap-1 cursor-pointer"
              >
                <span>{copied ? "✓" : "📋"}</span>
                <span>{copied ? "Đã sao chép" : "Copy nội dung lỗi"}</span>
              </button>
            </div>
            <div className="rounded-lg border border-rose-200 dark:border-rose-800 bg-white dark:bg-slate-900 p-3.5 font-mono text-xs text-rose-700 dark:text-rose-300 whitespace-pre-wrap leading-relaxed break-words select-all max-h-64 overflow-y-auto">
              {errorMessage}
            </div>
          </div>

          {/* Troubleshooting hints */}
          <div className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3.5 space-y-1.5 text-amber-700 dark:text-amber-300">
            <div className="font-semibold text-amber-700 dark:text-amber-300 flex items-center gap-1.5">
              <span><AppIcon name="info" /></span>
              <span>Gợi ý khắc phục:</span>
            </div>
            <ul className="list-disc pl-4 space-y-1 text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
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
        <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-semibold transition cursor-pointer"
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
                className="px-3.5 py-2 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 hover:bg-rose-50 dark:hover:bg-rose-950/80 text-rose-700 dark:text-rose-300 text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer shadow-sm "
                title="Xóa sản phẩm này khỏi danh sách SEO Review"
              >
                <span><AppIcon name="trash" /></span>
                <span>Xóa khỏi Review</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isVersionConflict && onOpenVersionConflict && (
              <button
                type="button"
                onClick={() => {
                  onOpenVersionConflict(product);
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                <span><AppIcon name="warning" /></span>
                <span>Xem Diff & Xử lý xung đột</span>
              </button>
            )}

            {onRetry && (
              <button
                type="button"
                onClick={() => {
                  onRetry(product.id);
                  onClose();
                }}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold shadow-sm transition flex items-center gap-1.5 cursor-pointer"
              >
                <span><AppIcon name="refresh" /></span>
                <span>Thử lại đẩy Store ngay</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
