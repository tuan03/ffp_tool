import { useState } from "react";

export interface ShopifySyncErrorBannerProps {
  readonly error?: string;
  readonly syncedAt?: number;
  readonly isRetrying?: boolean;
  readonly onRetry?: () => void;
  readonly className?: string;
  readonly title?: string;
  readonly showDetailsByDefault?: boolean;
}

export function ShopifySyncErrorBanner({
  error,
  syncedAt,
  isRetrying = false,
  onRetry,
  className = "",
  title = "Lỗi đẩy dữ liệu qua Shopify Store",
  showDetailsByDefault = false,
}: ShopifySyncErrorBannerProps): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(showDetailsByDefault);

  const errorMessage = error?.trim() || "Không thể đồng bộ sản phẩm lên Shopify. Vui lòng kiểm tra lại kết nối Store.";
  const isMultiLine = errorMessage.includes("\n") || errorMessage.length > 120;

  function handleCopy() {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(errorMessage);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  const formattedTime = syncedAt
    ? new Date(syncedAt).toLocaleTimeString("vi-VN", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      })
    : null;

  return (
    <div
      className={`rounded-xl border border-rose-500/40 bg-gradient-to-r from-rose-950/60 to-rose-900/40 p-3.5 text-xs text-rose-200 shadow-sm transition-all ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0 flex-1">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-rose-500/20 text-rose-400 font-bold text-sm">
            ⚠️
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-rose-200">{title}</span>
              {formattedTime && (
                <span className="text-[10px] text-rose-400/80 font-mono">
                  (lúc {formattedTime})
                </span>
              )}
            </div>

            {/* Error Message Box */}
            <div className="mt-1.5 rounded-lg bg-slate-950/80 border border-rose-900/60 p-2 font-mono text-[11px] text-rose-300 leading-relaxed break-words select-all">
              {isMultiLine && !isExpanded ? (
                <>
                  <div className="line-clamp-2">{errorMessage}</div>
                  <button
                    type="button"
                    onClick={() => setIsExpanded(true)}
                    className="mt-1 text-[10px] font-semibold text-cyan-400 hover:text-cyan-300 underline cursor-pointer"
                  >
                    Xem chi tiết lỗi đầy đủ ▾
                  </button>
                </>
              ) : (
                <>
                  <div className="whitespace-pre-wrap">{errorMessage}</div>
                  {isMultiLine && (
                    <button
                      type="button"
                      onClick={() => setIsExpanded(false)}
                      className="mt-1 text-[10px] font-semibold text-slate-400 hover:text-slate-300 underline cursor-pointer"
                    >
                      Thu gọn ▴
                    </button>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 shrink-0 sm:self-start">
          <button
            type="button"
            onClick={handleCopy}
            className="rounded-lg bg-slate-900/80 hover:bg-slate-800 border border-slate-700/80 px-2 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition flex items-center gap-1"
            title="Sao chép toàn bộ thông báo lỗi"
          >
            <span>{copied ? "✓" : "📋"}</span>
            <span>{copied ? "Đã chép" : "Copy lỗi"}</span>
          </button>

          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={isRetrying}
              className="rounded-lg bg-rose-700 hover:bg-rose-600 disabled:opacity-50 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm shadow-rose-900/40 transition flex items-center gap-1 cursor-pointer"
              title="Thử đồng bộ lại sản phẩm này lên Shopify"
            >
              {isRetrying ? (
                <>
                  <svg className="animate-spin h-3 w-3 text-white" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  <span>Đang đẩy...</span>
                </>
              ) : (
                <>
                  <span>🔄</span>
                  <span>Thử lại</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
