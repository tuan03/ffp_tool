import { useState } from "react";
import { buildProductZoomImages } from "../zoom-image-helper";
import type { SeoProductEditInput, SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductEditModalProps {
  readonly product: SeoProductUiViewModel | null;
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly onSave: (id: string, updatedFields: SeoProductEditInput) => void;
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
  readonly onSave: (id: string, updatedFields: SeoProductEditInput) => void;
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

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave(product.id, {
      productTitle,
      productDescription,
      seoTitle,
      seoDescription,
      handle,
      imageAlts,
    });
    onClose();
  }

  function handleAltChange(id: string, newAlt: string) {
    setImageAlts((prev) =>
      prev.map((item) => (item.id === id ? { ...item, alt: newAlt } : item)),
    );
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-2xl rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-900/90">
          <div className="flex items-center gap-2">
            <span className="text-lg">✏️</span>
            <h3 className="text-base font-bold text-slate-100">
              Chỉnh Sửa Nội Dung SEO
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
          >
            ✕
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-5 text-sm">
          {/* Product Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Product Title
            </label>
            <input
              type="text"
              value={productTitle}
              onChange={(e) => setProductTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              required
            />
          </div>

          {/* Handle */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              URL Handle (Slug)
            </label>
            <div className="flex items-center">
              <span className="inline-flex items-center px-3 py-2.5 rounded-l-lg border border-r-0 border-slate-700 bg-slate-800 text-xs text-slate-400 font-mono">
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
                className="w-full rounded-r-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 font-mono focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                required
              />
            </div>
          </div>

          {/* SEO Title */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                SEO Meta Title
              </label>
              <span
                className={`text-xs font-mono ${
                  seoTitle.length > 70 ? "text-rose-400 font-bold" : "text-slate-400"
                }`}
              >
                {seoTitle.length} / 70 ký tự
              </span>
            </div>
            <input
              type="text"
              value={seoTitle}
              onChange={(e) => setSeoTitle(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              required
            />
          </div>

          {/* SEO Description */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                SEO Meta Description
              </label>
              <span
                className={`text-xs font-mono ${
                  seoDescription.length > 160 ? "text-rose-400 font-bold" : "text-slate-400"
                }`}
              >
                {seoDescription.length} / 160 ký tự
              </span>
            </div>
            <textarea
              rows={3}
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
              required
            />
          </div>

          {/* Product Description HTML */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300 mb-1.5">
              Mô tả chi tiết (Shopify HTML)
            </label>
            <textarea
              rows={6}
              value={productDescription}
              onChange={(e) => setProductDescription(e.target.value)}
              className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3.5 py-2.5 text-xs font-mono text-slate-200 placeholder-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 resize-y"
              required
            />
          </div>

          {/* Image Alt Texts */}
          {product.images.length > 0 && (
            <div className="space-y-3 pt-3 border-t border-slate-800">
              <label className="block text-xs font-semibold uppercase tracking-wider text-slate-300">
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
                      className="h-10 w-10 rounded border border-slate-700 overflow-hidden flex-shrink-0 cursor-zoom-in group relative focus:outline-none focus:ring-1 focus:ring-cyan-500"
                      title="Nhấn để phóng to ảnh"
                      aria-label={`Phóng to ảnh #${idx + 1}`}
                    >
                      <img
                        src={img.previewUrl.value}
                        alt={currentAlt}
                        className="h-full w-full object-cover group-hover:scale-105 transition-transform"
                      />
                      <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[9px]">
                        🔍
                      </span>
                    </button>
                    <input
                      type="text"
                      value={currentAlt}
                      onChange={(e) => handleAltChange(img.id, e.target.value)}
                      placeholder={`Alt text cho ảnh #${idx + 1}`}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Footer Actions */}
          <div className="border-t border-slate-800 pt-4 flex items-center justify-end gap-3 sticky bottom-0 bg-slate-900">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-800 text-slate-300 hover:bg-slate-700 transition"
            >
              Hủy bỏ
            </button>
            <button
              type="submit"
              className="px-5 py-2 rounded-lg text-xs font-semibold bg-cyan-600 text-white hover:bg-cyan-500 transition shadow-md shadow-cyan-900/30"
            >
              Lưu thay đổi
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
