import { SourceBadge } from "./SourceBadge";
import { SourceOriginBadge } from "./SourceOriginBadge";
import type { SeoProcessingStatus, SeoProductUiViewModel } from "../types";

export interface ProductCardListProps {
  readonly products: readonly SeoProductUiViewModel[];
  readonly selectedIds: ReadonlySet<string>;
  readonly currentStoreId?: string;
  readonly onToggleSelect: (id: string) => void;
  readonly onViewProduct: (product: SeoProductUiViewModel) => void;
  readonly onEditProduct: (product: SeoProductUiViewModel) => void;
  readonly onApproveProduct: (id: string) => void;
  readonly onRejectProduct: (id: string) => void;
  readonly onRetrySync?: (id: string) => void;
  readonly onViewSyncError?: (product: SeoProductUiViewModel) => void;
  readonly onRollbackProduct?: (id: string) => void;
  readonly onDeleteProduct?: (id: string) => void;
}

export function ProductCardList({
  products,
  selectedIds,
  currentStoreId,
  onToggleSelect,
  onViewProduct,
  onEditProduct,
  onApproveProduct,
  onRejectProduct,
  onRetrySync,
  onViewSyncError,
  onRollbackProduct,
  onDeleteProduct,
}: ProductCardListProps): React.JSX.Element {
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

  function renderShopifySyncBadge(product: SeoProductUiViewModel) {
    if (product.shopifySyncStatus === "queued") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-500/10 text-amber-300 border border-amber-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>Đang chờ đẩy Store</span>
        </span>
      );
    }
    if (product.shopifySyncStatus === "syncing") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-sky-500/10 text-sky-400 border border-sky-500/30 animate-pulse">
          <svg className="animate-spin h-3 w-3 text-sky-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <span>Đang đẩy Store...</span>
        </span>
      );
    }
    if (product.shopifySyncStatus === "synced") {
      const isCrossStore = Boolean(
        currentStoreId && product.storeId && currentStoreId.toLowerCase() !== product.storeId.toLowerCase(),
      );
      return (
        <span
          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold ${
            isCrossStore
              ? "bg-amber-500/15 text-amber-300 border border-amber-500/40"
              : "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30"
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${isCrossStore ? "bg-amber-400" : "bg-emerald-400"}`} />
          <span>{product.storeId ? `Đã đẩy (${product.storeId})` : "Đã đẩy Store"}</span>
          {product.shopifyAdminUrl ? (
            <a
              href={product.shopifyAdminUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-400 hover:text-emerald-200 underline inline-flex items-center gap-0.5 ml-0.5"
              title="Mở sản phẩm trên Shopify Admin"
              onClick={(e) => e.stopPropagation()}
            >
              Shopify ↗
            </a>
          ) : null}
        </span>
      );
    }
    if (product.shopifySyncStatus === "failed") {
      return (
        <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
          <span className="h-1.5 w-1.5 rounded-full bg-rose-400" />
          <span>Lỗi đẩy Store</span>
          {onViewSyncError && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onViewSyncError(product);
              }}
              className="text-xs font-semibold text-cyan-300 hover:text-white underline ml-0.5 cursor-pointer"
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
              className="text-xs font-semibold text-rose-300 hover:text-white underline ml-1 cursor-pointer"
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
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 p-3 bg-slate-950/40 rounded-2xl">
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

                <button
                  type="button"
                  onClick={() => onViewProduct(product)}
                  aria-label={`Xem chi tiết sản phẩm ${product.productTitle.value}`}
                  className="group flex min-w-0 flex-1 items-start gap-3 text-left rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400"
                >
                  {/* Thumbnail */}
                  <div className="relative h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 flex items-center justify-center text-slate-600 shadow-inner">
                    {firstImage ? (
                      <>
                        <img
                          src={firstImage}
                          alt={product.images[0]?.alt.value || product.productTitle.value}
                          className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                          loading="lazy"
                          onError={(e) => {
                            e.currentTarget.style.display = "none";
                          }}
                        />
                        <span className="absolute inset-0 bg-slate-950/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white text-xs">Xem</span>
                      </>
                    ) : (
                      <span className="text-xl" title="Không có ảnh">📷</span>
                    )}
                  </div>

                  {/* Titles and Badges */}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-100 group-hover:text-cyan-400 text-sm lg:text-base text-left transition line-clamp-1">
                        {product.productTitle.value}
                      </span>
                      <SourceBadge source={product.productTitle.source} />
                      <SourceOriginBadge product={product} showStore targetStoreId={currentStoreId} />
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-400 font-mono">
                      <span className="text-cyan-400/90 font-medium">/{product.handle.value}</span>
                      {product.asin && <span className="text-slate-500">ASIN: {product.asin}</span>}
                      {product.sourceNiche && <span className="text-slate-500 font-sans">Niche: {product.sourceNiche}</span>}
                    </div>
                  </div>
                </button>
              </div>

              {/* Status and Action Buttons */}
              <div className="flex flex-wrap items-center justify-between lg:justify-end gap-3 pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-800/60">
                <div className="flex items-center gap-2 flex-wrap">
                  {renderSeoStatusBadge(product.seoStatus.value, product.seoStatus.source === "mock")}
                  {renderReviewBadge(product.reviewDecision)}
                  {renderShopifySyncBadge(product)}
                  {product.lastRevertedAt && product.reviewDecision !== "approved" && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/70 text-amber-300 border border-amber-800/60"
                      title={`Đã hoàn tác dữ liệu gốc: ${new Date(product.lastRevertedAt).toLocaleString()}`}
                    >
                      <span>↩</span>
                      <span>Đã hoàn tác</span>
                    </span>
                  )}
                  {(product.shopifySyncError || product.syncError) && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800"
                      title={product.shopifySyncError || product.syncError}
                    >
                      <span>⚠️</span>
                      <span className="max-w-[150px] truncate">Lỗi sync: {product.shopifySyncError || product.syncError}</span>
                    </span>
                  )}
                  {product.revertError && (
                    <span
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-medium bg-rose-950/80 text-rose-300 border border-rose-800"
                      title={product.revertError}
                    >
                      <span>⚠️</span>
                      <span className="max-w-[150px] truncate">Lỗi hoàn tác: {product.revertError}</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    title={
                      product.isSyncing
                        ? "Đang đồng bộ lên Shopify..."
                        : product.isReverting
                          ? "Đang hoàn tác dữ liệu cũ..."
                          : "Phê duyệt nội dung; chưa đồng bộ Shopify"
                    }
                    onClick={() => onApproveProduct(product.id)}
                    disabled={product.isSyncing || product.isReverting}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                      product.isSyncing || product.isReverting
                        ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-80"
                        : product.reviewDecision === "approved"
                          ? "bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 cursor-pointer"
                          : "bg-emerald-600 text-white hover:bg-emerald-500 shadow-md shadow-emerald-900/30 cursor-pointer"
                    }`}
                  >
                    {product.isSyncing ? (
                      <>
                        <svg className="animate-spin h-3.5 w-3.5 text-cyan-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                        </svg>
                        <span>Đang sync...</span>
                      </>
                    ) : (
                      <>
                        <span>✓</span>
                        <span>Duyệt</span>
                      </>
                    )}
                  </button>

                  {product.reviewDecision === "approved" &&
                    product.shopifySyncStatus !== "synced" &&
                    product.shopifySyncStatus !== "failed" &&
                    onRetrySync ? (
                      <button
                        type="button"
                        title={product.isSyncing ? "Đang đồng bộ lên Shopify Store..." : "Sync sản phẩm đã duyệt lên Shopify"}
                        onClick={() => onRetrySync(product.id)}
                        disabled={product.isSyncing}
                        className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition ${
                          product.isSyncing
                            ? "border-cyan-500/60 bg-cyan-700/80 text-cyan-100 cursor-wait shadow-sm shadow-cyan-900/40"
                            : "border-cyan-500/40 bg-cyan-600 text-white hover:bg-cyan-500 cursor-pointer disabled:cursor-not-allowed disabled:bg-slate-800 disabled:text-slate-500"
                        }`}
                      >
                        {product.isSyncing ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-cyan-200" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            <span>Đang đẩy Store...</span>
                          </>
                        ) : (
                          <>
                            <span>🛍️</span>
                            <span>Sync Shopify</span>
                          </>
                        )}
                      </button>
                    ) : null}

                  {product.shopifySyncStatus === "synced" && onRetrySync ? (
                    <button
                      type="button"
                      title={
                        product.storeId && currentStoreId && product.storeId.toLowerCase() !== currentStoreId.toLowerCase()
                          ? `Đồng bộ sản phẩm này sang Store mục tiêu: ${currentStoreId}`
                          : "Đồng bộ lại toàn bộ dữ liệu mới nhất lên Shopify Store"
                      }
                      onClick={() => onRetrySync(product.id)}
                      disabled={product.isSyncing}
                      className="inline-flex items-center gap-1 rounded-lg border border-teal-500/30 bg-slate-800 hover:bg-slate-700 px-2.5 py-1.5 text-xs font-semibold text-teal-300 transition cursor-pointer disabled:opacity-50"
                    >
                      <span>🔄</span>
                      <span>
                        {product.storeId && currentStoreId && product.storeId.toLowerCase() !== currentStoreId.toLowerCase()
                          ? `Sync sang ${currentStoreId}`
                          : "Sync lại"}
                      </span>
                    </button>
                  ) : null}

                  {product.shopifySyncStatus === "failed" && onRetrySync ? (
                    <button
                      type="button"
                      title={product.isSyncing ? "Đang đồng bộ lên Shopify..." : "Thử lại đẩy lên Store"}
                      onClick={() => onRetrySync(product.id)}
                      disabled={product.isSyncing}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                        product.isSyncing
                          ? "bg-amber-950/60 text-amber-200 border border-amber-600/50 cursor-wait shadow-sm"
                          : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 border border-amber-500/40 cursor-pointer"
                      }`}
                    >
                      {product.isSyncing ? (
                        <>
                          <svg className="animate-spin h-3.5 w-3.5 text-amber-300" viewBox="0 0 24 24" fill="none">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                          </svg>
                          <span>Đang đẩy...</span>
                        </>
                      ) : (
                        <>
                          <span>🔄</span>
                          <span>Thử lại</span>
                        </>
                      )}
                    </button>
                  ) : null}

                  {/* Nút Hoàn tác (chỉ hiện khi đã duyệt/sync và có bản backup) */}
                  {Boolean(product.originalBackup) &&
                    (product.reviewDecision === "approved" || Boolean(product.lastSyncedAt)) && (
                      <button
                        type="button"
                        title={
                          product.isReverting
                            ? "Đang hoàn tác dữ liệu cũ lên Shopify..."
                            : "Hoàn tác dữ liệu cũ của sản phẩm đã backup lên lại Shopify"
                        }
                        onClick={() => onRollbackProduct?.(product.id)}
                        disabled={product.isSyncing || product.isReverting}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                          product.isReverting
                            ? "bg-slate-800 text-slate-400 border border-slate-700 cursor-not-allowed opacity-80"
                            : product.isSyncing
                              ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                              : "bg-amber-500/15 text-amber-300 hover:bg-amber-500/25 border border-amber-500/30 cursor-pointer shadow-sm shadow-amber-950/40"
                        }`}
                      >
                        {product.isReverting ? (
                          <>
                            <svg className="animate-spin h-3.5 w-3.5 text-amber-400" viewBox="0 0 24 24" fill="none">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            <span>Đang hoàn tác...</span>
                          </>
                        ) : (
                          <>
                            <span>↩</span>
                            <span>Hoàn tác</span>
                          </>
                        )}
                      </button>
                    )}

                  <button
                    type="button"
                    title="Từ chối sản phẩm"
                    onClick={() => onRejectProduct(product.id)}
                    disabled={product.isSyncing || product.isReverting}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition ${
                      product.isSyncing || product.isReverting
                        ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                        : product.reviewDecision === "rejected"
                          ? "bg-rose-950 text-rose-300 border border-rose-700 cursor-pointer"
                          : "bg-rose-950/60 text-rose-300 hover:bg-rose-900/80 border border-rose-800 cursor-pointer"
                    }`}
                  >
                    <span>✕</span>
                    <span>Từ chối</span>
                  </button>

                  <button
                    type="button"
                    title={
                      product.isSyncing || product.isReverting
                        ? "Không thể chỉnh sửa khi đang đồng bộ hoặc hoàn tác"
                        : "Chỉnh sửa nội dung SEO"
                    }
                    onClick={() => onEditProduct(product)}
                    disabled={product.isSyncing || product.isReverting}
                    className={`p-1.5 rounded-lg text-xs font-medium border transition ${
                      product.isSyncing || product.isReverting
                        ? "bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed"
                        : "text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border-slate-700 cursor-pointer"
                    }`}
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

                  {onDeleteProduct && (
                    <button
                      type="button"
                      title="Xóa sản phẩm này khỏi SEO Review"
                      onClick={() => onDeleteProduct(product.id)}
                      disabled={product.isSyncing || product.isReverting}
                      className={`p-1.5 rounded-lg text-xs font-medium transition ${
                        product.isSyncing || product.isReverting
                          ? "bg-slate-800 text-slate-500 border border-slate-700 cursor-not-allowed"
                          : "text-rose-400 hover:text-rose-200 bg-rose-950/40 hover:bg-rose-900/60 border border-rose-800/50 cursor-pointer shadow-sm shadow-rose-950/40"
                      }`}
                    >
                      🗑️
                    </button>
                  )}
                </div>
              </div>
            </div>

          </div>
        );
      })}
    </div>
  );
}
