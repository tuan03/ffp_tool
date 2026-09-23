import { useEffect, useState } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { buildProductZoomImages } from "../zoom-image-helper";
import { SeoSerpPreview } from "./SeoSerpPreview";
import { SourceBadge } from "./SourceBadge";
import type { SeoProcessingStatus, SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductSplitViewProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly activeProduct: SeoProductUiViewModel | null;
  readonly onSelectActive: (product: SeoProductUiViewModel) => void;
  readonly onToggleSelect: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onApproveAndNext: (id: string) => void;
  readonly onRejectAndNext: (id: string) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

export function ProductSplitView({
  products,
  selectedIds,
  activeProduct,
  onSelectActive,
  onToggleSelect,
  onViewProduct,
  onEditProduct,
  onApproveProduct,
  onRejectProduct,
  onApproveAndNext,
  onRejectAndNext,
  onZoomImage,
}: ProductSplitViewProps): React.JSX.Element {
  const [descriptionTab, setDescriptionTab] = useState<"formatted" | "raw">("formatted");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // If no active product or activeProduct is not in the filtered products list, auto-select first item
  useEffect(() => {
    if (products.length > 0) {
      const isCurrentInList = activeProduct && products.some((p) => p.id === activeProduct.id);
      if (!isCurrentInList) {
        const first = products[0];
        if (first) {
          onSelectActive(first);
        }
      }
    }
  }, [activeProduct, products, onSelectActive]);

  const activeIndex = activeProduct
    ? products.findIndex((p) => p.id === activeProduct.id)
    : -1;

  function handlePrev() {
    if (activeIndex > 0) {
      const prev = products[activeIndex - 1];
      if (prev) {
        onSelectActive(prev);
      }
    } else if (activeIndex === -1 && products.length > 0) {
      const first = products[0];
      if (first) {
        onSelectActive(first);
      }
    }
  }

  function handleNext() {
    if (activeIndex >= 0 && activeIndex < products.length - 1) {
      const next = products[activeIndex + 1];
      if (next) {
        onSelectActive(next);
      }
    } else if (activeIndex === -1 && products.length > 0) {
      const first = products[0];
      if (first) {
        onSelectActive(first);
      }
    }
  }

  // Keyboard navigation: ArrowLeft/ArrowUp for Prev, ArrowRight/ArrowDown for Next
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const activeTag = document.activeElement?.tagName?.toLowerCase();
      if (
        activeTag === "input" ||
        activeTag === "textarea" ||
        activeTag === "select" ||
        (document.activeElement as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        e.preventDefault();
        handlePrev();
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        handleNext();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeIndex, products, onSelectActive]);

  function handleCopy(text: string, key: string) {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(null), 1600);
    }
  }

  function renderSeoStatusBadge(status: SeoProcessingStatus, isMock: boolean) {
    if (status === "completed") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="h-1 w-1 rounded-full bg-emerald-400" />
          Completed
          {isMock && <SourceBadge source="mock" />}
        </span>
      );
    }
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          Processing
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
        Failed
      </span>
    );
  }

  function renderReviewBadge(decision: "pending" | "approved" | "rejected") {
    if (decision === "approved") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-emerald-950/80 text-emerald-300 border border-emerald-700">
          ✓ Approved
        </span>
      );
    }
    if (decision === "rejected") {
      return (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-rose-950/80 text-rose-300 border border-rose-700">
          ✕ Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold uppercase bg-slate-800 text-slate-400 border border-slate-700">
        Pending
      </span>
    );
  }

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-slate-800 text-xl text-slate-400 border border-slate-700">
          🔍
        </div>
        <h4 className="mt-3 text-sm font-bold text-slate-200">Không có sản phẩm nào</h4>
        <p className="mt-1 text-xs text-slate-400">
          Không tìm thấy sản phẩm nào phù hợp với bộ lọc hoặc từ khóa tìm kiếm hiện tại.
        </p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
      {/* Left Master List */}
      <div className="lg:col-span-5 rounded-2xl border border-slate-800 bg-slate-900/60 shadow-xl overflow-hidden flex flex-col max-h-[calc(100vh-210px)]">
        <div className="p-3 border-b border-slate-800 bg-slate-950/70 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
            Danh sách ({products.length})
          </span>
          <span className="text-[11px] text-slate-500">
            {activeIndex >= 0 ? `Đang chọn #${activeIndex + 1}` : "Chưa chọn"}
          </span>
        </div>

        <div className="overflow-y-auto divide-y divide-slate-800/60 p-1 flex-1">
          {products.map((product, idx) => {
            const isSelected = selectedIds.has(product.id);
            const isActive = activeProduct?.id === product.id;
            const firstImage = product.images[0]?.previewUrl.value || "";

            return (
              <div
                key={product.id}
                onClick={() => onSelectActive(product)}
                className={`p-3 rounded-xl transition cursor-pointer flex items-start gap-3 ${
                  isActive
                    ? "bg-cyan-950/40 border border-cyan-500/50 shadow-md ring-1 ring-cyan-500/20"
                    : "hover:bg-slate-800/40 border border-transparent"
                }`}
              >
                {/* Checkbox */}
                <div
                  className="pt-0.5"
                  onClick={(e) => {
                    e.stopPropagation();
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(product.id)}
                    className="h-3.5 w-3.5 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 cursor-pointer"
                  />
                </div>

                {/* Thumbnail */}
                <div className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 group">
                  {firstImage ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onZoomImage?.(buildProductZoomImages(product), 0);
                      }}
                      className="h-full w-full block cursor-zoom-in relative focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded-lg"
                      title="Nhấn để phóng to ảnh"
                      aria-label="Phóng to ảnh sản phẩm"
                    >
                      <img
                        src={firstImage}
                        alt={product.productTitle.value}
                        className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                        loading="lazy"
                      />
                      <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px]">
                        🔍
                      </span>
                    </button>
                  ) : (
                    <span className="text-sm">📷</span>
                  )}
                </div>

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-1 mb-0.5">
                    <span className="text-xs font-semibold text-slate-200 truncate">
                      {product.productTitle.value}
                    </span>
                    <span className="text-[10px] font-mono text-slate-500 flex-shrink-0">
                      #{idx + 1}
                    </span>
                  </div>

                  <p className="text-[11px] text-cyan-400/80 truncate font-mono">
                    /{product.handle.value}
                  </p>

                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    {renderReviewBadge(product.reviewDecision)}
                    {renderSeoStatusBadge(product.seoStatus.value, product.seoStatus.source === "mock")}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right Detail Inspector */}
      <div className="lg:col-span-7 rounded-2xl border border-slate-800 bg-slate-900/80 shadow-2xl overflow-hidden flex flex-col sticky top-4 max-h-[calc(100vh-140px)]">
        {activeProduct ? (
          <>
            {/* Inspector Header with Navigation */}
            <div className="p-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold text-xs">
                  SEO
                </span>
                <div className="min-w-0">
                  <h3 className="text-sm font-bold text-slate-100 truncate">
                    {activeProduct.productTitle.value}
                  </h3>
                  <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                    <span>/{activeProduct.handle.value}</span>
                    {activeProduct.asin && <span>• ASIN: {activeProduct.asin}</span>}
                  </div>
                </div>
              </div>

              {/* Prev / Next controls */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={activeIndex <= 0 && activeIndex !== -1}
                  className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs transition"
                  title="Sản phẩm trước (Phím tắt: ← hoặc ↑)"
                >
                  ◀
                </button>
                <span className="text-xs font-mono text-slate-400 px-1">
                  {activeIndex >= 0 ? activeIndex + 1 : (products.length > 0 ? 1 : 0)} / {products.length}
                </span>
                <button
                  type="button"
                  onClick={handleNext}
                  disabled={activeIndex >= products.length - 1}
                  className="p-1.5 rounded-lg border border-slate-800 bg-slate-900 text-slate-300 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-xs transition"
                  title="Sản phẩm kế tiếp (Phím tắt: → hoặc ↓)"
                >
                  ▶
                </button>
              </div>
            </div>

            {/* Inspector Body - Scrollable */}
            <div className="p-5 space-y-4 overflow-y-auto flex-1 text-sm text-slate-300">
              {/* Status Banner */}
              <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Trạng thái:</span>
                  {renderReviewBadge(activeProduct.reviewDecision)}
                </div>
                <div className="flex items-center gap-2">
                  {renderSeoStatusBadge(activeProduct.seoStatus.value, activeProduct.seoStatus.source === "mock")}
                </div>
              </div>

              {activeProduct.rejectionReason && (
                <div className="rounded-lg border border-rose-900/60 bg-rose-950/30 p-2.5 text-xs text-rose-300">
                  <span className="font-bold">Lý do từ chối:</span> {activeProduct.rejectionReason}
                </div>
              )}

              {/* 1. Google SERP Preview */}
              <SeoSerpPreview
                seoTitle={activeProduct.seoTitle}
                seoDescription={activeProduct.seoDescription}
                handle={activeProduct.handle}
              />

              {/* 2. Image Alts Gallery */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    🖼️ Image Alt Texts ({activeProduct.images.length})
                  </span>
                </div>

                {activeProduct.images.length === 0 ? (
                  <p className="text-xs text-slate-500 italic">Chưa có hình ảnh.</p>
                ) : (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {activeProduct.images.map((img, idx) => {
                      const copyId = `split-img-${idx}`;
                      return (
                        <div
                          key={img.id}
                          className="flex items-start gap-3 p-2.5 rounded-lg bg-slate-900/90 border border-slate-800"
                        >
                          <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded border border-slate-800 bg-slate-950 group relative">
                            {img.previewUrl.value ? (
                              <button
                                type="button"
                                onClick={() => onZoomImage?.(buildProductZoomImages(activeProduct), idx)}
                                className="h-full w-full block cursor-zoom-in relative focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded"
                                title="Nhấn để phóng to ảnh"
                                aria-label={`Phóng to ảnh #${idx + 1}`}
                              >
                                <img
                                  src={img.previewUrl.value}
                                  alt={img.alt.value}
                                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                />
                                <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px]">
                                  🔍
                                </span>
                              </button>
                            ) : (
                              <span className="text-sm">📷</span>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                Ảnh #{idx + 1}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="text-[10px] font-mono text-slate-400">
                                  {img.alt.value.length}/125
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(img.alt.value, copyId)}
                                  className="text-[10px] text-slate-400 hover:text-cyan-400 cursor-pointer"
                                >
                                  {copiedKey === copyId ? "✓" : "Copy"}
                                </button>
                              </div>
                            </div>
                            <div className="text-xs text-slate-200 bg-slate-950 p-1.5 rounded border border-slate-800">
                              {img.alt.value || <span className="text-rose-400 italic">Chưa có Alt</span>}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Product Description */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                    📝 Mô tả sản phẩm
                  </span>

                  <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-medium">
                    <button
                      type="button"
                      onClick={() => setDescriptionTab("formatted")}
                      className={`px-2 py-0.5 rounded transition ${
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
                      className={`px-2 py-0.5 rounded transition ${
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
                    className="prose prose-invert prose-xs max-w-none p-3 rounded-lg bg-slate-900 border border-slate-800 max-h-56 overflow-y-auto leading-relaxed text-slate-300 text-xs"
                    dangerouslySetInnerHTML={{
                      __html: sanitizeHtmlDescription(activeProduct.productDescription.value),
                    }}
                  />
                ) : (
                  <div className="relative">
                    <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-56">
                      {activeProduct.productDescription.value}
                    </pre>
                    <button
                      type="button"
                      onClick={() =>
                        handleCopy(activeProduct.productDescription.value, `desc-${activeProduct.id}`)
                      }
                      className="absolute top-2 right-2 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                    >
                      {copiedKey === `desc-${activeProduct.id}` ? "✓" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Inspector Sticky Actions Footer */}
            <div className="p-4 border-t border-slate-800 bg-slate-950/90 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onEditProduct(activeProduct)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 transition cursor-pointer"
                >
                  ✏️ Chỉnh sửa
                </button>
                <button
                  type="button"
                  onClick={() => onViewProduct(activeProduct)}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-cyan-950/60 hover:bg-cyan-900/60 text-cyan-300 border border-cyan-800/60 transition cursor-pointer"
                >
                  👁️ Mở Drawer
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => onRejectAndNext(activeProduct.id)}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/80 text-rose-300 hover:bg-rose-900 border border-rose-800 transition cursor-pointer"
                  title="Từ chối và tự động chuyển sang sản phẩm kế tiếp"
                >
                  ✕ Từ chối & Tiếp ➔
                </button>

                <button
                  type="button"
                  onClick={() => onApproveAndNext(activeProduct.id)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30 transition cursor-pointer"
                  title="Phê duyệt và tự động chuyển sang sản phẩm kế tiếp"
                >
                  ✓ Phê duyệt & Tiếp ➔
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="p-12 text-center text-slate-500">
            <span className="text-3xl block mb-2">👈</span>
            Chọn một sản phẩm từ danh sách bên trái để review chi tiết.
          </div>
        )}
      </div>
    </div>
  );
}
