import { useEffect, useState } from "react";

export interface LightboxImageItem {
  readonly url: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly downloadUrl?: string;
  readonly widthPx?: number;
  readonly heightPx?: number;
  readonly dpi?: number;
  readonly colorMode?: string;
  readonly score?: number;
  readonly printability?: number;
  readonly tags?: readonly string[];
}

interface ImageLightboxModalProps {
  readonly image: LightboxImageItem | null;
  readonly onClose: () => void;
}

export function ImageLightboxModal({ image, onClose }: ImageLightboxModalProps): React.JSX.Element | null {
  const [isZoomed, setIsZoomed] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
      }
    }
    if (image) {
      window.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [image, onClose]);

  if (!image) return null;

  function handleDownload(): void {
    if (!image) return;
    const a = document.createElement("a");
    a.href = image.downloadUrl || image.url;
    a.download = image.title.toLowerCase().replace(/[^a-z0-9_-]/g, "_") + ".png";
    a.target = "_blank";
    a.click();
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[95vh] max-w-5xl w-full flex-col overflow-hidden rounded-2xl border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950 px-5 py-3.5">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-xl">🔍</span>
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-slate-100" title={image.title}>
                {image.title}
              </h3>
              {image.subtitle && (
                <p className="truncate text-xs text-slate-400">{image.subtitle}</p>
              )}
            </div>
            {image.badge && (
              <span className="rounded-full bg-cyan-950 border border-cyan-700 px-2.5 py-0.5 text-[10px] font-bold text-cyan-300 whitespace-nowrap">
                {image.badge}
              </span>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsZoomed((prev) => !prev)}
              title={isZoomed ? "Thu nhỏ vừa màn hình" : "Phóng to 100% chi tiết gốc"}
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:border-slate-500 hover:text-white"
            >
              {isZoomed ? "⊡ Vừa màn hình" : "🔍 100% Gốc"}
            </button>
            <button
              type="button"
              onClick={handleDownload}
              title="Tải file về máy"
              className="rounded-lg bg-cyan-600 px-3 py-1 text-xs font-semibold text-white hover:bg-cyan-500 shadow"
            >
              💾 Tải file
            </button>
            <a
              href={image.url}
              target="_blank"
              rel="noopener noreferrer"
              title="Mở ảnh trong tab mới"
              className="rounded-lg border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs text-slate-300 hover:text-white"
            >
              ↗
            </a>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-800 text-slate-400 hover:bg-rose-900 hover:text-white transition"
              title="Đóng (ESC)"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Image Preview Canvas */}
        <div className="relative flex flex-1 items-center justify-center overflow-auto bg-slate-950/60 p-4 min-h-[350px] max-h-[70vh]">
          <img
            src={image.url}
            alt={image.title}
            className={`transition-all duration-200 rounded-lg shadow-lg ${
              isZoomed ? "max-w-none cursor-zoom-out" : "max-h-[65vh] max-w-full object-contain cursor-zoom-in"
            }`}
            onClick={() => setIsZoomed((prev) => !prev)}
          />
        </div>

        {/* Technical Specs Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-800 bg-slate-950 px-5 py-3 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-400">
            {image.widthPx && image.heightPx && (
              <span>
                📐 <strong className="text-slate-200">{image.widthPx} × {image.heightPx} px</strong>
              </span>
            )}
            {image.dpi && (
              <span>
                🖨️ <strong className="text-slate-200">{image.dpi} DPI</strong>
              </span>
            )}
            {image.colorMode && (
              <span>
                🎨 <strong className="text-emerald-300">{image.colorMode}</strong>
              </span>
            )}
            {image.printability !== undefined && (
              <span>
                ⭐ Chuẩn in: <strong className="text-cyan-300">{image.printability}/100</strong>
              </span>
            )}
            {image.score !== undefined && (
              <span>
                👁️ AI Vision: <strong className="text-amber-300">{image.score}/100</strong>
              </span>
            )}
          </div>

          {image.tags && image.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {image.tags.slice(0, 5).map((tag) => (
                <span
                  key={tag}
                  className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-300"
                >
                  #{tag}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
