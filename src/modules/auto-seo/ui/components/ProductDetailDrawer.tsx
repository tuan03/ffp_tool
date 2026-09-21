import { useState } from "react";

import type { ProductReviewDecision, ShopifyProductForAutoSeoUi } from "../../types";

import { ProductDecisionBadge } from "./ProductDecisionBadge";

export interface ProductDetailDrawerProps {
  product: ShopifyProductForAutoSeoUi | null;
  isOpen: boolean;
  decision?: ProductReviewDecision;
  isLoading?: boolean;
  errorMessage?: string | null;
  onClose(): void;
  onApprove(productId: string): void;
  onMarkNeedsEdit(productId: string): void;
  onMarkDraft(productId: string): void;
  onSkip(productId: string): void;
  selectedImageIndex?: number;
  onSelectImageIndex?(index: number): void;
}

export function ProductDetailDrawer({
  product,
  isOpen,
  decision = "pending",
  isLoading = false,
  errorMessage = null,
  onClose,
  onApprove,
  onMarkNeedsEdit,
  onMarkDraft,
  onSkip,
  selectedImageIndex: controlledImageIndex,
  onSelectImageIndex,
}: ProductDetailDrawerProps): React.JSX.Element | null {
  const [selectedImageIndex, setSelectedImageIndex] = useState(0);
  const [prevProductId, setPrevProductId] = useState<string | undefined>(product?.id);
  const [prevIsOpen, setPrevIsOpen] = useState<boolean>(isOpen);
  const [activeTab, setActiveTab] = useState<"overview" | "description" | "variants" | "raw">("overview");

  // Reset state when product changes
  if (product?.id !== prevProductId) {
    setPrevProductId(product?.id);
    setSelectedImageIndex(0);
    setActiveTab("overview");
  }

  // Reset state when drawer is reopened
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (isOpen) {
      setSelectedImageIndex(0);
      setActiveTab("overview");
    }
  }

  if (!isOpen || !product) {
    return null;
  }

  const isControlled = controlledImageIndex !== undefined;
  const currentImageIndex = isControlled ? controlledImageIndex : selectedImageIndex;

  const images = product.images ?? [];
  const safeImageIndex =
    images.length > 0 ? Math.min(Math.max(0, currentImageIndex), images.length - 1) : 0;
  const activeImage = images[safeImageIndex];

  const handleSelectImage = (idx: number): void => {
    if (!isControlled) {
      setSelectedImageIndex(idx);
    }
    onSelectImageIndex?.(idx);
  };

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-slate-950/70 backdrop-blur-xs flex justify-end transition-opacity">
      {/* Backdrop overlay click to close */}
      <div className="fixed inset-0" onClick={onClose} />

      {/* Drawer content container */}
      <div className="relative z-10 flex h-full w-full max-w-2xl flex-col bg-slate-900 border-l border-slate-800 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4 bg-slate-950/80">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
              <span>🔍</span> Chi tiết sản phẩm (PDP)
            </h2>
            <ProductDecisionBadge decision={decision} />
            {isLoading && (
              <span className="flex items-center gap-1.5 text-[11px] text-cyan-400 bg-cyan-950/60 px-2 py-0.5 rounded-md border border-cyan-800">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 animate-pulse" />
                Đang tải chi tiết...
              </span>
            )}
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition"
            title="Đóng (ESC)"
          >
            ✕
          </button>
        </div>

        {errorMessage && (
          <div className="mx-6 mt-4 rounded-xl border border-rose-800/80 bg-rose-950/40 p-3 text-xs text-rose-200 flex items-center gap-2">
            <span>⚠️</span>
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Tab navigation */}
        <div className="flex border-b border-slate-800 px-6 bg-slate-900/50">
          {[
            { id: "overview", label: "Tổng quan & Media" },
            { id: "variants", label: `Biến thể (${product.variants?.length ?? 0})` },
            { id: "description", label: "Mô tả HTML (Raw Code)" },
            { id: "raw", label: "JSON Debug" },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`border-b-2 py-3 px-3 text-xs font-semibold transition ${
                activeTab === tab.id
                  ? "border-cyan-500 text-cyan-400"
                  : "border-transparent text-slate-400 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Body content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Image Gallery */}
              <div>
                <span className="text-xs font-semibold uppercase text-slate-400 block mb-2">
                  Hình ảnh sản phẩm ({images.length})
                </span>
                {images.length > 0 ? (
                  <div className="space-y-3">
                    {/* Active Featured Image */}
                    <div className="h-64 w-full overflow-hidden rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-center">
                      <img
                        src={activeImage?.url}
                        alt={
                          activeImage?.altText && activeImage.altText.trim().length > 0
                            ? activeImage.altText
                            : product.title
                        }
                        className="h-full w-full object-contain"
                      />
                    </div>

                    {/* Active Image Metadata */}
                    <div className="rounded-lg border border-slate-800 bg-slate-950/80 p-3 text-xs space-y-2">
                      <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 text-[11px]">
                        <span className="font-semibold text-slate-300">
                          Ảnh {safeImageIndex + 1} / {images.length}
                        </span>
                        {typeof activeImage?.width === "number" &&
                        typeof activeImage?.height === "number" &&
                        activeImage.width > 0 &&
                        activeImage.height > 0 ? (
                          <span className="font-mono text-slate-400">
                            Kích thước: {activeImage.width} × {activeImage.height}
                          </span>
                        ) : null}
                      </div>

                      <div className="space-y-1.5">
                        <div>
                          <span className="text-slate-500 text-[11px] block font-medium">Alt Text:</span>
                          <p className="text-slate-200 font-medium break-words">
                            {activeImage?.altText && activeImage.altText.trim().length > 0 ? (
                              activeImage.altText
                            ) : (
                              <span className="text-slate-500 italic">Chưa có Alt Text</span>
                            )}
                          </p>
                        </div>

                        {activeImage?.url ? (
                          <div className="pt-1 border-t border-slate-800/60 text-[11px]">
                            <span className="text-slate-500 block mb-0.5">URL:</span>
                            <a
                              href={activeImage.url}
                              target="_blank"
                              rel="noreferrer"
                              title={activeImage.url}
                              className="text-cyan-400 hover:underline break-all font-mono inline-block max-w-full"
                            >
                              {activeImage.url}
                            </a>
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Thumbnails list */}
                    {images.length > 1 && (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {images.map((img, idx) => {
                          const imgAltText =
                            img.altText && img.altText.trim().length > 0
                              ? img.altText
                              : "Chưa có Alt Text";
                          const isSelected = safeImageIndex === idx;

                          return (
                            <button
                              key={img.id ?? img.url ?? idx}
                              type="button"
                              onClick={() => handleSelectImage(idx)}
                              title={`Ảnh ${idx + 1}: ${imgAltText}`}
                              aria-label={`Ảnh ${idx + 1}: ${imgAltText}`}
                              className={`h-16 w-16 shrink-0 overflow-hidden rounded-lg border-2 transition ${
                                isSelected
                                  ? "border-cyan-500 shadow-md shadow-cyan-500/20"
                                  : "border-slate-800 opacity-70 hover:opacity-100"
                              }`}
                            >
                              <img
                                src={img.url}
                                alt={
                                  img.altText && img.altText.trim().length > 0
                                    ? img.altText
                                    : `Thumbnail ${idx + 1}`
                                }
                                className="h-full w-full object-cover"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                    {isLoading
                      ? "Đang tải hình ảnh sản phẩm từ Shopify..."
                      : "Không có hình ảnh nào được lưu trữ cho sản phẩm này."}
                  </div>
                )}
              </div>

              {/* Product Metadata */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div>
                  <h3 className="text-base font-bold text-slate-100">{product.title}</h3>
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-[11px] font-mono text-slate-400 bg-slate-900 px-2 py-0.5 rounded-sm border border-slate-800">
                      ID: {product.id}
                    </span>
                    <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded-sm border border-cyan-800">
                      handle: {product.handle}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[11px]">Trạng thái:</span>
                    <span className="font-semibold text-slate-300">{product.status ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Nhà cung cấp (Vendor):</span>
                    <span className="font-semibold text-slate-300">{product.vendor ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Loại sản phẩm (Product Type):</span>
                    <span className="font-semibold text-slate-300">{product.productType ?? "N/A"}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block text-[11px]">Số lượng biến thể:</span>
                    <span className="font-semibold text-slate-300">{product.variants?.length ?? 0}</span>
                  </div>
                </div>

                {/* Tags */}
                {product.tags && product.tags.length > 0 && (
                  <div className="pt-2 border-t border-slate-800">
                    <span className="text-slate-500 block text-[11px] mb-1.5">Tags:</span>
                    <div className="flex flex-wrap gap-1.5">
                      {product.tags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-slate-800 px-2 py-0.5 text-xs text-slate-300 border border-slate-700/60"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SEO Metadata */}
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-semibold uppercase text-slate-400">
                    SEO
                  </span>
                  <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/50 px-2 py-0.5 rounded-sm border border-cyan-800">
                    Read-only
                  </span>
                </div>

                <div className="space-y-3 text-xs">
                  <div>
                    <span className="text-slate-500 block text-[11px] font-medium mb-1">SEO Title:</span>
                    <p className="text-slate-200 font-medium break-words">
                      {product.seo?.title && product.seo.title.trim().length > 0 ? (
                        product.seo.title
                      ) : (
                        <span className="text-slate-500 italic">Chưa có SEO Title</span>
                      )}
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-800/80">
                    <span className="text-slate-500 block text-[11px] font-medium mb-1">SEO Description:</span>
                    <p className="text-slate-300 leading-relaxed break-words whitespace-pre-wrap">
                      {product.seo?.description && product.seo.description.trim().length > 0 ? (
                        product.seo.description
                      ) : (
                        <span className="text-slate-500 italic">Chưa có SEO Description</span>
                      )}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "variants" && (
            <div className="space-y-4">
              <span className="text-xs font-semibold uppercase text-slate-400 block">
                Danh sách biến thể ({product.variants?.length ?? 0})
              </span>

              {product.variants && product.variants.length > 0 ? (
                <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-950/60">
                  <table className="w-full text-left text-xs text-slate-300">
                    <thead className="border-b border-slate-800 bg-slate-900/80 text-[11px] uppercase tracking-wider text-slate-400">
                      <tr>
                        <th className="py-2.5 px-3">Tên biến thể</th>
                        <th className="py-2.5 px-3">Giá ($)</th>
                        <th className="py-2.5 px-3">SKU</th>
                        <th className="py-2.5 px-3 text-right">Tồn kho</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60 font-mono text-[11px]">
                      {product.variants.map((variant) => (
                        <tr key={variant.id} className="hover:bg-slate-800/30">
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-200">
                            {variant.title}
                          </td>
                          <td className="py-2.5 px-3 text-emerald-400 font-semibold">
                            {variant.price ? `$${variant.price}` : "N/A"}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{variant.sku ?? "—"}</td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {variant.inventoryQuantity ?? "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center text-xs text-slate-500">
                  {isLoading
                    ? "Đang tải danh sách biến thể từ Shopify..."
                    : "Không có biến thể nào được liệt kê."}
                </div>
              )}
            </div>
          )}

          {activeTab === "description" && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase text-slate-400">
                  Nội dung mô tả HTML gốc (Read-only Code)
                </span>
                <span className="text-[11px] text-amber-400 bg-amber-950/50 px-2 py-0.5 rounded-sm border border-amber-800">
                  Không render trực tiếp để chống XSS
                </span>
              </div>

              <textarea
                readOnly
                value={product.descriptionHtml ?? ""}
                rows={14}
                className="w-full rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300 focus:outline-hidden resize-none leading-relaxed"
                placeholder={
                  isLoading
                    ? "Đang tải mã HTML mô tả sản phẩm từ Shopify..."
                    : "Không có mã HTML mô tả sản phẩm..."
                }
              />
            </div>
          )}

          {activeTab === "raw" && (
            <div className="space-y-3">
              <span className="text-xs font-semibold uppercase text-slate-400 block">
                Raw JSON Payload
              </span>
              <pre className="max-h-96 overflow-auto rounded-xl border border-slate-800 bg-slate-950 p-4 font-mono text-xs text-slate-300">
                {JSON.stringify(product, null, 2)}
              </pre>
            </div>
          )}
        </div>

        {/* Drawer Action Footer */}
        <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-950/90">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => onApprove(product.id)}
              className="rounded-lg bg-emerald-900/80 px-3 py-2 text-xs font-semibold text-emerald-200 border border-emerald-700 hover:bg-emerald-800 transition"
            >
              ✓ Duyệt sản phẩm
            </button>

            <button
              type="button"
              onClick={() => onMarkNeedsEdit(product.id)}
              className="rounded-lg bg-amber-900/80 px-3 py-2 text-xs font-semibold text-amber-200 border border-amber-700 hover:bg-amber-800 transition"
            >
              ✎ Cần sửa
            </button>

            <button
              type="button"
              onClick={() => onMarkDraft(product.id)}
              className="rounded-lg bg-purple-900/80 px-3 py-2 text-xs font-semibold text-purple-200 border border-purple-700 hover:bg-purple-800 transition"
            >
              Draft
            </button>

            <button
              type="button"
              onClick={() => onSkip(product.id)}
              className="rounded-lg bg-rose-900/80 px-3 py-2 text-xs font-semibold text-rose-200 border border-rose-700 hover:bg-rose-800 transition"
            >
              ✕ Bỏ
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-slate-800 px-4 py-2 text-xs font-medium text-slate-300 border border-slate-700 hover:bg-slate-700 transition"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
