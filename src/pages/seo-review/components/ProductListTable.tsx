import { Fragment, useState } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { buildProductZoomImages } from "../zoom-image-helper";
import { SeoSerpPreview } from "./SeoSerpPreview";
import { ShopifySyncErrorBanner } from "./ShopifySyncErrorBanner";
import { SourceBadge } from "./SourceBadge";
import type { SeoProcessingStatus, SeoProductUiViewModel, ZoomImageItem } from "../types";

export interface ProductListTableProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly expandedIds: ReadonlySet<string>;
  readonly onToggleSelect: (id: string) => void;
  readonly onToggleSelectAll: () => void;
  readonly onToggleExpand: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onViewSyncError?: (product: SeoProductUiViewModel) => void;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

export function ProductListTable({
  products,
  selectedIds,
  expandedIds,
  onToggleSelect,
  onToggleSelectAll,
  onToggleExpand,
  onViewProduct,
  onEditProduct,
  onApproveProduct,
  onRejectProduct,
  onRetrySync,
  onViewSyncError,
  onZoomImage,
}: ProductListTableProps): React.JSX.Element {
  const [descViewMode, setDescViewMode] = useState<Record<string, "formatted" | "raw">>({});
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const allSelected = products.length > 0 && products.every((p) => selectedIds.has(p.id));
  const someSelected = products.some((p) => selectedIds.has(p.id)) && !allSelected;

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
          Completed
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
        Pending
      </span>
    );
  }

  function renderShopifySyncBadge(product: SeoProductUiViewModel) {
    if (product.shopifySyncStatus === "syncing") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30 animate-pulse">
          <svg className="animate-spin h-2.5 w-2.5 text-sky-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Đang đẩy...</span>
        </span>
      );
    }
    if (product.shopifySyncStatus === "synced") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span>Đã đẩy Store</span>
          {product.shopifyAdminUrl ? (
            <a
              href={product.shopifyAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-200 underline ml-0.5"
              title="Mở trên Shopify Admin"
              onClick={(e) => e.stopPropagation()}
            >
              ↗
            </a>
          ) : null}
        </span>
      );
    }
    if (product.shopifySyncStatus === "failed") {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          <span>Lỗi đẩy</span>
          {onViewSyncError && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewSyncError(product);
              }}
              className="text-[10px] font-bold text-cyan-300 hover:text-white underline ml-0.5 cursor-pointer"
              title="Xem thông báo lỗi chi tiết"
            >
              Chi tiết
            </button>
          )}
          {onRetrySync ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRetrySync(product.id);
              }}
              className="text-[10px] font-bold text-rose-300 hover:text-white underline ml-0.5 cursor-pointer"
              title="Thử lại đẩy lên Shopify Store"
            >
              Thử lại
            </button>
          ) : null}
        </span>
      );
    }
    return null;
  }

  if (products.length === 0) {
    return (
      <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800/80 text-2xl text-slate-400 border border-slate-700/50 shadow-inner">
          📝
        </div>
        <h3 className="mt-4 text-base font-bold text-slate-200">
          Chưa có sản phẩm nào trong danh sách review
        </h3>
        <p className="mt-2 text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Danh sách đang trống. Bạn hãy sang tab <strong className="text-cyan-400">⚡ Distributed Crawler</strong> để cào sản phẩm và bấm nút <strong className="text-emerald-400">"✨ Bàn giao sang SEO Review"</strong> để tự động chuẩn hóa và đưa sản phẩm vào đây.
        </p>
        <div className="mt-5">
          <a
            href="/amazon-crawler"
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-cyan-600/20 hover:from-cyan-500 hover:to-blue-500 transition"
          >
            <span>⚡ Đi tới Distributed Crawler</span>
            <span>➔</span>
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-800 bg-slate-900/60 shadow-xl backdrop-blur-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm text-slate-300">
          <thead className="bg-slate-950/80 text-[11px] font-semibold uppercase tracking-wider text-slate-400 border-b border-slate-800">
            <tr>
              <th scope="col" className="p-3 w-10 text-center">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(input) => {
                    if (input) {
                      input.indeterminate = someSelected;
                    }
                  }}
                  onChange={onToggleSelectAll}
                  className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                  aria-label="Chọn tất cả sản phẩm"
                />
              </th>
              <th scope="col" className="p-2 w-8 text-center" title="Mở rộng / Thu gọn chi tiết">
                <span className="text-[10px] text-slate-500 font-mono">↕</span>
                <span className="sr-only">Mở rộng chi tiết</span>
              </th>
              <th scope="col" className="py-3 px-2 w-14 text-center">
                Ảnh
              </th>
              <th scope="col" className="py-3 px-3 min-w-[200px]">
                Sản phẩm / Handle
              </th>
              <th scope="col" className="py-3 px-3 min-w-[220px]">
                SEO Meta Title
              </th>
              <th scope="col" className="py-3 px-3 min-w-[240px]">
                SEO Meta Description
              </th>
              <th scope="col" className="py-3 px-2 w-28 text-center">
                Alt ảnh
              </th>
              <th scope="col" className="py-3 px-2 w-28 text-center">
                Trạng thái
              </th>
              <th scope="col" className="py-3 px-3 w-36 text-right">
                Hành động
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/80">
            {products.map((product) => {
              const isSelected = selectedIds.has(product.id);
              const isExpanded = expandedIds.has(product.id);
              const firstImage = product.images[0]?.previewUrl.value || "";
              const currentDescMode = descViewMode[product.id] || "formatted";
              const titleLen = product.seoTitle.value.length;
              const descLen = product.seoDescription.value.length;
              const imagesCount = product.images.length;
              const filledAltCount = product.images.filter((img) => img.alt.value.trim().length > 0).length;

              return (
                <Fragment key={product.id}>
                  <tr
                    className={`transition hover:bg-slate-800/40 ${
                      isSelected ? "bg-cyan-950/20" : ""
                    } ${isExpanded ? "bg-slate-800/20" : ""}`}
                  >
                    {/* Checkbox */}
                    <td className="p-3 text-center">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleSelect(product.id)}
                        className="h-4 w-4 rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-cyan-500 focus:ring-offset-slate-900 cursor-pointer"
                        aria-label={`Chọn sản phẩm ${product.productTitle.value}`}
                      />
                    </td>

                    {/* Expand Accordion Button */}
                    <td className="p-2 text-center">
                      <button
                        type="button"
                        onClick={() => onToggleExpand(product.id)}
                        className="p-1 rounded text-slate-400 hover:text-cyan-400 hover:bg-slate-800 transition cursor-pointer text-xs font-mono"
                        title={isExpanded ? "Thu gọn chi tiết SEO" : "Xem nhanh toàn bộ trường SEO"}
                        aria-expanded={isExpanded}
                      >
                        {isExpanded ? "▼" : "▶"}
                      </button>
                    </td>

                    {/* Thumbnail */}
                    <td className="py-3 px-2">
                      <div className="relative h-12 w-12 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 group">
                        {firstImage ? (
                          <button
                            type="button"
                            onClick={() => onZoomImage?.(buildProductZoomImages(product), 0)}
                            className="h-full w-full block cursor-zoom-in relative focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded-lg"
                            title="Nhấn để phóng to ảnh"
                            aria-label="Phóng to ảnh sản phẩm"
                          >
                            <img
                              src={firstImage}
                              alt={product.images[0]?.alt.value || product.productTitle.value}
                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => {
                                const target = e.currentTarget;
                                target.style.display = "none";
                              }}
                            />
                            <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-[10px]">
                              🔍
                            </span>
                          </button>
                        ) : (
                          <span className="text-base" title="Không có ảnh">📷</span>
                        )}
                      </div>
                    </td>

                    {/* Product Title & Handle */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-0.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => onToggleExpand(product.id)}
                            className="font-semibold text-slate-100 hover:text-cyan-400 text-left line-clamp-1 transition cursor-pointer text-xs"
                          >
                            {product.productTitle.value}
                          </button>
                          <SourceBadge source={product.productTitle.source} />
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-400 font-mono">
                          <span className="text-cyan-500/90 truncate max-w-[160px]">
                            /{product.handle.value}
                          </span>
                          {product.asin && (
                            <span className="text-slate-500">ASIN: {product.asin}</span>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* SEO Meta Title with direct char count */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1 max-w-xs">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                              titleLen >= 45 && titleLen <= 65
                                ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                                : titleLen > 70
                                ? "bg-rose-950/80 text-rose-300 border-rose-800/60"
                                : "bg-amber-950/80 text-amber-300 border-amber-800/60"
                            }`}
                          >
                            {titleLen}/70 ký tự
                          </span>
                          <SourceBadge source={product.seoTitle.source} />
                        </div>
                        <p
                          className="text-xs font-medium text-cyan-300 line-clamp-2 leading-tight"
                          title={product.seoTitle.value}
                        >
                          {product.seoTitle.value || (
                            <span className="text-rose-400 italic">Chưa có SEO title</span>
                          )}
                        </p>
                      </div>
                    </td>

                    {/* SEO Meta Description with direct char count */}
                    <td className="py-3 px-3">
                      <div className="flex flex-col gap-1 max-w-sm">
                        <div className="flex items-center justify-between gap-1">
                          <span
                            className={`text-[10px] font-mono px-1.5 py-0.2 rounded border ${
                              descLen >= 110 && descLen <= 160
                                ? "bg-emerald-950/80 text-emerald-300 border-emerald-800/60"
                                : descLen > 160
                                ? "bg-rose-950/80 text-rose-300 border-rose-800/60"
                                : "bg-amber-950/80 text-amber-300 border-amber-800/60"
                            }`}
                          >
                            {descLen}/160 ký tự
                          </span>
                          <SourceBadge source={product.seoDescription.source} />
                        </div>
                        <p
                          className="text-xs text-slate-300 line-clamp-2 leading-relaxed"
                          title={product.seoDescription.value}
                        >
                          {product.seoDescription.value || (
                            <span className="text-rose-400 italic">Chưa có Meta description</span>
                          )}
                        </p>
                      </div>
                    </td>

                    {/* Image Alts Status */}
                    <td className="py-3 px-2 text-center whitespace-nowrap">
                      {imagesCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => onToggleExpand(product.id)}
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-mono border transition ${
                            filledAltCount === imagesCount
                              ? "bg-emerald-950/60 text-emerald-300 border-emerald-800/60 hover:bg-emerald-900/60"
                              : "bg-amber-950/60 text-amber-300 border-amber-800/60 hover:bg-amber-900/60"
                          }`}
                          title="Bấm để xem tất cả Alt text"
                        >
                          <span>🖼️</span>
                          <span>{filledAltCount}/{imagesCount} Alt</span>
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">Không ảnh</span>
                      )}
                    </td>

                    {/* Status Badges */}
                    <td className="py-3 px-2 text-center whitespace-nowrap space-y-1">
                      <div>{renderReviewBadge(product.reviewDecision)}</div>
                      <div>
                        {renderSeoStatusBadge(
                          product.seoStatus.value,
                          product.seoStatus.source === "mock",
                        )}
                      </div>
                      <div>{renderShopifySyncBadge(product)}</div>
                    </td>

                    {/* Actions */}
                    <td className="py-3 px-3 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title={
                            product.shopifySyncStatus === "syncing"
                              ? "Đang đẩy lên Shopify Store..."
                              : "Phê duyệt nhanh và đẩy lên Store"
                          }
                          disabled={product.shopifySyncStatus === "syncing"}
                          onClick={() => onApproveProduct(product.id)}
                          className={`p-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            product.shopifySyncStatus === "syncing"
                              ? "text-sky-400 bg-sky-950/40 border border-sky-800/40 cursor-not-allowed"
                              : product.shopifySyncStatus === "synced"
                                ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                                : product.reviewDecision === "approved"
                                  ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40"
                                  : "text-emerald-400 hover:bg-emerald-950/60 border border-emerald-800/40 hover:border-emerald-600"
                          }`}
                          aria-label="Phê duyệt"
                        >
                          {product.shopifySyncStatus === "syncing" ? (
                            <svg className="animate-spin h-3.5 w-3.5 text-sky-400" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                          ) : (
                            "✓"
                          )}
                        </button>

                        {product.shopifySyncStatus === "failed" && onRetrySync ? (
                          <button
                            type="button"
                            title="Thử lại đẩy lên Shopify Store"
                            onClick={() => onRetrySync(product.id)}
                            className="p-1.5 rounded-lg text-xs font-semibold text-amber-300 hover:bg-amber-950/60 border border-amber-800/50 hover:border-amber-600 transition cursor-pointer"
                            aria-label="Thử lại đẩy Store"
                          >
                            🔄
                          </button>
                        ) : null}

                        <button
                          type="button"
                          title="Từ chối nhanh"
                          onClick={() => onRejectProduct(product.id)}
                          className={`p-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                            product.reviewDecision === "rejected"
                              ? "bg-rose-950 text-rose-300 border border-rose-700"
                              : "text-rose-400 hover:bg-rose-950/60 border border-rose-800/40 hover:border-rose-600"
                          }`}
                          aria-label="Từ chối"
                        >
                          ✕
                        </button>

                        <button
                          type="button"
                          title="Chỉnh sửa nội dung"
                          onClick={() => onEditProduct(product)}
                          className="p-1.5 rounded-lg text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 transition cursor-pointer"
                        >
                          ✏️
                        </button>

                        <button
                          type="button"
                          title="Mở Drawer chi tiết"
                          onClick={() => onViewProduct(product)}
                          className="p-1.5 rounded-lg text-xs font-medium text-cyan-300 hover:text-cyan-100 bg-cyan-950/60 hover:bg-cyan-900/60 border border-cyan-800/60 transition cursor-pointer"
                        >
                          👁️
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* Inline Expanded Row */}
                  {isExpanded && (
                    <tr className="bg-slate-950/90 border-b border-cyan-900/40">
                      <td colSpan={9} className="p-4 space-y-4">
                        <div className="rounded-xl border border-slate-800/90 bg-slate-900/80 p-4 space-y-4 shadow-inner">
                          {/* Top bar of expanded section */}
                          <div className="flex items-center justify-between border-b border-slate-800/80 pb-2.5">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
                                📋 Chi tiết SEO mở rộng: {product.productTitle.value}
                              </span>
                              {product.rejectionReason && (
                                <span className="text-xs text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800/60">
                                  Lý do từ chối: {product.rejectionReason}
                                </span>
                              )}
                            </div>

                            <button
                              type="button"
                              onClick={() => onToggleExpand(product.id)}
                              className="text-xs text-slate-400 hover:text-slate-200 transition"
                            >
                              ▲ Thu gọn hàng này
                            </button>
                          </div>

                          {/* Shopify Sync Error Banner */}
                          {product.shopifySyncStatus === "failed" && (
                            <ShopifySyncErrorBanner
                              error={product.shopifySyncError}
                              syncedAt={product.shopifySyncedAt}
                              onRetry={onRetrySync ? () => onRetrySync(product.id) : undefined}
                              className="mt-2"
                            />
                          )}

                          {/* 1. SERP Google Snippet Preview */}
                          <SeoSerpPreview
                            seoTitle={product.seoTitle}
                            seoDescription={product.seoDescription}
                            handle={product.handle}
                          />

                          {/* 2. Image Alts Gallery */}
                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-slate-300 block">
                              🖼️ Hình ảnh & Alt text ({product.images.length})
                            </span>
                            {product.images.length === 0 ? (
                              <p className="text-xs text-slate-500 italic">Chưa có ảnh.</p>
                            ) : (
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                                {product.images.map((img, idx) => {
                                  const copyId = `tbl-img-${product.id}-${idx}`;
                                  return (
                                    <div
                                      key={img.id}
                                      className="flex items-start gap-2.5 p-2 rounded-lg bg-slate-900 border border-slate-800"
                                    >
                                      <div className="h-11 w-11 flex-shrink-0 overflow-hidden rounded border border-slate-800 bg-slate-950 group relative">
                                        {img.previewUrl.value ? (
                                          <button
                                            type="button"
                                            onClick={() => onZoomImage?.(buildProductZoomImages(product), idx)}
                                            className="h-full w-full block cursor-zoom-in relative focus:outline-none focus:ring-1 focus:ring-cyan-500 rounded"
                                            title="Nhấn để phóng to ảnh"
                                            aria-label={`Phóng to ảnh #${idx + 1}`}
                                          >
                                            <img
                                              src={img.previewUrl.value}
                                              alt={img.alt.value}
                                              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                                              loading="lazy"
                                              onError={(e) => {
                                                const target = e.currentTarget;
                                                target.style.display = "none";
                                              }}
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
                                        <div className="flex items-center justify-between mb-0.5">
                                          <span className="text-[10px] font-bold text-slate-400 uppercase">
                                            Ảnh #{idx + 1}
                                          </span>
                                          <span className="text-[10px] font-mono text-slate-500">
                                            {img.alt.value.length}/125
                                          </span>
                                        </div>
                                        <p className="text-xs text-slate-200 line-clamp-2 bg-slate-950 p-1 rounded border border-slate-800/80">
                                          {img.alt.value || (
                                            <span className="text-rose-400 italic">Chưa có Alt</span>
                                          )}
                                        </p>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>

                          {/* 3. Product Description */}
                          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3.5 space-y-2">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-bold uppercase tracking-wider text-slate-300">
                                📝 Mô tả sản phẩm (Product Description)
                              </span>
                              <div className="flex items-center rounded-md bg-slate-900 p-0.5 border border-slate-800 text-[11px] font-medium">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setDescViewMode((prev) => ({
                                      ...prev,
                                      [product.id]: "formatted",
                                    }))
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
                                    setDescViewMode((prev) => ({
                                      ...prev,
                                      [product.id]: "raw",
                                    }))
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
                            </div>

                            {currentDescMode === "formatted" ? (
                              <div
                                className="prose prose-invert prose-xs max-w-none p-3 rounded-lg bg-slate-900 border border-slate-800 max-h-52 overflow-y-auto leading-relaxed text-slate-300 text-xs"
                                dangerouslySetInnerHTML={{
                                  __html: sanitizeHtmlDescription(product.productDescription.value),
                                }}
                              />
                            ) : (
                              <div className="relative">
                                <pre className="p-3 rounded-lg bg-slate-950 border border-slate-800 font-mono text-[11px] text-slate-300 overflow-x-auto max-h-52">
                                  {product.productDescription.value}
                                </pre>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopy(product.productDescription.value, `tbl-desc-${product.id}`)
                                  }
                                  className="absolute top-2 right-2 px-2 py-0.5 rounded text-[11px] font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition"
                                >
                                  {copiedKey === `tbl-desc-${product.id}` ? "✓ Đã chép" : "Copy"}
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Quick Bottom Actions */}
                          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800/80">
                            <button
                              type="button"
                              onClick={() => onEditProduct(product)}
                              className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 transition cursor-pointer"
                            >
                              ✏️ Chỉnh sửa nội dung
                            </button>
                            <button
                              type="button"
                              onClick={() => onRejectProduct(product.id)}
                              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-rose-950/70 text-rose-300 hover:bg-rose-900 border border-rose-800 transition cursor-pointer"
                            >
                              ✕ Từ chối
                            </button>
                            <button
                              type="button"
                              onClick={() => onApproveProduct(product.id)}
                              className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30 transition cursor-pointer"
                            >
                              ✓ Phê duyệt
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
