import { useEffect, useState } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { buildProductZoomImages } from "../zoom-image-helper";
import { SourceBadge } from "./SourceBadge";
import type { SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductDetailDrawerProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onEdit: (product: SeoProductUiViewModel) => void;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

export function ProductDetailDrawer({
  product,
  isOpen,
  onClose,
  onEdit,
  onApprove,
  onReject,
  onZoomImage,
}: ProductDetailDrawerProps): React.JSX.Element | null {
  const [descriptionTab, setDescriptionTab] = useState<"formatted" | "raw">("formatted");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Close drawer on Escape key
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

  function handleCopy(text: string, key: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1800);
    }
  }

  const seoTitleLen = product.seoTitle.value.length;
  const seoDescLen = product.seoDescription.value.length;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-slate-900 border-l border-slate-800 shadow-2xl flex flex-col">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/90 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold">
                SEO
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-100 line-clamp-1">
                  Review Chi Tiết SEO
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                  <span>ID: {product.id}</span>
                  {product.asin && <span>• ASIN: {product.asin}</span>}
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
              aria-label="Đóng drawer"
            >
              ✕
            </button>
          </div>

          {/* Drawer Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-300">
            {/* Review Status Banner */}
            <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold uppercase text-slate-400">Trạng thái:</span>
                {product.reviewDecision === "approved" ? (
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-950 text-emerald-300 border border-emerald-700">
                    ✓ ĐÃ PHÊ DUYỆT (Approved)
                  </span>
                ) : product.reviewDecision === "rejected" ? (
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-rose-950 text-rose-300 border border-rose-700">
                    ✕ TỪ CHỐI (Rejected)
                  </span>
                ) : (
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-slate-800 text-slate-300 border border-slate-700">
                    ⏳ CHỜ REVIEW (Pending)
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Pipeline:</span>
                <span className="capitalize font-mono text-xs font-semibold text-cyan-400">
                  {product.seoStatus.value}
                </span>
                <SourceBadge source={product.seoStatus.source} />
              </div>
            </div>

            {/* Rejection notice if present */}
            {product.rejectionReason && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-3.5 text-xs text-rose-300">
                <span className="font-bold">Lý do từ chối / lỗi:</span> {product.rejectionReason}
              </div>
            )}

            {/* 1. Product Title & Handle */}
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/40 p-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Product Title (Tiêu đề sản phẩm)
                  </label>
                  <SourceBadge source={product.productTitle.source} />
                </div>
                <div className="font-medium text-slate-100 text-base leading-snug">
                  {product.productTitle.value}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Product Handle (URL Slug)
                  </label>
                  <SourceBadge source={product.handle.source} />
                </div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs text-cyan-300 bg-slate-900 px-2.5 py-1.5 rounded border border-slate-800 flex-1 overflow-x-auto">
                    /products/{product.handle.value}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(product.handle.value, "handle")}
                    className="px-2.5 py-1.5 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedKey === "handle" ? "✓ Đã chép" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. SEO Title & SEO Meta Description */}
            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/40 p-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      SEO Title (Meta Title)
                    </label>
                    <SourceBadge source={product.seoTitle.source} />
                  </div>
                  <span
                    className={`text-xs font-mono font-medium ${
                      seoTitleLen > 70 ? "text-rose-400" : seoTitleLen >= 55 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {seoTitleLen} / 70 ký tự
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 font-medium text-slate-200">
                  {product.seoTitle.value}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-800/80">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                      SEO Description (Meta Description)
                    </label>
                    <SourceBadge source={product.seoDescription.source} />
                  </div>
                  <span
                    className={`text-xs font-mono font-medium ${
                      seoDescLen > 160 ? "text-rose-400" : seoDescLen >= 120 ? "text-emerald-400" : "text-amber-400"
                    }`}
                  >
                    {seoDescLen} / 160 ký tự
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 text-xs leading-relaxed">
                  {product.seoDescription.value}
                </div>
              </div>
            </div>

            {/* 3. Product Description (HTML Preview / Raw Code) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Product Description (Mô tả chi tiết)
                  </label>
                  <SourceBadge source={product.productDescription.source} />
                </div>

                <div className="flex items-center rounded-lg bg-slate-900 p-0.5 border border-slate-800 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setDescriptionTab("formatted")}
                    className={`px-3 py-1 rounded transition ${
                      descriptionTab === "formatted"
                        ? "bg-cyan-600 text-white font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptionTab("raw")}
                    className={`px-3 py-1 rounded transition ${
                      descriptionTab === "raw"
                        ? "bg-cyan-600 text-white font-semibold"
                        : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    HTML
                  </button>
                </div>
              </div>

              {descriptionTab === "formatted" ? (
                <div
                  className="prose prose-invert prose-xs max-w-none p-4 rounded-lg bg-slate-900 border border-slate-800 max-h-72 overflow-y-auto leading-relaxed text-slate-300"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtmlDescription(product.productDescription.value),
                  }}
                />
              ) : (
                <div className="relative">
                  <pre className="p-4 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-72">
                    {product.productDescription.value}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(product.productDescription.value, "desc")}
                    className="absolute top-2 right-2 px-2.5 py-1 rounded text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                  >
                    {copiedKey === "desc" ? "✓ Đã chép" : "Copy"}
                  </button>
                </div>
              )}
            </div>

            {/* 4. Images Gallery (Preview, ALT text, WebP URL) */}
            <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Hình ảnh & Alt Text ({product.images.length})
                </label>
              </div>

              {product.images.length === 0 ? (
                <div className="p-4 rounded-lg bg-slate-900 border border-slate-800 text-slate-500 italic text-xs">
                  Sản phẩm này chưa có dữ liệu hình ảnh.
                </div>
              ) : (
                <div className="space-y-4">
                  {product.images.map((img, idx) => (
                    <div
                      key={img.id}
                      className="rounded-lg border border-slate-800/80 bg-slate-900/90 p-4 space-y-3"
                    >
                      <div className="flex items-start gap-4">
                        {/* Thumbnail */}
                        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 group relative">
                          {img.previewUrl.value ? (
                            <button
                              type="button"
                              onClick={() => onZoomImage?.(buildProductZoomImages(product), idx)}
                              className="h-full w-full block cursor-zoom-in relative focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded-lg"
                              title="Nhấn để phóng to ảnh"
                              aria-label={`Phóng to ảnh #${idx + 1}`}
                            >
                              <img
                                src={img.previewUrl.value}
                                alt={img.alt.value}
                                className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                onError={(e) => {
                                  const target = e.currentTarget;
                                  target.style.display = "none";
                                }}
                              />
                              <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs font-semibold">
                                🔍
                              </span>
                            </button>
                          ) : (
                            <span className="text-xl" title="Không có ảnh">📷</span>
                          )}
                        </div>

                        {/* Alt text & metadata */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold text-slate-400 uppercase">
                                  Image Alt #{idx + 1}
                                </span>
                                <SourceBadge source={img.alt.source} />
                              </div>
                              <span className="text-[10px] font-mono text-slate-500">
                                {img.alt.value.length} / 125 ký tự
                              </span>
                            </div>
                            <div className="text-xs text-slate-200 bg-slate-950 p-2 rounded border border-slate-800/80">
                              {img.alt.value || (
                                <span className="text-slate-500 italic">Chưa có Alt text</span>
                              )}
                            </div>
                          </div>

                          {/* WebP info */}
                          <div className="flex items-center gap-2 pt-1 text-xs">
                            <span className="text-slate-500 font-mono text-[11px]">WebP:</span>
                            <span className="font-mono text-cyan-400 text-[11px] truncate flex-1">
                              {img.webpUrl.value || img.webpFilename.value || (
                                <span className="text-slate-500 italic font-sans">Chưa có WebP URL</span>
                              )}
                            </span>
                            <SourceBadge source={img.webpUrl.source} />
                            {(img.webpUrl.value || img.webpFilename.value) ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(img.webpUrl.value || img.webpFilename.value, `img-${idx}`)}
                                className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                              >
                                {copiedKey === `img-${idx}` ? "✓" : "Copy"}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Drawer Footer Actions */}
          <div className="border-t border-slate-800 bg-slate-900/90 px-6 py-4 flex items-center justify-between sticky bottom-0 z-10">
            <button
              type="button"
              onClick={() => onEdit(product)}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 transition cursor-pointer"
            >
              ✏️ Chỉnh sửa
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => onReject(product.id)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-rose-950/60 text-rose-300 hover:bg-rose-900/80 border border-rose-800 transition cursor-pointer"
              >
                ✕ Từ chối (Reject)
              </button>

              <button
                type="button"
                onClick={() => onApprove(product.id)}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30 transition cursor-pointer"
              >
                ✓ Phê duyệt (Approve)
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
