import { useMemo, useState } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { WorkerReviewHistoryPanel } from "../../../modules/custom-gpt-seo";
import type { CustomGptClient } from "../../../modules/custom-gpt-seo";

import { reviewActions } from "../review-actions";
import { ReviewProductActions } from "./ReviewProductActions";
import { ReviewResultContent } from "./ReviewResultContent";
import { ReviewResultStatus } from "./ReviewResultStatus";
import { serializeProductRawJson } from "../product-raw-json-helper";
import { ShopifySyncErrorBanner } from "./ShopifySyncErrorBanner";
import { SeoVersionHistoryPanel, isShopifyProductGid } from "./SeoVersionHistoryPanel";
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
  const [isHistoryVisible, setIsHistoryVisible] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [showRawJsonModal, setShowRawJsonModal] = useState(false);
  const dialogRef = useDialogFocus({ isOpen: isOpen && product !== null, onClose });
  const rawDialogRef = useDialogFocus({ isOpen: isOpen && product !== null && showRawJsonModal, onClose: () => setShowRawJsonModal(false) });
  const rawJsonString = useMemo(
    () => (product ? serializeProductRawJson(product) : ""),
    [product],
  );

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

  const reviewTarget = product.coordinatorReview?.target;
  const sourceVariants = Array.isArray(product.sourceCrawlProduct?.variants)
    ? product.sourceCrawlProduct.variants.filter(
        (variant): variant is Record<string, unknown> => Boolean(variant) && typeof variant === "object",
      )
    : [];

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Chi tiết sản phẩm SEO" className="fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/30 backdrop-blur-sm transition-opacity"
        onClick={onClose}
        aria-hidden="true"
      />

      <div className="fixed inset-y-0 right-0 flex max-w-full pl-10">
        <div className="w-screen max-w-5xl bg-white dark:bg-slate-900 border-l border-slate-200 dark:border-slate-700 shadow-sm flex flex-col">
          {/* Drawer Header */}
          <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-800 sticky top-0 z-10">
            <div className="flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold">
                SEO
              </span>
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                  Kết quả SEO
                </h2>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400 font-mono">
                  <span className="max-w-xl truncate">{product.productTitle.value}</span>
                  {product.asin && <span>• ASIN: {product.asin}</span>}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
                aria-label="Đóng drawer"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Keep the saved result primary; technical history remains opt-in. */}
          <div className="min-h-0 flex-1 overflow-y-auto text-sm text-slate-700 dark:text-slate-300">
            <ReviewResultStatus product={product} currentStoreId={currentStoreId} />
            <ReviewResultContent product={product} onZoomImage={onZoomImage} />
            <div className="space-y-4 px-5 pb-6">
              <details open={isHistoryVisible} className="rounded-lg border border-slate-200 p-4 dark:border-slate-700" onToggle={event => setIsHistoryVisible(event.currentTarget.open)}>
                <summary className="cursor-pointer text-sm font-medium">Lịch sử SEO & đồng bộ</summary>
                {isHistoryVisible && <div className="mt-4 space-y-4">
                  {workerClient && product.gptJobId && product.backendPublishRequired && <WorkerReviewHistoryPanel key={`${product.storeId}:${product.gptJobId}`} client={workerClient} storeId={product.storeId || currentStoreId || ""} jobId={product.gptJobId} />}
                  {workerClient && product.productId && isShopifyProductGid(product.productId) && (product.storeId || currentStoreId)
                    ? <SeoVersionHistoryPanel key={`${product.storeId || currentStoreId}:${product.productId}`} client={workerClient}
                        storeId={product.storeId || currentStoreId || ""} productGid={product.productId} />
                    : <p className="text-xs text-slate-500 dark:text-slate-400">Bản ghi này chưa có lịch sử phiên bản Shopify để truy xuất.</p>}
                </div>}
              </details>
              {(product.coordinatorReview || product.sourcePinterestItem) && <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <summary className="cursor-pointer text-sm font-medium">Cấu hình nguồn, giá & biến thể</summary>
                <div className="mt-4 space-y-4">
            {product.coordinatorReview && reviewTarget && (
              <section className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Cấu hình Shopify đã lưu</h3>
                <dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2">
                  <div><dt className="text-slate-500 dark:text-slate-400">Store</dt><dd className="mt-1 font-mono text-blue-700 dark:text-blue-300">{product.storeId || "—"}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Nhà cung cấp (Vendor)</dt><dd className="mt-1 font-medium text-slate-900 dark:text-slate-100">{(product.storeId ? (product.storeId.split("--")[0] || product.storeId).trim().toUpperCase() : "—")}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Job</dt><dd className="mt-1 font-mono text-slate-700 dark:text-slate-300">{product.coordinatorReview.jobId}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Product type</dt><dd className="mt-1 text-slate-900 dark:text-slate-100">{reviewTarget.productType || "Theo Amazon"}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Collections</dt><dd className="mt-1 break-all text-slate-900 dark:text-slate-100">{reviewTarget.collectionIds.join(", ") || "Không chọn"}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Cộng giá</dt><dd className="mt-1 text-slate-900 dark:text-slate-100">${reviewTarget.priceAddition.toFixed(2)}</dd></div>
                  <div><dt className="text-slate-500 dark:text-slate-400">Compare-at</dt><dd className="mt-1 text-slate-900 dark:text-slate-100">{reviewTarget.discountPercent}%</dd></div>
                </dl>
                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="text-slate-500 dark:text-slate-400"><tr><th className="pb-2 pr-3">SKU</th><th className="pb-2 pr-3">Options</th><th className="pb-2 pr-3">Giá gốc</th><th className="pb-2 pr-3">Giá Shopify</th><th className="pb-2">Compare-at</th></tr></thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700 text-slate-700 dark:text-slate-300">
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
                            <td className="py-2 pr-3 text-blue-700 dark:text-blue-300">{sellingPrice === null ? "—" : `$${sellingPrice.toFixed(2)}`}</td>
                            <td className="py-2 text-amber-700 dark:text-amber-300">{compareAtPrice === null ? "—" : `$${compareAtPrice.toFixed(2)}`}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {sourceVariants.length === 0 && <p className="text-slate-500 dark:text-slate-400">Không có variant.</p>}
                </div>
                {product.sourceCrawlProduct?.customization && (
                  <details className="mt-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-3">
                    <summary className="cursor-pointer font-semibold text-blue-700 dark:text-blue-300">Customization payload</summary>
                    <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap text-xs text-slate-600 dark:text-slate-400">{JSON.stringify(product.sourceCrawlProduct.customization, null, 2)}</pre>
                  </details>
                )}
              </section>
            )}


            {/* Pinterest POD Shopify & Pricing Details */}
            {product.sourcePinterestItem && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🏷️</span>
                    <h3 className="font-semibold text-blue-700 dark:text-blue-300 text-sm">
                      Cấu hình Shopify & Định giá POD
                    </h3>
                  </div>
                  {product.sourcePinterestItem.storeId && (
                    <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                      Store: {product.sourcePinterestItem.storeId.toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Loại SP:</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {product.sourcePinterestItem.productType || "Rug"}
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Nhà cung cấp:</span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {product.sourcePinterestItem.vendor || "CHILLGEN"}
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Giá cộng thêm:</span>
                    <span className="font-mono font-medium text-emerald-700 dark:text-emerald-300">
                      +${(product.sourcePinterestItem.priceAddition ?? 0).toFixed(2)}
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Compare-At:</span>
                    <span className="font-mono font-medium text-amber-700 dark:text-amber-300">
                      {product.sourcePinterestItem.discountPercent ? `Giảm ${product.sourcePinterestItem.discountPercent}%` : "0% (Không gạch)"}
                    </span>
                  </div>
                </div>

                {product.sourcePinterestItem.collectionIds && product.sourcePinterestItem.collectionIds.length > 0 && (
                  <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Collections đã gán: </span>
                    <span className="font-mono text-blue-700 dark:text-blue-300">
                      {product.sourcePinterestItem.collectionIds.length} collection(s)
                    </span>
                  </div>
                )}

                {product.sourcePinterestItem.variants && product.sourcePinterestItem.variants.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400">
                      <span className="font-semibold text-slate-700 dark:text-slate-300">
                        Bảng biến thể ({product.sourcePinterestItem.variants.length} sizes/options):
                      </span>
                    </div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      <table className="w-full text-left text-xs text-slate-700 dark:text-slate-300">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-xs uppercase text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                          <tr>
                            <th className="py-1.5 px-3">Tên biến thể</th>
                            <th className="py-1.5 px-3">Giá bán</th>
                            <th className="py-1.5 px-3">Giá gạch ngang</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs">
                          {product.sourcePinterestItem.variants.map((v, vIdx) => (
                            <tr key={vIdx} className="hover:bg-slate-50 dark:hover:bg-slate-700">
                              <td className="py-1.5 px-3 text-slate-900 dark:text-slate-100 font-sans">{v.title || `Variant #${vIdx + 1}`}</td>
                              <td className="py-1.5 px-3 text-emerald-700 dark:text-emerald-300 font-semibold">${v.price}</td>
                              <td className="py-1.5 px-3 text-slate-500 dark:text-slate-400">
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
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-base">🖨️</span>
                    <h3 className="font-semibold text-blue-700 dark:text-blue-300 text-sm">
                      Bản In Xưởng (Shopify Metafields)
                    </h3>
                  </div>
                  <span className="px-2 py-0.5 rounded text-xs font-bold bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-300 dark:border-blue-800">
                    {product.sourcePinterestItem.printMaster.dpi || 300} DPI • {product.sourcePinterestItem.printMaster.colorMode || "CMYK"}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Độ phân giải:</span>
                    <span className="font-mono font-medium text-slate-900 dark:text-slate-100">
                      {product.sourcePinterestItem.printMaster.widthPx} × {product.sourcePinterestItem.printMaster.heightPx} px
                    </span>
                  </div>
                  <div className="bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700">
                    <span className="text-slate-600 dark:text-slate-400 block text-xs">Metafield đích:</span>
                    <span className="font-mono font-medium text-blue-700 dark:text-blue-300">
                      custom.print_specs
                    </span>
                  </div>
                </div>

                <div className="text-xs text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-2.5 rounded border border-slate-200 dark:border-slate-700 space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400 font-medium">Link file in gốc:</span>
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl ? (
                      <button
                        type="button"
                        onClick={() => handleCopy(
                          product.sourcePinterestItem?.printMaster?.cmykUrl || product.sourcePinterestItem?.printMaster?.rgbUrl || "",
                          "print-master-url"
                        )}
                        className="text-xs text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 transition"
                      >
                        {copiedKey === "print-master-url" ? "✓ Đã copy" : "Copy Link"}
                      </button>
                    ) : null}
                  </div>
                  <p className="font-mono text-slate-700 dark:text-slate-300 truncate text-xs">
                    {product.sourcePinterestItem.printMaster.cmykUrl || product.sourcePinterestItem.printMaster.rgbUrl || product.sourcePinterestItem.printMaster.localFilePath || "Đang tạo..."}
                  </p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 italic pt-1">
                    ✓ File in xưởng được bảo mật tuyệt đối, không hiển thị lên trang bán hàng cho khách xem.
                  </p>
                </div>
              </div>
            )}


                </div>
              </details>}
              <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
                <summary className="cursor-pointer text-sm font-medium">Thông tin kỹ thuật & JSON</summary>
                <div className="mt-4 space-y-4">
                  <p className="break-all text-xs text-slate-500 dark:text-slate-400">ID: {product.id}</p>
                  {product.backendPublish && <p className="break-all text-xs">Tác vụ: {product.backendPublish.id} · {product.backendPublish.state}</p>}
                  {product.shopifySyncStatus === "failed" && <ShopifySyncErrorBanner error={product.shopifySyncError} syncedAt={product.shopifySyncedAt}
                    onRetry={onRetrySync && reviewActions(product).canRetry ? () => onRetrySync(product.id) : undefined} />}
                  {product.syncError && <p className="break-words text-xs text-amber-700 dark:text-amber-300">{product.syncError}</p>}
                  {product.revertError && <p className="break-words text-xs text-amber-700 dark:text-amber-300">{product.revertError}</p>}
                  {product.rejectionReason && <p className="break-words text-xs">{product.rejectionReason}</p>}
            {/* 6. Raw JSON (Full Product Object) */}
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-5 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-base"><AppIcon name="search" /></span>
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Raw JSON Sản Phẩm (Full Payload)
                  </label>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadJson}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-700 transition flex items-center gap-1 cursor-pointer"
                    title="Tải file JSON sản phẩm này về máy tính"
                  >
                    <span><AppIcon name="download" /></span>
                    <span>Tải JSON</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleCopy(rawJsonString, "full-raw-json")}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-blue-700 dark:text-blue-300 border border-slate-300 dark:border-slate-700 transition flex items-center gap-1 cursor-pointer"
                  >
                    {copiedKey === "full-raw-json" ? "✓ Đã copy Full JSON" : "📋 Copy Full JSON"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowRawJsonModal(true)}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-50 dark:hover:bg-blue-950/80 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 transition flex items-center gap-1 cursor-pointer"
                  >
                    <span>Phóng to ↗</span>
                  </button>
                </div>
              </div>
              <pre className="p-4 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-mono text-xs text-blue-700 dark:text-blue-300 overflow-x-auto max-h-64 leading-relaxed select-all">
                {rawJsonString}
              </pre>
            </div>
                </div>
              </details>
            </div>
          </div>

          <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
            <ReviewProductActions product={product} onEdit={onEdit} onApprove={onApprove}
              onSync={onRetrySync} onArchive={onDelete} onRevise={onRequeue} />
          </div>
        </div>
      </div>

      {/* Full Raw JSON Modal */}
      {showRawJsonModal && (
        <div
          ref={rawDialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Raw JSON sản phẩm"
          className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/30 backdrop-blur-sm"
          onClick={() => setShowRawJsonModal(false)}
        >
          <div
            className="bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-lg w-full max-w-4xl max-h-[85vh] flex flex-col shadow-sm overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-800 sticky top-0">
              <div className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-300 font-bold text-base">
                  <AppIcon name="search" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 line-clamp-1">
                    Raw JSON: {product.productTitle.value}
                  </h3>
                  <p className="text-xs text-slate-600 dark:text-slate-400">
                    Toàn bộ object JSON đầy đủ của sản phẩm (bao gồm các trường aeo_*, SEO, mô tả và hình ảnh).
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleDownloadJson}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-900 dark:text-slate-100 border border-slate-300 dark:border-slate-700 transition flex items-center gap-1.5 cursor-pointer shadow-sm"
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
                  className="rounded-lg p-2 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition cursor-pointer"
                  aria-label="Đóng popup"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-auto p-5 bg-white dark:bg-slate-900">
              <pre className="font-mono text-xs text-blue-700 dark:text-blue-300 whitespace-pre leading-relaxed select-all">
                {rawJsonString}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
