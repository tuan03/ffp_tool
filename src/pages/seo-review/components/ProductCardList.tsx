import { useState } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { SeoSerpPreview } from "./SeoSerpPreview";
import { SourceBadge } from "./SourceBadge";
import type { SeoProcessingStatus, SeoProductUiViewModel } from "../types";

export interface ProductCardListProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly onToggleSelect: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
}

export function ProductCardList({
  products,
  selectedIds,
  onToggleSelect,
  onViewProduct,
  onEditProduct,
  onApproveProduct,
  onRejectProduct,
}: ProductCardListProps): React.JSX.Element {
  const [expandedDescIds, setExpandedDescIds] = useState<ReadonlySet<string>>(new Set());
  const [descViewMode, setDescViewMode] = useState<Record<string, "formatted" | "raw">>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  function toggleDescExpanded(id: string) {
    setExpandedDescIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

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
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          SEO Completed
          {isMock && <SourceBadge source="mock" />}
        </span>
      );
    }
    if (status === "processing") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
          <svg className="animate-spin h-3 w-3 text-cyan-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Processing
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-rose-500/10 text-rose-400 border border-rose-500/20">
        <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
        Failed
      </span>
    );
  }

  function renderReviewBadge(decision: "pending" | "approved" | "rejected") {
    if (decision === "approved") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-emerald-950/80 text-emerald-300 border border-emerald-700">
          ✓ Approved
        </span>
      );
    }
    if (decision === "rejected") {
      return (
        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-rose-950/80 text-rose-300 border border-rose-700">
          ✕ Rejected
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wider bg-slate-800 text-slate-400 border border-slate-700">
        ⏳ Pending
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
    <div className="space-y-4">
      {products.map((product) => {
        const isSelected = selectedIds.has(product.id);
        const isDescExpanded = expandedDescIds.has(product.id);
        const currentDescMode = descViewMode[product.id] || "formatted";
        const firstImage = product.images[0]?.previewUrl.value || "";

        return (
          <div
            key={product.id}
            className={`rounded-2xl border transition-all duration-200 shadow-lg backdrop-blur-sm ${
              isSelected
                ? "border-cyan-500/60 bg-slate-900/90 ring-1 ring-cyan-500/30"
                : "border-slate-800 bg-slate-900/60 hover:border-slate-700/80"
            }`}
          >
            {/* Card Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-4 border-b border-slate-800/80 bg-slate-950/40">
              <div className="flex items-start gap-3 min-w-0">
                {/* Select Checkbox */}
                <div className="pt-1">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => onToggleSelect(product.id)}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                    aria-label={`Chọn sản phẩm ${product.productTitle.value}`}
                  />
                </div>

                {/* Thumbnail */}
                <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 shadow-inner">
                  {firstImage ? (
                    <img
                      src={firstImage}
                      alt={product.images[0]?.alt.value || product.productTitle.value}
                      className="h-full w-full object-cover"
                      loading="lazy"
                      onError={(e) => {
                        const target = e.currentTarget;
                        target.style.display = "none";
                      }}
                    />
                  ) : (
                    <span className="text-xl" title="Không có ảnh">📷</span>
                  )}
                </div>

                {/* Titles and Badges */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={() => onViewProduct(product)}
                      className="font-bold text-slate-100 hover:text-cyan-400 text-sm lg:text-base text-left transition cursor-pointer line-clamp-1"
                    >
                      {product.productTitle.value}
                    </button>
                    <SourceBadge source={product.productTitle.source} />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400 font-mono">
                    <span className="text-cyan-400/90 font-medium">/{product.handle.value}</span>
                    {product.asin && (
                      <span className="text-slate-500">ASIN: {product.asin}</span>
                    )}
                    {product.sourceNiche && (
                      <span className="text-slate-500 font-sans">Niche: {product.sourceNiche}</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800/60">
                <div className="flex items-center gap-2">
                  {renderSeoStatusBadge(product.seoStatus.value, product.seoStatus.source === "mock")}
                  {renderReviewBadge(product.reviewDecision)}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title="Phê duyệt sản phẩm"
                    onClick={() => onApproveProduct(product.id)}
                    className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      product.reviewDecision === "approved"
                        ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                        : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30"
                    }`}
                  >
                    <span>✓</span>
                    <span>Duyệt</span>
                  </button>

                  <button
                    type="button"
                    title="Từ chối sản phẩm"
                    onClick={() => onRejectProduct(product.id)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                      product.reviewDecision === "rejected"
                        ? "bg-rose-950 text-rose-300 border border-rose-700"
                        : "bg-rose-950/60 text-rose-300 hover:bg-rose-900/80 border border-rose-800"
                    }`}
                  >
                    <span>✕</span>
                    <span>Từ chối</span>
                  </button>

                  <button
                    type="button"
                    title="Chỉnh sửa nội dung SEO"
                    onClick={() => onEditProduct(product)}
                    className="p-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition cursor-pointer"
                  >
                    ✏️
                  </button>

                  <button
                    type="button"
                    title="Xem chi tiết đầy đủ trong Drawer"
                    onClick={() => onViewProduct(product)}
                    className="p-1.5 rounded-lg text-xs font-medium text-cyan-300 hover:text-cyan-100 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/60 transition cursor-pointer"
                  >
                    👁️
                  </button>
                </div>
              </div>
            </div>

            {/* Rejection reason banner if any */}
            {product.rejectionReason && (
              <div className="mx-4 mt-3 rounded-lg border border-rose-900/60 bg-rose-950/30 px-3 py-2 text-xs text-rose-300 flex items-center gap-2">
                <span className="font-bold">Lý do từ chối:</span>
                <span>{product.rejectionReason}</span>
              </div>
            )}

            {/* Card Body: Critical SEO Fields Direct Inspection */}
            <div className="p-4 space-y-4">
              {/* 1. Google SERP Snippet Preview */}
              <SeoSerpPreview
                seoTitle={product.seoTitle}
                seoDescription={product.seoDescription}
                handle={product.handle}
              />

              {/* 2. Image Alt Texts Grid */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      🖼️ Image Alt Texts ({product.images.length} ảnh)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      (Tất cả Alt text được tạo tự động)
                    </span>
                  </div>
                </div>

                {product.images.length === 0 ? (
                  <div className="text-xs text-slate-500 italic py-1">
                    Không có hình ảnh cho sản phẩm này.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 max-h-72 overflow-y-auto pr-1">
                    {product.images.map((img, idx) => {
                      const altLen = img.alt.value.length;
                      const copyId = `${product.id}-img-${idx}`;
                      return (
                        <div
                          key={img.id}
                          className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-900/90 border border-slate-800/80"
                        >
                          <div className="relative h-12 w-12 flex-shrink-0 overflow-hidden rounded-md border border-slate-800 bg-slate-950 flex items-center justify-center">
                            {img.previewUrl.value ? (
                              <img
                                src={img.previewUrl.value}
                                alt={img.alt.value}
                                className="h-full w-full object-cover"
                                loading="lazy"
                                onError={(e) => {
                                  const target = e.currentTarget;
                                  target.style.display = "none";
                                }}
                              />
                            ) : (
                              <span className="text-sm">📷</span>
                            )}
                          </div>

                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-0.5">
                              <span className="text-[10px] font-bold text-slate-400 uppercase">
                                Ảnh #{idx + 1}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span
                                  className={`text-[10px] font-mono ${
                                    altLen > 125
                                      ? "text-amber-400"
                                      : altLen > 0
                                      ? "text-emerald-400"
                                      : "text-rose-400"
                                  }`}
                                >
                                  {altLen}/125
                                </span>
                                <button
                                  type="button"
                                  onClick={() => handleCopy(img.alt.value, copyId)}
                                  className="text-[10px] font-medium text-slate-400 hover:text-cyan-400 cursor-pointer"
                                >
                                  {copiedKey === copyId ? "✓" : "Copy"}
                                </button>
                              </div>
                            </div>

                            <p className="text-xs text-slate-200 line-clamp-2 leading-relaxed bg-slate-950/80 p-1.5 rounded border border-slate-800/60">
                              {img.alt.value || (
                                <span className="text-rose-400 italic">Chưa có Alt text</span>
                              )}
                            </p>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 3. Product Description Snippet / Expandable Preview */}
              <div className="rounded-xl border border-slate-800/80 bg-slate-950/50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                      📝 Product Description (Mô tả sản phẩm)
                    </span>
                    <SourceBadge source={product.productDescription.source} />
                  </div>

                  <div className="flex items-center gap-2">
                    {isDescExpanded && (
                      <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-medium">
                        <button
                          type="button"
                          onClick={() =>
                            setDescViewMode((prev) => ({ ...prev, [product.id]: "formatted" }))
                          }
                          className={`px-2 py-0.5 rounded transition ${
                            currentDescMode === "formatted"
                              ? "bg-cyan-600 text-white font-semibold"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDescViewMode((prev) => ({ ...prev, [product.id]: "raw" }))
                          }
                          className={`px-2 py-0.5 rounded transition ${
                            currentDescMode === "raw"
                              ? "bg-cyan-600 text-white font-semibold"
                              : "text-slate-400 hover:text-slate-200"
                          }`}
                        >
                          HTML
                        </button>
                      </div>
                    )}

                    <button
                      type="button"
                      onClick={() => toggleDescExpanded(product.id)}
                      className="text-xs font-medium text-cyan-400 hover:text-cyan-300 transition cursor-pointer flex items-center gap-1"
                    >
                      <span>{isDescExpanded ? "▲ Thu gọn" : "▼ Xem đầy đủ mô tả"}</span>
                    </button>
                  </div>
                </div>

                {isDescExpanded ? (
                  currentDescMode === "formatted" ? (
                    <div
                      className="prose prose-invert prose-xs max-w-none p-3 rounded-lg bg-slate-900 border border-slate-800 max-h-64 overflow-y-auto leading-relaxed text-slate-300 text-xs"
                      dangerouslySetInnerHTML={{
                        __html: sanitizeHtmlDescription(product.productDescription.value),
                      }}
                    />
                  ) : (
                    <div className="relative">
                      <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-64">
                        {product.productDescription.value}
                      </pre>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy(product.productDescription.value, `desc-${product.id}`)
                        }
                        className="absolute top-2 right-2 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                      >
                        {copiedKey === `desc-${product.id}` ? "✓ Đã chép" : "Copy"}
                      </button>
                    </div>
                  )
                ) : (
                  <div
                    className="text-xs text-slate-400 line-clamp-2 leading-relaxed bg-slate-900/60 p-2.5 rounded-lg border border-slate-800/60 cursor-pointer hover:text-slate-300"
                    onClick={() => toggleDescExpanded(product.id)}
                    title="Bấm để mở rộng toàn bộ mô tả"
                  >
                    {product.productDescription.value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() || (
                      <span className="text-rose-400 italic">Chưa có mô tả sản phẩm</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
