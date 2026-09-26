import { useCallback, useEffect, useState } from "react";

import type { ZoomImageItem } from "../types";

export interface ImageZoomModalProps {
  readonly isOpen: boolean;
  readonly images: readonly ZoomImageItem[];
  readonly initialIndex?: number;
  readonly onClose: () => void;
}

export function ImageZoomModal({
  isOpen,
  images,
  initialIndex = 0,
  onClose,
}: ImageZoomModalProps): React.JSX.Element | null {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);
  const [isZoomed, setIsZoomed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [imageError, setImageError] = useState(false);

  // Sync currentIndex when initialIndex or images changes
  useEffect(() => {
    const safeIndex = Math.max(0, Math.min(initialIndex, Math.max(0, images.length - 1)));
    setCurrentIndex(safeIndex);
    setIsZoomed(false);
    setImageError(false);
  }, [initialIndex, images]);

  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  const handlePrev = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : images.length - 1));
    setIsZoomed(false);
    setImageError(false);
  }, [images.length]);

  const handleNext = useCallback(() => {
    if (images.length <= 1) return;
    setCurrentIndex((prev) => (prev < images.length - 1 ? prev + 1 : 0));
    setIsZoomed(false);
    setImageError(false);
  }, [images.length]);

  const handleToggleZoom = useCallback(() => {
    setIsZoomed((prev) => !prev);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "z" || e.key === "Z") {
        e.preventDefault();
        handleToggleZoom();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose, handlePrev, handleNext, handleToggleZoom]);

  if (!isOpen || images.length === 0) {
    return null;
  }

  const activeImage = images[currentIndex] || images[0];
  if (!activeImage) {
    return null;
  }

  const altText = activeImage.altText || "";
  const altLength = altText.length;

  const handleCopy = (text: string, key: string) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey(null);
    }, 1500);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Phóng to ảnh chi tiết"
      className="fixed inset-0 z-50 flex flex-col bg-slate-950/95 backdrop-blur-md p-2 sm:p-4 md:p-6 animate-fadeIn select-none"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between gap-3 pb-3 border-b border-slate-800 text-slate-200">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/20 text-cyan-400 text-sm font-bold">
            🔍
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-bold text-slate-100 truncate max-w-md md:max-w-xl">
              {activeImage.title || "Chi tiết hình ảnh sản phẩm"}
            </h3>
            {images.length > 1 && (
              <p className="text-[11px] font-mono text-cyan-400">
                Ảnh {currentIndex + 1} / {images.length}
              </p>
            )}
          </div>
        </div>

        {/* Header Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Zoom Toggle */}
          <button
            type="button"
            onClick={handleToggleZoom}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
              isZoomed
                ? "bg-cyan-500/20 border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/30"
                : "bg-slate-900 border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
            }`}
            title="Nhấn 'Z' hoặc click vào ảnh để phóng to / thu nhỏ"
            aria-label={isZoomed ? "Thu nhỏ về kích thước chuẩn" : "Phóng to 2x"}
          >
            <span>{isZoomed ? "🔍 Thu nhỏ (1x)" : "🔎 Phóng to (2x)"}</span>
          </button>

          {/* Open Original in New Tab */}
          <a
            href={activeImage.url}
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition"
            title="Mở ảnh gốc trong tab mới"
          >
            <span>↗</span>
            <span>Mở gốc</span>
          </a>

          {/* Copy URL */}
          <button
            type="button"
            onClick={() => handleCopy(activeImage.url, "url")}
            className="hidden md:inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition"
            aria-label="Sao chép liên kết ảnh"
          >
            <span>{copiedKey === "url" ? "✓ Đã copy" : "📋 Copy link"}</span>
          </button>

          {/* Close Modal */}
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 border border-slate-700 text-slate-400 hover:bg-rose-950/40 hover:border-rose-700 hover:text-rose-300 transition text-sm font-bold"
            aria-label="Đóng cửa sổ xem ảnh (Esc)"
          >
            ✕
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="relative flex-1 min-h-0 flex items-center justify-center my-3 overflow-hidden">
        {/* Navigation Arrow: Previous */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={handlePrev}
            className="absolute left-2 sm:left-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 border border-slate-700/80 text-slate-200 hover:bg-cyan-600 hover:border-cyan-500 hover:text-white shadow-xl transition backdrop-blur-sm text-xl font-bold cursor-pointer"
            aria-label="Xem ảnh trước đó (Phím mũi tên trái)"
          >
            ‹
          </button>
        )}

        {/* Center Image Container */}
        <div
          className={`relative max-h-full max-w-full flex items-center justify-center overflow-auto rounded-xl p-2 transition-all duration-200 ${
            isZoomed ? "cursor-zoom-out" : "cursor-zoom-in"
          }`}
          onClick={handleToggleZoom}
        >
          {imageError ? (
            <div className="flex flex-col items-center justify-center p-8 bg-slate-900 border border-slate-800 rounded-xl text-center">
              <span className="text-4xl mb-2">📷</span>
              <p className="text-sm font-medium text-slate-300">Không thể tải trực tiếp hình ảnh</p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs break-all">{activeImage.url}</p>
              <a
                href={activeImage.url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 px-3 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg"
                onClick={(e) => e.stopPropagation()}
              >
                Mở link ảnh trong tab mới
              </a>
            </div>
          ) : (
            <img
              src={activeImage.url}
              alt={activeImage.altText || "Ảnh sản phẩm"}
              onError={() => setImageError(true)}
              className={`rounded-lg object-contain transition-transform duration-200 select-none shadow-2xl ${
                isZoomed
                  ? "scale-175 max-w-none max-h-none my-12"
                  : "max-h-[60vh] md:max-h-[66vh] max-w-full"
              }`}
            />
          )}
        </div>

        {/* Navigation Arrow: Next */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={handleNext}
            className="absolute right-2 sm:right-4 z-20 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/80 border border-slate-700/80 text-slate-200 hover:bg-cyan-600 hover:border-cyan-500 hover:text-white shadow-xl transition backdrop-blur-sm text-xl font-bold cursor-pointer"
            aria-label="Xem ảnh kế tiếp (Phím mũi tên phải)"
          >
            ›
          </button>
        )}
      </div>

      {/* Bottom SEO Alt Inspection & Thumbnail Strip */}
      <div className="border-t border-slate-800 pt-3 space-y-2.5">
        {/* SEO Alt Text Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-900/90 border border-slate-800/90 rounded-xl px-3.5 py-2">
          <div className="flex items-start sm:items-center gap-2 min-w-0 flex-1">
            <span className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 flex-shrink-0">
              🏷️ SEO Alt:
            </span>
            {altText ? (
              <span className="text-xs text-slate-200 truncate select-text" title={altText}>
                {altText}
              </span>
            ) : (
              <span className="text-xs text-rose-400 italic">
                Chưa có Alt text cho ảnh này
              </span>
            )}
          </div>

          <div className="flex items-center gap-2 flex-shrink-0 self-end sm:self-center">
            <span
              className={`text-[11px] font-mono px-2 py-0.5 rounded ${
                altLength > 125
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  : altLength > 0
                  ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40"
                  : "bg-rose-500/20 text-rose-300 border border-rose-500/40"
              }`}
            >
              {altLength}/125 ký tự
            </span>

            {altText && (
              <button
                type="button"
                onClick={() => handleCopy(altText, "alt")}
                className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-300 hover:text-cyan-400 bg-slate-800 px-2 py-0.5 rounded border border-slate-700 transition"
              >
                {copiedKey === "alt" ? "✓ Đã copy Alt" : "📋 Copy Alt"}
              </button>
            )}
          </div>
        </div>

        {/* Thumbnail Carousel Strip (when more than 1 image) */}
        {images.length > 1 && (
          <div className="flex items-center justify-center gap-2 overflow-x-auto py-1 max-w-full">
            {images.map((img, idx) => (
              <button
                key={img.url || idx}
                type="button"
                onClick={() => {
                  setCurrentIndex(idx);
                  setIsZoomed(false);
                  setImageError(false);
                }}
                className={`relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border-2 transition ${
                  idx === currentIndex
                    ? "border-cyan-400 ring-2 ring-cyan-500/40 scale-105"
                    : "border-slate-800 hover:border-slate-600 opacity-60 hover:opacity-100"
                }`}
                aria-label={`Xem ảnh #${idx + 1}`}
              >
                <img
                  src={img.url}
                  alt={img.altText || `Thumbnail ${idx + 1}`}
                  className="h-full w-full object-cover"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
