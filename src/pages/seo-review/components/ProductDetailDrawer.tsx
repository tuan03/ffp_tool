import { useEffect, useMemo, useState } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import { WorkerReviewHistoryPanel } from "../../../modules/custom-gpt-seo";
import type { CustomGptClient } from "../../../modules/custom-gpt-seo";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { reviewActions } from "../review-actions";
import { ReviewProductActions } from "./ReviewProductActions";
import { ReviewStatusBadge } from "./ReviewStatusBadge";
import { buildProductZoomImages } from "../zoom-image-helper";
import { serializeProductRawJson } from "../product-raw-json-helper";
import { ShopifySyncErrorBanner } from "./ShopifySyncErrorBanner";
import { SeoVersionHistoryPanel, isShopifyProductGid } from "./SeoVersionHistoryPanel";
import { SourceBadge } from "./SourceBadge";
import { SourceOriginBadge } from "./SourceOriginBadge";
import type { SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductDetailDrawerProps {
  readonly workerClient?: CustomGptClient;
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly currentStoreId?: string;
  readonly onClose: () => void;
  readonly onEdit: (product: SeoProductUiViewModel) => void;
  readonly onApprove: (id: string) => void;
  readonly onReject: (id: string) => void;
  readonly onDelete?: (id: string) => void;
  readonly onRequeue?: (id: string) => void;
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
  workerClient,
  product,
  isOpen,
  currentStoreId,
  onClose,
  onEdit,
  onApprove,
  onReject,
  onDelete,
  onRequeue,
  onRetrySync,
  onRollback,
  onZoomImage,
}: ProductDetailDrawerProps): React.JSX.Element | null {
  const [descriptionTab, setDescriptionTab] = useState<"formatted" | "raw">("formatted");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawJsonModal, setShowRawJsonModal] = useState(false);
  const rawJsonString = useMemo(
    () => (product ? serializeProductRawJson(product) : ""),
    [product],
  );

  // Close modal or drawer on Escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (showRawJsonModal) {
          setShowRawJsonModal(false);
        } else if (isOpen) {
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose, showRawJsonModal]);

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

  function handleDownloadJson() {
    if (!rawJsonString || !product) return;
    try {
      const blob = new Blob([rawJsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeSlug = (product.handle.value || product.asin || product.id)
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      link.href = url;
      link.download = `product-${safeSlug || "raw"}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch {
      // Silently catch in environments without DOM blob support
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
        className="fixed inset-0 bg-slate-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-2xl bg-white border-l border-slate-200 shadow-sm flex flex-col">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 border border-blue-300 text-blue-700 font-bold">
                SEO
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 line-clamp-1">
                  Review Chi Tiết SEO
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-600 font-mono">
                  <span>ID: {product.id}</span>
                  {product.asin && <span>• ASIN: {product.asin}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setShowRawJsonModal(true)}
                className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 text-blue-700 hover:bg-slate-100 hover:text-blue-700 border border-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                title="Xem trực quan toàn bộ object JSON đầy đủ của sản phẩm"
              >
                <span><AppIcon name="search" /></span>
                <span>Xem Raw JSON</span>
              </button>

              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition cursor-pointer"
                aria-label="Đóng drawer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Drawer Body - Scrollable */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6 text-sm text-slate-700">
            {workerClient && product.gptJobId && product.backendPublishRequired && <WorkerReviewHistoryPanel key={`${product.storeId}:${product.gptJobId}`} client={workerClient} storeId={product.storeId || currentStoreId || ""} jobId={product.gptJobId} />}
            {workerClient && product.productId && isShopifyProductGid(product.productId) && (product.storeId || currentStoreId) &&
              <SeoVersionHistoryPanel key={`${product.storeId || currentStoreId}:${product.productId}`} client={workerClient}
                storeId={product.storeId || currentStoreId || ""} productGid={product.productId} />}
            {product.backendPublishRequired && (
              <section className="rounded-lg border border-blue-200 bg-white p-4" aria-label="Backend publish">
                <h3 className="font-semibold text-blue-700">Sync trực tiếp qua backend</h3>
                <p>Sync được lưu trên server, không cần giữ tab mở. Vendor, handle, giá và variants không được gửi cập nhật.</p>
                {product.backendPublish && <p className="mt-2 break-all">Tác vụ: {product.backendPublish.id} · {product.backendPublish.state}{product.backendPublish.errorCode ? ` · ${product.backendPublish.errorCode}` : ""}</p>}
                {product.originalBackup && <details className="mt-3">
                  <summary className="cursor-pointer text-blue-700">So sánh nội dung nguồn và bản đề xuất</summary>
                  {[
                    ["Tên sản phẩm", product.originalBackup.productTitle, product.productTitle.value],
                    ["SEO title", product.originalBackup.seoTitle ?? "", product.seoTitle.value],
                    ["Meta description", product.originalBackup.seoDescription ?? "", product.seoDescription.value],
                    ["Mô tả (HTML dạng văn bản)", product.originalBackup.productDescription, product.productDescription.value],
                  ].map(([label, before, after]) => <div key={label} className="mt-3">
                    <h4 className="font-semibold">{label}</h4>
                    <div className="grid gap-3 md:grid-cols-2">
                      <div><span className="text-slate-600">Nguồn đã lưu</span><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{before}</pre></div>
                      <div><span className="text-blue-700">Đề xuất</span><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{after}</pre></div>
                    </div>
                  </div>)}
                </details>}
              </section>
            )}
            {/* Review Status Banner */}
            <div className="flex flex-wrap items-center justify-between rounded-lg border border-slate-200 bg-slate-50 p-4 gap-3">
              <div className="flex items-center gap-3 flex-wrap">
                <SourceOriginBadge product={product} showStore targetStoreId={currentStoreId} />
                {product.seoVersion !== undefined && product.seoVersion > 0 && (
                  <span className="px-2.5 py-1 rounded text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    v{product.seoVersion}
                  </span>
                )}
                <span className="text-xs font-semibold uppercase text-slate-600">| Trạng thái:</span>
                <ReviewStatusBadge product={product} />
                {product.salesChannelPublication && <details className="rounded-lg border border-slate-300 bg-white p-3 text-xs text-slate-700">
                  <summary className="cursor-pointer">Sales Channels: {product.salesChannelPublication.channels.length > 0
                    ? `${product.salesChannelPublication.channels.filter(channel => channel.published).length}/${product.salesChannelPublication.channels.length} đã bật`
                    : "chưa tải được danh sách kênh"}</summary>
                  <ul className="mt-2 space-y-1">
                    {product.salesChannelPublication.channels.map(channel => <li key={channel.id} className={channel.published ? "text-blue-700" : "text-amber-700"}>
                      {channel.name}: {channel.published ? "Đã bật" : "Chưa bật"}
                    </li>)}
                  </ul>
                  {product.salesChannelPublication.error && <p className="mt-2 text-amber-700">{product.salesChannelPublication.error}</p>}
                </details>}

                {/* Shopify Store Sync Badge */}
                {product.shopifySyncStatus === "queued" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-50 text-amber-700 border border-amber-300">
                    <span className="h-2 w-2 rounded-full bg-amber-700" />
                    <span>Đang chờ đồng bộ Store</span>
                  </span>
                )}
                {product.shopifySyncStatus === "syncing" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700 border border-blue-300 animate-pulse">
                    <svg className="animate-spin h-3.5 w-3.5 text-blue-700" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                    <span>Đang đồng bộ Store...</span>
                  </span>
                )}
                {product.shopifySyncStatus === "synced" && (
                  <span
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold ${
                      currentStoreId && product.storeId && currentStoreId.toLowerCase() !== product.storeId.toLowerCase()
                        ? "bg-amber-50 text-amber-700 border border-amber-300"
                        : "bg-emerald-50 text-emerald-700 border border-emerald-300"
                    }`}
                  >
                    <span
                      className={`h-2 w-2 rounded-full ${
                        currentStoreId && product.storeId && currentStoreId.toLowerCase() !== product.storeId.toLowerCase()
                          ? "bg-amber-700"
                          : "bg-emerald-700"
                      }`}
                    />
                    <span>{product.storeId ? `Đã đẩy (${product.storeId})` : "Đã đẩy Shopify Store"}</span>
                    {product.shopifyAdminUrl && (
                      <a
                        href={product.shopifyAdminUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-emerald-700 hover:text-emerald-700 underline inline-flex items-center gap-0.5 ml-1"
                      >
                        Shopify Admin ↗
                      </a>
                    )}
                  </span>
                )}
                {product.shopifySyncStatus === "failed" && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-50 text-rose-700 border border-rose-300">
                    <span className="h-2 w-2 rounded-full bg-rose-600" />
                    <span title={product.shopifySyncError}>Lỗi đồng bộ Store</span>
                    {onRetrySync && reviewActions(product).canRetry && (
                      <button
                        type="button"
                        onClick={() => onRetrySync(product.id)}
                        className="text-xs font-semibold text-rose-700 hover:text-slate-900 underline ml-1 cursor-pointer"
                      >
                        Thử lại
                      </button>
                    )}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Pipeline:</span>
                <span className="capitalize font-mono text-xs font-semibold text-blue-700">
                  {product.seoStatus.value}
                </span>
                <SourceBadge source={product.seoStatus.source} />
              </div>
            </div>

            {product.lastSyncedAt && product.reviewDecision === "approved" && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-xs text-emerald-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <span>✓</span> Đã đồng bộ lên Shopify thành công
                </span>
                <span className="font-mono text-emerald-700">
                  {new Date(product.lastSyncedAt).toLocaleString()}
                </span>
              </div>
            )}

            {product.lastRevertedAt && product.reviewDecision !== "approved" && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-700 flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-medium">
                  <span>↩</span> Đã hoàn tác về dữ liệu gốc thành công
                </span>
                <span className="font-mono text-amber-700">
                  {new Date(product.lastRevertedAt).toLocaleString()}
                </span>
              </div>
            )}

            {product.syncError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 flex items-start gap-2.5">
                <span className="text-base flex-shrink-0"><AppIcon name="warning" /></span>
                <div>
                  <div className="font-bold text-rose-700">Lỗi đồng bộ lên Shopify:</div>
                  <div className="mt-0.5 text-rose-700">{product.syncError}</div>
                </div>
              </div>
            )}

            {product.revertError && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700 flex items-start gap-2.5">
                <span className="text-base flex-shrink-0"><AppIcon name="warning" /></span>
                <div>
                  <div className="font-bold text-rose-700">Lỗi hoàn tác lên Shopify:</div>
                  <div className="mt-0.5 text-rose-700">{product.revertError}</div>
                </div>
              </div>
            )}

            {/* Rejection notice if present */}
            {product.rejectionReason && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3.5 text-xs text-rose-700">
                <span className="font-bold">Lý do từ chối / lỗi:</span> {product.rejectionReason}
              </div>
            )}

            {/* Shopify Sync Error Banner */}
            {product.shopifySyncStatus === "failed" && (
              <ShopifySyncErrorBanner
                error={product.shopifySyncError}
                syncedAt={product.shopifySyncedAt}
                onRetry={onRetrySync && reviewActions(product).canRetry ? () => onRetrySync(product.id) : undefined}
                showDetailsByDefault={true}
              />
            )}

            {/* 1. Product Title & Handle */}
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Product Title (Tiêu đề sản phẩm)
                  </label>
                  <SourceBadge source={product.productTitle.source} />
                </div>
                <div className="font-medium text-slate-900 text-base leading-snug">
                  {product.productTitle.value}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Product Handle (URL Slug)
                  </label>
                  <SourceBadge source={product.handle.source} />
                </div>
                <div className="flex items-center gap-2">
                  <code className="font-mono text-xs text-blue-700 bg-white px-2.5 py-1.5 rounded border border-slate-200 flex-1 overflow-x-auto">
                    /products/{product.handle.value}
                  </code>
                  <button
                    type="button"
                    onClick={() => handleCopy(product.handle.value, "handle")}
                    className="px-2.5 py-1.5 rounded text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
                  >
                    {copiedKey === "handle" ? "✓ Đã chép" : "Copy"}
                  </button>
                </div>
              </div>
            </div>

            {/* 2. SEO Title & SEO Meta Description */}
            <div className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      SEO Title (Meta Title)
                    </label>
                    <SourceBadge source={product.seoTitle.source} />
                  </div>
                  <span
                    className={`text-xs font-mono font-medium ${
                      seoTitleLen > 70 ? "text-rose-700" : seoTitleLen >= 55 ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {seoTitleLen} / 70 ký tự
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-white border border-slate-200 font-medium text-slate-900">
                  {product.seoTitle.value}
                </div>
              </div>

              <div className="pt-3 border-t border-slate-200">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                      SEO Description (Meta Description)
                    </label>
                    <SourceBadge source={product.seoDescription.source} />
                  </div>
                  <span
                    className={`text-xs font-mono font-medium ${
                      seoDescLen > 160 ? "text-rose-700" : seoDescLen >= 120 ? "text-emerald-700" : "text-amber-700"
                    }`}
                  >
                    {seoDescLen} / 160 ký tự
                  </span>
                </div>
                <div className="p-3 rounded-lg bg-white border border-slate-200 text-slate-700 text-xs leading-relaxed">
                  {product.seoDescription.value}
                </div>
              </div>
            </div>

            {/* 3. Product Description (HTML Preview / Raw Code) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                    Product Description (Mô tả chi tiết)
                  </label>
                  <SourceBadge source={product.productDescription.source} />
                </div>

                <div className="flex items-center rounded-lg bg-white p-0.5 border border-slate-200 text-xs font-medium">
                  <button
                    type="button"
                    onClick={() => setDescriptionTab("formatted")}
                    className={`px-3 py-1 rounded transition ${
                      descriptionTab === "formatted"
                        ? "bg-blue-600 text-white font-semibold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    Preview
                  </button>
                  <button
                    type="button"
                    onClick={() => setDescriptionTab("raw")}
                    className={`px-3 py-1 rounded transition ${
                      descriptionTab === "raw"
                        ? "bg-blue-600 text-white font-semibold"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    HTML
                  </button>
                </div>
              </div>

              {descriptionTab === "formatted" ? (
                <div
                  className="prose prose-invert prose-xs max-w-none p-4 rounded-lg bg-white border border-slate-200 max-h-72 overflow-y-auto leading-relaxed text-slate-700"
                  dangerouslySetInnerHTML={{
                    __html: sanitizeHtmlDescription(product.productDescription.value),
                  }}
                />
              ) : (
                <div className="relative">
                  <pre className="p-4 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-slate-700 overflow-x-auto max-h-72">
                    {product.productDescription.value}
                  </pre>
                  <button
                    type="button"
                    onClick={() => handleCopy(product.productDescription.value, "desc")}
                    className="absolute top-2 right-2 px-2.5 py-1 rounded text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
                  >
                    {copiedKey === "desc" ? "✓ Đã chép" : "Copy"}
                  </button>
                </div>
              )}
            </div>

            {product.coordinatorReview && reviewTarget && (
              <section className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h3 className="text-sm font-bold text-slate-900">Thông tin Shopify sẽ đồng bộ</h3>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500">Store</dt><dd className="mt-1 font-mono text-blue-700">{product.storeId || "—"}</dd></div>
                  <div><dt className="text-slate-500">Nhà cung cấp (Vendor)</dt><dd className="mt-1 font-medium text-slate-900">{(product.storeId ? (product.storeId.split("--")[0] || product.storeId).trim().toUpperCase() : "—")}</dd></div>
                  <div><dt className="text-slate-500">Job</dt><dd className="mt-1 font-mono text-slate-700">{product.coordinatorReview.jobId}</dd></div>
                  <div><dt className="text-slate-500">Product type</dt><dd className="mt-1 text-slate-900">{reviewTarget.productType || "Theo Amazon"}</dd></div>
                  <div><dt className="text-slate-500">Collections</dt><dd className="mt-1 break-all text-slate-900">{reviewTarget.collectionIds.join(", ") || "Không chọn"}</dd></div>
                  <div><dt className="text-slate-500">Cộng giá</dt><dd className="mt-1 text-slate-900">${reviewTarget.priceAddition.toFixed(2)}</dd></div>
                  <div><dt className="text-slate-500">Compare-at</dt><dd className="mt-1 text-slate-900">{reviewTarget.discountPercent}%</dd></div>
                </dl>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500"><tr><th className="pb-2 pr-3">SKU</th><th className="pb-2 pr-3">Options</th><th className="pb-2 pr-3">Giá gốc</th><th className="pb-2 pr-3">Giá Shopify</th><th className="pb-2">Compare-at</th></tr></thead>
                    <tbody className="divide-y divide-slate-200 text-slate-700">
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
                            <td className="py-2 pr-3 text-blue-700">{sellingPrice === null ? "—" : `$${sellingPrice.toFixed(2)}`}</td>
                            <td className="py-2 text-amber-700">{compareAtPrice === null ? "—" : `$${compareAtPrice.toFixed(2)}`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sourceVariants.length === 0 && <p className="text-slate-500">Không có variant.</p>}
                </div>
                {product.sourceCrawlProduct?.customization && (
                  <details className="mt-4 rounded-lg border border-blue-200 bg-blue-50 p-3">
                    <summary className="cursor-pointer font-semibold text-blue-700">Customization payload</summary>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-[11px] text-slate-600">{JSON.stringify(product.sourceCrawlProduct.customization, null, 2)}</pre>
                  </details>
                )}
              </section>
            )}

            {/* 4. Images Gallery (Preview, ALT text, WebP URL) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold uppercase tracking-wider text-slate-600">
                  Hình ảnh & Alt Text ({product.images.length})
                </label>
              </div>

              {product.images.length === 0 ? (
                <div className="p-4 rounded-lg bg-white border border-slate-200 text-slate-500 italic text-xs">
                  Sản phẩm này chưa có dữ liệu hình ảnh.
                </div>
              ) : (
                <div className="space-y-4">
                  {product.images.map((img, idx) => (
                    <div
                      key={img.id}
                      className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3"
                    >
                      <div className="flex items-start gap-4">
                        {/* Thumbnail */}
                        <div className="h-20 w-20 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white flex items-center justify-center text-slate-500 group relative">
                          {img.previewUrl.value ? (
                            <button
                              type="button"
                              onClick={() => onZoomImage?.(buildProductZoomImages(product), idx)}
                              className="h-full w-full block cursor-zoom-in relative focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 rounded-lg"
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
                              <span className="absolute inset-0 bg-slate-50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-slate-900 text-xs font-semibold">
                                <AppIcon name="search" />
                              </span>
                            </button>
                          ) : (
                            <span className="text-xl" title="Không có ảnh"><AppIcon name="image" /></span>
                          )}
                        </div>

                        {/* Alt text & metadata */}
                        <div className="flex-1 min-w-0 space-y-2">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <span className="text-[11px] font-bold text-slate-600 uppercase">
                                  Image Alt #{idx + 1}
                                </span>
                                <SourceBadge source={img.alt.source} />
                              </div>
                              <span className="text-[10px] font-mono text-slate-500">
                                {img.alt.value.length} / 125 ký tự
                              </span>
                            </div>
                            <div className="text-xs text-slate-900 bg-white p-2 rounded border border-slate-200">
                              {img.alt.value || (
                                <span className="text-slate-500 italic">Chưa có Alt text</span>
                              )}
                            </div>
                          </div>

                          {/* WebP info */}
                          <div className="flex items-center gap-2 pt-1 text-xs">
                            <span className="text-slate-500 font-mono text-[11px]">WebP:</span>
                            <span className="font-mono text-blue-700 text-[11px] truncate flex-1">
                              {img.webpUrl.value || img.webpFilename.value || (
                                <span className="text-slate-500 italic font-sans">Chưa có WebP URL</span>
                              )}
                            </span>
                            <SourceBadge source={img.webpUrl.source} />
                            {(img.webpUrl.value || img.webpFilename.value) ? (
                              <button
                                type="button"
                                onClick={() => handleCopy(img.webpUrl.value || img.webpFilename.value, `img-${idx}`)}
                                className="px-2 py-0.5 rounded text-[11px] font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 transition"
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
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base"><AppIcon name="code" /></span>
                  <h3 className="font-bold text-blue-700 text-sm tracking-wide">
                    AEO Suite (AI Search &amp; Overview Optimization)
                  </h3>
                </div>
                <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-300">
                  GEO / Perplexity / ChatGPT Search
                </span>
              </div>

              {/* 1. AI Quick Summary (Featured Snippet Passage) */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <span><AppIcon name="seo" /> AI Quick Summary</span>
                    <span className="text-[10px] text-slate-500 font-normal">(AI Overviews snippet)</span>
                  </label>
                  {product.aeoQuickSummary && <SourceBadge source={product.aeoQuickSummary.source} />}
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-900 text-xs leading-relaxed">
                  {product.aeoQuickSummary?.value ? (
                    product.aeoQuickSummary.value
                  ) : (
                    <span className="text-slate-500 italic">Chưa có dữ liệu AEO Quick Summary</span>
                  )}
                </div>
              </div>

              {/* 2. Strategic FAQ (4-pack) */}
              <div className="space-y-2 pt-2 border-t border-blue-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
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
                      <div key={qIdx} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 space-y-1">
                        <div className="font-semibold text-blue-700 text-xs flex items-start gap-1.5">
                          <span className="text-blue-700 font-mono">Q{qIdx + 1}:</span>
                          <span>{item.question}</span>
                        </div>
                        <div className="text-slate-700 text-xs pl-5 leading-relaxed">
                          {item.answer}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs italic">
                    Chưa có FAQ chiến lược
                  </div>
                )}
              </div>

              {/* 3. JSON-LD Schema @graph */}
              <div className="space-y-1.5 pt-2 border-t border-blue-200">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <span>📄 Schema.org JSON-LD (@graph: Product &amp; FAQPage)</span>
                  </label>
                  <div className="flex items-center gap-2">
                    {product.aeoJsonLd && <SourceBadge source={product.aeoJsonLd.source} />}
                    {product.aeoJsonLd?.value ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(product.aeoJsonLd?.value || "", "json-ld")}
                        className="px-2.5 py-1 rounded text-xs font-medium bg-blue-50 hover:bg-blue-50 text-blue-700 border border-blue-200 transition flex items-center gap-1"
                      >
                        {copiedKey === "json-ld" ? "✓ Đã copy" : "📋 Copy JSON-LD"}
                      </button>
                    ) : null}
                  </div>
                </div>
                {product.aeoJsonLd?.value ? (
                  <pre className="p-3 rounded-lg bg-white font-mono text-[11px] text-blue-700 overflow-x-auto max-h-48 border border-slate-200">
                    {product.aeoJsonLd.value}
                  </pre>
                ) : (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs italic">
                    Chưa có dữ liệu JSON-LD Schema
                  </div>
                )}
              </div>
            </div>

            {/* Pinterest POD Shopify & Pricing Details */}
            {product.sourcePinterestItem && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏷️</span>
                    <h3 className="font-semibold text-blue-700 text-sm">
                      Cấu hình Shopify & Định giá POD
                    </h3>
                  </div>
                  {product.sourcePinterestItem.storeId && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-300">
                      Store: {product.sourcePinterestItem.storeId.toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Loại SP:</span>
                    <span className="font-medium text-slate-900">
                      {product.sourcePinterestItem.productType || "Rug"}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Nhà cung cấp:</span>
                    <span className="font-medium text-slate-900">
                      {product.sourcePinterestItem.vendor || "CHILLGEN"}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Giá cộng thêm:</span>
                    <span className="font-mono font-medium text-emerald-700">
                      +${(product.sourcePinterestItem.priceAddition ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Compare-At:</span>
                    <span className="font-mono font-medium text-amber-700">
                      {product.sourcePinterestItem.discountPercent ? `Giảm ${product.sourcePinterestItem.discountPercent}%` : "0% (Không gạch)"}
                    </span>
                  </div>
                </div>

                {product.sourcePinterestItem.collectionIds && product.sourcePinterestItem.collectionIds.length > 0 && (
                  <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 font-medium">Collections đã gán: </span>
                    <span className="font-mono text-blue-700">
                      {product.sourcePinterestItem.collectionIds.length} collection(s)
                    </span>
                  </div>
                )}

                {product.sourcePinterestItem.variants && product.sourcePinterestItem.variants.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="font-semibold text-slate-700">
                        Bảng biến thể ({product.sourcePinterestItem.variants.length} sizes/options):
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-slate-50">
                      <table className="w-full text-left text-xs text-slate-700">
                        <thead className="bg-slate-50 text-[11px] uppercase text-slate-600 border-b border-slate-200">
                          <tr>
                            <th className="py-1.5 px-3">Tên biến thể</th>
                            <th className="py-1.5 px-3">Giá bán</th>
                            <th className="py-1.5 px-3">Giá gạch ngang</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 font-mono text-[11px]">
                          {product.sourcePinterestItem.variants.map((v, vIdx) => (
                            <tr key={vIdx} className="hover:bg-slate-50">
                              <td className="py-1.5 px-3 text-slate-900 font-sans">{v.title || `Variant #${vIdx + 1}`}</td>
                              <td className="py-1.5 px-3 text-emerald-700 font-semibold">${v.price}</td>
                              <td className="py-1.5 px-3 text-slate-500">
                                {v.compareAtPrice ? <span className="line-through">${v.compareAtPrice}</span> : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Print Master Specification (Shopify Metafields) */}
            {product.sourcePinterestItem?.printMaster && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🖨️</span>
                    <h3 className="font-semibold text-blue-700 text-sm">
                      Bản In Xưởng (Shopify Metafields)
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-700 border border-blue-300">
                    {product.sourcePinterestItem.printMaster.dpi || 300} DPI • {product.sourcePinterestItem.printMaster.colorMode || "CMYK"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Độ phân giải:</span>
                    <span className="font-mono font-medium text-slate-900">
                      {product.sourcePinterestItem.printMaster.widthPx} × {product.sourcePinterestItem.printMaster.heightPx} px
                    </span>
                  </div>
                  <div className="bg-slate-50 p-2.5 rounded border border-slate-200">
                    <span className="text-slate-600 block text-[11px]">Metafield đích:</span>
                    <span className="font-mono font-medium text-blue-700">
                      custom.print_specs
                    </span>
                  </div>
                </div>

                <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded border border-slate-200 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 font-medium">Link file in gốc:</span>
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(
                          product.sourcePinterestItem?.printMaster?.cmykUrl || product.sourcePinterestItem?.printMaster?.rgbUrl || "",
                          "print-master-url"
                        )}
                        className="text-xs text-blue-700 hover:text-blue-700 transition"
                      >
                        {copiedKey === "print-master-url" ? "✓ Đã copy" : "Copy Link"}
                      </button>
                    ) : null}
                  </div>
                  <p className="font-mono text-slate-700 truncate text-[10px]">
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl || product.sourcePinterestItem.printMaster.localFilePath || "Đang tạo..."}
                  </p>
                  <p className="text-[10px] text-blue-700 italic pt-1">
                    ✓ File in xưởng được bảo mật tuyệt đối, không hiển thị lên trang bán hàng cho khách xem.
                  </p>
                </div>
              </div>
            )}

            {/* 6. Raw JSON (Full Product Object) */}
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base"><AppIcon name="search" /></span>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700">
                    Raw JSON Sản Phẩm (Full Payload)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-300 transition flex items-center gap-1 cursor-pointer"
                    title="Tải file JSON sản phẩm này về máy tính"
                  >
                    <span><AppIcon name="download" /></span>
                    <span>Tải JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(rawJsonString, "full-raw-json")}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-slate-50 hover:bg-slate-100 text-blue-700 border border-slate-300 transition flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === "full-raw-json" ? "✓ Đã copy Full JSON" : "📋 Copy Full JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawJsonModal(true)}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-blue-50 hover:bg-blue-50 text-blue-700 border border-blue-200 transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>Phóng to ↗</span>
                  </button>
                </div>
              </div>
              <pre className="p-4 rounded-lg bg-white border border-slate-200 font-mono text-[11px] text-blue-700 overflow-x-auto max-h-64 leading-relaxed select-all">
                {rawJsonString}
              </pre>
            </div>
          </div>

          <div className="border-t border-slate-200 bg-white p-4">
            <ReviewProductActions product={product} onEdit={onEdit} onApprove={onApprove}
              onSync={onRetrySync} onArchive={onDelete} onRevise={onRequeue} />
          </div>
        </div>
      </div>

      {/* Full Raw JSON Modal */}
      {showRawJsonModal && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-50 backdrop-blur-sm animate-fadeIn"
          onClick={() => setShowRawJsonModal(false)}
        >
          <div
            className="bg-white border border-slate-300 rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col shadow-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50 sticky top-0">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 border border-blue-300 text-blue-700 font-bold text-base">
                  <AppIcon name="search" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 line-clamp-1">
                    Raw JSON: {product.productTitle.value}
                  </h3>
                  <p className="text-xs text-slate-600">
                    Toàn bộ object JSON đầy đủ của sản phẩm (bao gồm các trường aeo_*, SEO, mô tả và hình ảnh).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 hover:bg-slate-100 text-slate-900 border border-slate-300 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
                  title="Tải file JSON này về máy tính"
                >
                  <span><AppIcon name="download" /></span>
                  <span>Download JSON</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleCopy(rawJsonString, "modal-raw-json")}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-700 text-white transition flex items-center gap-1.5 cursor-pointer shadow-md "
                >
                  {copiedKey === "modal-raw-json" ? "✓ Đã copy Full JSON" : "📋 Copy Full JSON"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowRawJsonModal(false)}
                  className="rounded-lg p-2 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition cursor-pointer"
                  aria-label="Đóng popup"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-5 bg-white">
              <pre className="font-mono text-xs text-blue-700 whitespace-pre leading-relaxed select-all">
                {rawJsonString}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
