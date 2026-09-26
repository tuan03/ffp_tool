import { useEffect, useState } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { buildProductZoomImages } from "../zoom-image-helper";
import { ShopifySyncErrorBanner } from "./ShopifySyncErrorBanner";
import { SourceBadge } from "./SourceBadge";
import type { SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductDetailDrawerProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onEdit: (product: SeoProductUiViewModel) => void;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onRollback?: (id: string) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

function readVariantPrice(variant: Record<string, unknown>): number | null {
  const price = variant.price;
  if (typeof price === "number") return Number.isFinite(price) ? price : null;
  if (typeof price === "string") {
    const parsed = Number.parseFloat(price);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (price && typeof price === "object" && "amount" in price) {
    const amount = (price as { amount?: unknown }).amount;
    return typeof amount === "number" && Number.isFinite(amount) ? amount : null;
  }
  return null;
}

export function ProductDetailDrawer({
  product,
  isOpen,
  onClose,
  onEdit,
  onApprove,
  onReject,
  onRetrySync,
  onRollback,
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
    if (!text) return;
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          setCopiedKey(key);
          setTimeout(() => setCopiedKey(null), 1800);
        })
        .catch(() => {
          // Graceful fallback for non-secure contexts or permission denied
          try {
            const textarea = document.createElement("textarea");
            textarea.value = text;
            textarea.style.position = "fixed";
            textarea.style.opacity = "0";
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand("copy");
            document.body.removeChild(textarea);
            setCopiedKey(key);
            setTimeout(() => setCopiedKey(null), 1800);
          } catch {
            // Silently ignore copy failure without crashing drawer
          }
        });
    } else if (typeof document !== "undefined") {
      try {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
        setCopiedKey(key);
        setTimeout(() => setCopiedKey(null), 1800);
      } catch {
        // Silently ignore copy failure without crashing drawer
      }
    }
  }

  const seoTitleLen = product.seoTitle.value.length;
  const seoDescLen = product.seoDescription.value.length;
  const reviewTarget = product.coordinatorReview?.target;
  const sourceVariants = Array.isArray(product.sourceCrawlProduct?.variants)
    ? product.sourceCrawlProduct.variants.filter(
        (variant): variant is Record<string, unknown> => Boolean(variant) && typeof variant === "object",
      )
    : [];

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
            <div className="flex flex-wrap items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-4 gap-3">
              <div className="flex items-center gap-3 flex-wrap">
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

                {/* Shopify Store Sync Badge */}
                {product.shopifySyncStatus === "queued" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
                    <span className="h-2 w-2 rounded-full bg-amber-400" />
                    <span>Đang chờ đồng bộ Store</span>
                  </span>
                )}
                {product.shopifySyncStatus === "syncing" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30 animate-pulse">
                    <svg className="animate-spin h-3.5 w-3.5 text-sky-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Đang đồng bộ Store...</span>
                  </span>
                )}
                {product.shopifySyncStatus === "synced" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
                    <span className="h-2 w-2 rounded-full bg-emerald-400" />
                    <span>Đã đẩy Shopify Store</span>
                    {product.shopifyAdminUrl && (
                      <a
                        href={product.shopifyAdminUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-400 hover:text-emerald-200 underline inline-flex items-center gap-0.5 ml-1"
                      >
                        Shopify Admin ↗
                      </a>
                    )}
                  </span>
                )}
                {product.shopifySyncStatus === "failed" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
                    <span className="h-2 w-2 rounded-full bg-rose-400" />
                    <span title={product.shopifySyncError}>Lỗi đồng bộ Store</span>
                    {onRetrySync && (
                      <button
                        type="button"
                        onClick={() => onRetrySync(product.id)}
                        className="text-xs font-semibold text-rose-300 hover:text-white underline ml-1 cursor-pointer"
                      >
                        Thử lại
                      </button>
                    )}
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

            {product.lastSyncedAt && product.reviewDecision === "approved" && (
              <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/40 p-3.5 text-xs text-emerald-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <span>✓</span> Đã đồng bộ lên Shopify thành công
                </span>
                <span className="font-mono text-emerald-400">
                  {new Date(product.lastSyncedAt).toLocaleString()}
                </span>
              </div>
            )}

            {product.lastRevertedAt && product.reviewDecision !== "approved" && (
              <div className="rounded-xl border border-amber-900/60 bg-amber-950/40 p-3.5 text-xs text-amber-300 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <span>↩</span> Đã hoàn tác về dữ liệu gốc thành công
                </span>
                <span className="font-mono text-amber-400">
                  {new Date(product.lastRevertedAt).toLocaleString()}
                </span>
              </div>
            )}

            {product.syncError && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3.5 text-xs text-rose-200 flex items-start gap-2.5">
                <span className="text-base flex-shrink-0">⚠️</span>
                <div>
                  <div className="font-bold text-rose-100">Lỗi đồng bộ lên Shopify:</div>
                  <div className="mt-0.5 text-rose-300">{product.syncError}</div>
                </div>
              </div>
            )}

            {product.revertError && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/40 p-3.5 text-xs text-rose-200 flex items-start gap-2.5">
                <span className="text-base flex-shrink-0">⚠️</span>
                <div>
                  <div className="font-bold text-rose-100">Lỗi hoàn tác lên Shopify:</div>
                  <div className="mt-0.5 text-rose-300">{product.revertError}</div>
                </div>
              </div>
            )}

            {/* Rejection notice if present */}
            {product.rejectionReason && (
              <div className="rounded-xl border border-rose-900/60 bg-rose-950/30 p-3.5 text-xs text-rose-300">
                <span className="font-bold">Lý do từ chối / lỗi:</span> {product.rejectionReason}
              </div>
            )}

            {/* Shopify Sync Error Banner */}
            {product.shopifySyncStatus === "failed" && (
              <ShopifySyncErrorBanner
                error={product.shopifySyncError}
                syncedAt={product.shopifySyncedAt}
                onRetry={onRetrySync ? () => onRetrySync(product.id) : undefined}
                showDetailsByDefault={true}
              />
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

            {product.coordinatorReview && reviewTarget && (
              <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-4">
                <h3 className="text-sm font-bold text-slate-200">Thông tin Shopify sẽ đồng bộ</h3>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500">Store</dt><dd className="mt-1 font-mono text-cyan-300">{product.storeId || "—"}</dd></div>
                  <div><dt className="text-slate-500">Job</dt><dd className="mt-1 font-mono text-slate-300">{product.coordinatorReview.jobId}</dd></div>
                  <div><dt className="text-slate-500">Product type</dt><dd className="mt-1 text-slate-200">{reviewTarget.productType || "Theo Amazon"}</dd></div>
                  <div><dt className="text-slate-500">Collections</dt><dd className="mt-1 break-all text-slate-200">{reviewTarget.collectionIds.join(", ") || "Không chọn"}</dd></div>
                  <div><dt className="text-slate-500">Cộng giá</dt><dd className="mt-1 text-slate-200">${reviewTarget.priceAddition.toFixed(2)}</dd></div>
                  <div><dt className="text-slate-500">Compare-at</dt><dd className="mt-1 text-slate-200">{reviewTarget.discountPercent}%</dd></div>
                </dl>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500"><tr><th className="pb-2 pr-3">SKU</th><th className="pb-2 pr-3">Options</th><th className="pb-2 pr-3">Giá gốc</th><th className="pb-2 pr-3">Giá Shopify</th><th className="pb-2">Compare-at</th></tr></thead>
                    <tbody className="divide-y divide-slate-800 text-slate-300">
                      {sourceVariants.map((variant, index) => {
                        const basePrice = readVariantPrice(variant);
                        const sellingPrice = basePrice === null
                          ? null
                          : basePrice + reviewTarget.priceAddition;
                        const discount = reviewTarget.discountPercent;
                        const compareAtPrice = sellingPrice !== null && discount > 0 && discount < 100
                          ? sellingPrice / (1 - discount / 100)
                          : null;
                        return (
                          <tr key={String(variant.id || variant.sku || index)}>
                            <td className="py-2 pr-3 font-mono">{String(variant.sku || "—")}</td>
                            <td className="py-2 pr-3">{JSON.stringify(variant.options || {})}</td>
                            <td className="py-2 pr-3">{basePrice === null ? "—" : `$${basePrice.toFixed(2)}`}</td>
                            <td className="py-2 pr-3 text-cyan-300">{sellingPrice === null ? "—" : `$${sellingPrice.toFixed(2)}`}</td>
                            <td className="py-2 text-amber-300">{compareAtPrice === null ? "—" : `$${compareAtPrice.toFixed(2)}`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sourceVariants.length === 0 && <p className="text-slate-500">Không có variant.</p>}
                </div>
                {product.sourceCrawlProduct?.customization && (
                  <details className="mt-4 rounded-lg border border-violet-900/60 bg-violet-950/20 p-3">
                    <summary className="cursor-pointer font-semibold text-violet-300">Customization payload</summary>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-slate-400">{JSON.stringify(product.sourceCrawlProduct.customization, null, 2)}</pre>
                  </details>
                )}
              </section>
            )}

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

            {/* AEO Suite (Generative / Answer Engine Optimization) */}
            <div className="rounded-xl border border-purple-900/50 bg-purple-950/20 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base">🤖</span>
                  <h3 className="font-bold text-purple-300 text-sm tracking-wide">
                    AEO Suite (AI Search &amp; Overview Optimization)
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/20 text-purple-300 border border-purple-500/30">
                  GEO / Perplexity / ChatGPT Search
                </span>
              </div>

              {/* 1. AI Quick Summary (Featured Snippet Passage) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>⚡ AI Quick Summary</span>
                    <span className="text-[10px] text-slate-500 font-normal">(AI Overviews snippet)</span>
                  </label>
                  {product.aeoQuickSummary && <SourceBadge source={product.aeoQuickSummary.source} />}
                </div>
                <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-200 text-xs leading-relaxed">
                  {product.aeoQuickSummary?.value ? (
                    product.aeoQuickSummary.value
                  ) : (
                    <span className="text-slate-500 italic">Chưa có dữ liệu AEO Quick Summary</span>
                  )}
                </div>
              </div>

              {/* 2. Strategic FAQ (4-pack) */}
              <div className="space-y-2 pt-2 border-t border-purple-900/30">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>❓ Strategic FAQ (Pre-purchase &amp; Differentiation)</span>
                    <span className="text-[10px] text-slate-500 font-normal">
                      ({product.aeoFaq?.value?.length ?? 0} câu hỏi)
                    </span>
                  </label>
                  {product.aeoFaq && <SourceBadge source={product.aeoFaq.source} />}
                </div>
                {product.aeoFaq?.value && product.aeoFaq.value.length > 0 ? (
                  <div className="space-y-2">
                    {product.aeoFaq.value.map((item, qIdx) => (
                      <div key={qIdx} className="p-2.5 rounded-lg bg-slate-900/80 border border-slate-800 space-y-1">
                        <div className="font-semibold text-purple-200 text-xs flex items-start gap-1.5">
                          <span className="text-purple-400 font-mono">Q{qIdx + 1}:</span>
                          <span>{item.question}</span>
                        </div>
                        <div className="text-slate-300 text-xs pl-5 leading-relaxed">
                          {item.answer}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-500 text-xs italic">
                    Chưa có FAQ chiến lược
                  </div>
                )}
              </div>

              {/* 3. JSON-LD Schema @graph */}
              <div className="space-y-1.5 pt-2 border-t border-purple-900/30">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
                    <span>📄 Schema.org JSON-LD (@graph: Product &amp; FAQPage)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {product.aeoJsonLd && <SourceBadge source={product.aeoJsonLd.source} />}
                    {product.aeoJsonLd?.value ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(product.aeoJsonLd?.value || "", "json-ld")}
                        className="px-2.5 py-1 rounded text-xs font-medium bg-purple-900/50 hover:bg-purple-800/60 text-purple-200 border border-purple-700/50 transition flex items-center gap-1"
                      >
                        {copiedKey === "json-ld" ? "✓ Đã copy" : "📋 Copy JSON-LD"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {product.aeoJsonLd?.value ? (
                  <pre className="p-3 rounded-lg bg-slate-950 font-mono text-[11px] text-cyan-300 overflow-x-auto max-h-48 border border-slate-800/80">
                    {product.aeoJsonLd.value}
                  </pre>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 text-slate-500 text-xs italic">
                    Chưa có dữ liệu JSON-LD Schema
                  </div>
                )}
              </div>
            </div>

            {/* Print Master Specification (Shopify Metafields) */}
            {product.sourcePinterestItem?.printMaster && (
              <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🖨️</span>
                    <h3 className="font-semibold text-indigo-300 text-sm">
                      Bản In Xưởng (Shopify Metafields)
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-500/20 text-indigo-300 border border-indigo-500/30">
                    {product.sourcePinterestItem.printMaster.dpi || 300} DPI • {product.sourcePinterestItem.printMaster.colorMode || "CMYK"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Độ phân giải:</span>
                    <span className="font-mono font-medium text-slate-200">
                      {product.sourcePinterestItem.printMaster.widthPx} × {product.sourcePinterestItem.printMaster.heightPx} px
                    </span>
                  </div>
                  <div className="bg-slate-900/80 p-2.5 rounded border border-slate-800">
                    <span className="text-slate-400 block text-[11px]">Metafield đích:</span>
                    <span className="font-mono font-medium text-indigo-300">
                      custom.print_specs
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-400 bg-slate-950/60 p-2.5 rounded border border-slate-800/80 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-400 font-medium">Link file in gốc:</span>
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(
                          product.sourcePinterestItem?.printMaster?.cmykUrl || product.sourcePinterestItem?.printMaster?.rgbUrl || "",
                          "print-master-url"
                        )}
                        className="text-xs text-indigo-400 hover:text-indigo-300 transition"
                      >
                        {copiedKey === "print-master-url" ? "✓ Đã copy" : "Copy Link"}
                      </button>
                    ) : null}
                  </div>
                  <p className="font-mono text-slate-300 truncate text-[10px]">
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl || product.sourcePinterestItem.printMaster.localFilePath || "Đang tạo..."}
                  </p>
                  <p className="text-[10px] text-indigo-400/80 italic pt-1">
                    ✓ File in xưởng được bảo mật tuyệt đối, không hiển thị lên trang bán hàng cho khách xem.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Drawer Footer Actions */}
          <div className="border-t border-slate-800 bg-slate-900/90 px-6 py-4 flex items-center justify-between sticky bottom-0 z-10">
            <button
              type="button"
              onClick={() => onEdit(product)}
              disabled={product.isSyncing || product.isReverting}
              className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition ${
                product.isSyncing || product.isReverting
                  ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                  : "bg-slate-800 text-slate-200 hover:bg-slate-700 border border-slate-700 cursor-pointer"
              }`}
            >
              ✏️ Chỉnh sửa
            </button>

            <div className="flex items-center gap-3">
              {product.shopifyAdminUrl && (
                <a
                  href={product.shopifyAdminUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-emerald-950/60 text-emerald-300 hover:bg-emerald-900/80 border border-emerald-800 transition inline-flex items-center gap-1.5"
                >
                  Shopify Admin ↗
                </a>
              )}

              {product.shopifySyncStatus === "failed" && onRetrySync && (
                <button
                  type="button"
                  onClick={() => onRetrySync(product.id)}
                  className="px-3.5 py-2 rounded-lg text-sm font-semibold bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 transition cursor-pointer"
                >
                  🔄 Thử lại đẩy Store
                </button>
              )}

              {product.reviewDecision === "approved" &&
                product.shopifySyncStatus !== "synced" &&
                product.shopifySyncStatus !== "failed" &&
                onRetrySync && (
                  <button
                    type="button"
                    onClick={() => onRetrySync(product.id)}
                    disabled={product.isSyncing}
                    className="rounded-lg border border-cyan-500/40 bg-cyan-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-cyan-500 disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                  >
                    🛍️ Sync Shopify
                  </button>
                )}

              {/* Nút Hoàn tác dữ liệu cũ */}
              {Boolean(product.originalBackup) &&
                (product.reviewDecision === "approved" || Boolean(product.lastSyncedAt)) && (
                  <button
                    type="button"
                    onClick={() => onRollback?.(product.id)}
                    disabled={product.isSyncing || product.isReverting}
                    className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                      product.isReverting
                        ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                        : product.isSyncing
                          ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                          : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer shadow-sm shadow-amber-950/40"
                    }`}
                    title="Hoàn tác sản phẩm về dữ liệu gốc đã backup lên Shopify"
                  >
                    {product.isReverting ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        <span>Đang hoàn tác Shopify...</span>
                      </>
                    ) : (
                      <>
                        <span>↩</span>
                        <span>Hoàn tác dữ liệu cũ</span>
                      </>
                    )}
                  </button>
                )}

              <button
                type="button"
                onClick={() => onReject(product.id)}
                disabled={product.isSyncing || product.isReverting}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition ${
                  product.isSyncing || product.isReverting
                    ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                    : "bg-rose-950/60 text-rose-300 hover:bg-rose-900/80 border border-rose-800 cursor-pointer"
                }`}
              >
                ✕ Từ chối
              </button>

              <button
                type="button"
                onClick={() => onApprove(product.id)}
                disabled={product.isSyncing || product.isReverting}
                className={`px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2 ${
                  product.isSyncing || product.isReverting
                    ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed"
                    : product.reviewDecision === "approved"
                      ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-pointer"
                      : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30 cursor-pointer"
                }`}
              >
                {product.isSyncing ? (
                  <>
                    <svg className="animate-spin h-4 w-4 text-cyan-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Đang đồng bộ Shopify...</span>
                  </>
                ) : (
                  <>
                    <span>✓</span>
                    <span>{product.reviewDecision === "approved" ? "Đã duyệt" : "Phê duyệt (Approve)"}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
