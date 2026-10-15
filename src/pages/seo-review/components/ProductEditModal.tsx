import { useState } from "react";

import { AppIcon } from "../../../shared/components/AppIcon";
import { useDialogFocus } from "../../../shared/hooks/useDialogFocus";
import { buildProductZoomImages } from "../zoom-image-helper";
import { SourceOriginBadge } from "./SourceOriginBadge";
import type { SeoProductEditInput, SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductEditModalProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (id: string, updatedFields: SeoProductEditInput, autoApprove?: boolean) => Promise<boolean>;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

export function ProductEditModal({
  product,
  isOpen,
  onClose,
  onSave,
  onZoomImage,
}: ProductEditModalProps): React.JSX.Element | null {
  if (!isOpen || !product) {
    return null;
  }

  return (
    <EditModalInner
      key={product.id}
      product={product}
      onClose={onClose}
      onSave={onSave}
      onZoomImage={onZoomImage}
    />
  );
}

interface EditModalInnerProps {
  readonly product: SeoProductUiViewModel;
  readonly onClose: () => void;
  readonly onSave: (id: string, updatedFields: SeoProductEditInput, autoApprove?: boolean) => Promise<boolean>;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

function EditModalInner({
  product,
  onClose,
  onSave,
  onZoomImage,
}: EditModalInnerProps): React.JSX.Element {
  const [productTitle, setProductTitle] = useState(product.productTitle.value);
  const [productDescription, setProductDescription] = useState(product.productDescription.value);
  const [seoTitle, setSeoTitle] = useState(product.seoTitle.value);
  const [seoDescription, setSeoDescription] = useState(product.seoDescription.value);
  const [handle, setHandle] = useState(product.handle.value);
  const [imageAlts, setImageAlts] = useState(
    product.images.map((img) => ({ id: img.id, alt: img.alt.value })),
  );
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dialogRef = useDialogFocus({ isOpen: true, onClose: () => { if (!isSaving) onClose(); } });

  const wasAlreadySynced = Boolean(
    product.shopifySyncStatus === "synced" ||
    product.shopifySyncedAt ||
    product.lastSyncedAt ||
    product.shopifyAdminUrl ||
    (product.productId && product.productId.startsWith("gid://shopify/Product/")),
  );

  async function handleSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    if (isSaving) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const wasSaved = await onSave(product.id, {
        productTitle,
        productDescription,
        seoTitle,
        seoDescription,
        handle,
        imageAlts,
      });
      if (wasSaved) onClose();
      else setSaveError("Không thể lưu chỉnh sửa. Hãy kiểm tra thông báo lỗi và thử lại.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleAltChange(id: string, newAlt: string) {
    setImageAlts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, alt: newAlt } : item)),
    );
  }

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Chỉnh sửa nội dung SEO" className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/30 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-700 px-6 py-4 bg-slate-50 dark:bg-slate-800">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-lg"><AppIcon name="edit" /></span>
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Chỉnh Sửa Nội Dung SEO
            </h3>
            <SourceOriginBadge product={product} />
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={(event) => void handleSubmit(event)} className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          {/* Synced Store Notice Banner */}
          {wasAlreadySynced && (
            <div className="flex items-center gap-2.5 rounded-lg border border-blue-300 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-3 text-xs text-blue-700 dark:text-blue-300 shadow-sm">
              <span className="text-base flex-shrink-0"><AppIcon name="store" /></span>
              <div>
                <p className="font-semibold text-blue-700 dark:text-blue-300">
                  Sản phẩm này đã đồng bộ trên Shopify Store ({product.storeId ? product.storeId.toUpperCase() : "STORE"})
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                  Bản đã sync được giữ để xem lại; tạo bản SEO mới nếu cần thay đổi nội dung trên Shopify.
                </p>
              </div>
            </div>
          )}

          {/* Product Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Product Title
            </label>
            <input
              type="text"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400"
              required
            />
          </div>

          {/* Handle */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              URL Handle (Slug)
            </label>
            <div className="flex items-center">
              <span className="inline-flex items-center px-3 py-2.5 rounded-l-lg border border-r-0 border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs text-slate-600 dark:text-slate-400 font-mono">
                /products/
              </span>
              <input
                type="text"
                value={handle}
                onChange={(e) =>
                  setHandle(
                    e.target.value
                      .toLowerCase()
                      .replace(/[^a-z0-9-]+/g, "-"),
                  )
                }
                className="w-full rounded-r-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 font-mono focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400"
                required
              />
            </div>
          </div>

          {/* SEO Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                SEO Meta Title
              </label>
              <span
                className={`text-xs font-mono ${
                  seoTitle.length > 70 ? "text-rose-700 dark:text-rose-300 font-bold" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {seoTitle.length} / 70 ký tự
              </span>
            </div>
            <input
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400"
              required
            />
          </div>

          {/* SEO Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                SEO Meta Description
              </label>
              <span
                className={`text-xs font-mono ${
                  seoDescription.length > 160 ? "text-rose-700 dark:text-rose-300 font-bold" : "text-slate-600 dark:text-slate-400"
                }`}
              >
                {seoDescription.length} / 160 ký tự
              </span>
            </div>
            <textarea
              rows={3}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400 resize-y"
              required
            />
          </div>

          {/* Product Description HTML */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5">
              Mô tả chi tiết (Shopify HTML)
            </label>
            <textarea
              rows={6}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3.5 py-2.5 text-xs font-mono text-slate-900 dark:text-slate-100 placeholder-slate-500 dark:placeholder:text-slate-400 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400 resize-y"
              required
            />
          </div>

          {/* Image Alt Texts */}
          {product.images.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Alt Text cho từng hình ảnh
              </label>
              {product.images.map((img, idx) => {
                const currentAlt =
                  imageAlts.find((a) => a.id === img.id)?.alt || "";
                return (
                  <div key={img.id} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => onZoomImage?.(buildProductZoomImages(product), idx)}
                      className="h-10 w-10 rounded border border-slate-300 dark:border-slate-700 overflow-hidden flex-shrink-0 cursor-zoom-in group relative focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400"
                      title="Nhấn để phóng to ảnh"
                      aria-label={`Phóng to ảnh #${idx + 1}`}
                    >
                      <img
                        src={img.previewUrl.value}
                        alt={currentAlt}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute inset-0 bg-slate-50 dark:bg-slate-800 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-slate-900 dark:text-slate-100 text-xs">
                        <AppIcon name="search" />
                      </span>
                    </button>
                    <input
                      type="text"
                      value={currentAlt}
                      onChange={(e) => handleAltChange(img.id, e.target.value)}
                      placeholder={`Alt text cho ảnh #${idx + 1}`}
                      className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 dark:focus:ring-blue-400"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer Actions */}
          {saveError && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{saveError}</p>}
          <div className="border-t border-slate-200 dark:border-slate-700 pt-4 flex flex-wrap items-center justify-end gap-2.5 sticky bottom-0 bg-white dark:bg-slate-900">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-slate-700 text-slate-900 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 transition border border-slate-300 dark:border-slate-700"
            >
              {isSaving ? "Đang lưu..." : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
