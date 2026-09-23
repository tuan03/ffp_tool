import { useEffect, useMemo, useState } from "react";

import { ImageZoomModal } from "./components/ImageZoomModal";
import { ProductCardList } from "./components/ProductCardList";
import { ProductDetailDrawer } from "./components/ProductDetailDrawer";
import { ProductEditModal } from "./components/ProductEditModal";
import { ProductListTable } from "./components/ProductListTable";
import { ProductSplitView } from "./components/ProductSplitView";
import { SeoBatchToolbar } from "./components/SeoBatchToolbar";
import { filterSeoProducts, findNextProductInList } from "./review-navigation";
import type {
  SeoProductEditInput,
  SeoProductUiViewModel,
  SeoReviewFilterState,
  SeoReviewViewMode,
  ZoomImageItem,
} from "./types";

const SESSION_STORAGE_KEY = "ffp_seo_review_session_v1";
const VIEW_MODE_STORAGE_KEY = "ffp_seo_review_view_mode";

export function SeoReviewPage(): React.JSX.Element {
  const [products, setProducts] = useState<readonly SeoProductUiViewModel[]>(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            // Filter out any leftover fake sample data from previous sessions
            const realOnly = parsed.filter(
              (p: { id?: string }) =>
                p && typeof p.id === "string" && !p.id.startsWith("sample-prod-"),
            );
            return realOnly;
          }
        }
      } catch {
        // Fall back to empty list
      }
    }
    return [];
  });

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeProduct, setActiveProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  // High-Resolution Image Zoom Modal State
  const [zoomState, setZoomState] = useState<{
    isOpen: boolean;
    images: readonly ZoomImageItem[];
    initialIndex: number;
  }>({
    isOpen: false,
    images: [],
    initialIndex: 0,
  });

  function handleOpenZoomImage(images: readonly ZoomImageItem[], initialIndex = 0) {
    if (images.length === 0) return;
    setZoomState({
      isOpen: true,
      images,
      initialIndex,
    });
  }

  function handleCloseZoomImage() {
    setZoomState((prev) => ({ ...prev, isOpen: false }));
  }

  const [viewMode, setViewMode] = useState<SeoReviewViewMode>(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const saved = window.sessionStorage.getItem(VIEW_MODE_STORAGE_KEY);
        if (saved === "cards" || saved === "table" || saved === "split") {
          return saved;
        }
      } catch {
        // ignore
      }
    }
    return "cards";
  });

  const [expandedTableIds, setExpandedTableIds] = useState<ReadonlySet<string>>(new Set());

  const [filter, setFilter] = useState<SeoReviewFilterState>({
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });

  const [handoffBanner, setHandoffBanner] = useState<{
    count: number;
    timestamp: number;
    source?: string;
  } | null>(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const raw = window.sessionStorage.getItem("ffp_seo_review_handoff_banner");
        if (raw) {
          window.sessionStorage.removeItem("ffp_seo_review_handoff_banner");
          return JSON.parse(raw) as { count: number; timestamp: number; source?: string };
        }
      } catch {
        // ignore
      }
    }
    return null;
  });

  // Persist review state to sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(products));
      } catch {
        // Storage limit or private mode warning
      }
    }
  }, [products]);

  // Persist view mode preference to sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        window.sessionStorage.setItem(VIEW_MODE_STORAGE_KEY, viewMode);
      } catch {
        // Storage limit
      }
    }
  }, [viewMode]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return filterSeoProducts(products, filter);
  }, [products, filter]);

  // Keep activeProduct synchronized with filteredProducts
  useEffect(() => {
    if (filteredProducts.length === 0) {
      if (activeProduct !== null) {
        setActiveProduct(null);
      }
      return;
    }

    if (activeProduct) {
      const match = filteredProducts.find((p) => p.id === activeProduct.id);
      if (match) {
        if (match !== activeProduct) {
          setActiveProduct(match);
        }
      } else {
        // Active product was filtered out or removed; select the first visible filtered product
        setActiveProduct(filteredProducts[0] ?? null);
      }
    } else {
      setActiveProduct(filteredProducts[0] ?? null);
    }
  }, [filteredProducts, activeProduct]);

  // Stats calculation
  const stats = useMemo(() => {
    const total = products.length;
    const completed = products.filter((p) => p.seoStatus.value === "completed").length;
    const pending = products.filter((p) => p.reviewDecision === "pending").length;
    const approved = products.filter((p) => p.reviewDecision === "approved").length;
    const rejected = products.filter((p) => p.reviewDecision === "rejected").length;
    const hasMock = products.filter((p) =>
      p.productTitle.source === "mock" ||
      p.seoTitle.source === "mock" ||
      p.seoDescription.source === "mock" ||
      p.handle.source === "mock",
    ).length;

    return { total, completed, pending, approved, rejected, hasMock };
  }, [products]);

  // Selection handlers
  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleToggleSelectAll() {
    if (filteredProducts.every((p) => selectedIds.has(p.id))) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
    }
  }

  function handleSelectAll() {
    setSelectedIds(new Set(filteredProducts.map((p) => p.id)));
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
  }

  // Table row accordion expansion handlers
  function handleToggleExpandTable(id: string) {
    setExpandedTableIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function handleToggleExpandAllTable() {
    if (filteredProducts.length > 0 && filteredProducts.every((p) => expandedTableIds.has(p.id))) {
      setExpandedTableIds(new Set());
    } else {
      setExpandedTableIds(new Set(filteredProducts.map((p) => p.id)));
    }
  }

  const isAllExpanded =
    filteredProducts.length > 0 &&
    filteredProducts.every((p) => expandedTableIds.has(p.id));

  // Individual Actions
  function handleViewProduct(product: SeoProductUiViewModel) {
    setActiveProduct(product);
    setIsDrawerOpen(true);
  }

  function handleApproveProduct(id: string) {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, reviewDecision: "approved", updatedAt: Date.now() } : p,
      ),
    );
  }

  function handleRejectProduct(id: string, reason = "Nội dung SEO chưa đạt yêu cầu") {
    setProducts((prev) =>
      prev.map((p) =>
        p.id === id
          ? { ...p, reviewDecision: "rejected", rejectionReason: reason, updatedAt: Date.now() }
          : p,
      ),
    );
  }

  function advanceToNextProduct(currentId: string) {
    const next = findNextProductInList(filteredProducts, currentId);
    if (next && next.id !== currentId) {
      setActiveProduct(next);
    } else if (filteredProducts.length <= 1) {
      setActiveProduct(null);
    }
  }

  function handleApproveAndNext(id: string) {
    handleApproveProduct(id);
    advanceToNextProduct(id);
  }

  function handleRejectAndNext(id: string) {
    handleRejectProduct(id);
    advanceToNextProduct(id);
  }

  // Batch Actions
  function handleApproveSelected() {
    setProducts((prev) =>
      prev.map((p) =>
        selectedIds.has(p.id) ? { ...p, reviewDecision: "approved", updatedAt: Date.now() } : p,
      ),
    );
    setSelectedIds(new Set());
  }

  function handleRejectSelected() {
    setProducts((prev) =>
      prev.map((p) =>
        selectedIds.has(p.id)
          ? {
              ...p,
              reviewDecision: "rejected",
              rejectionReason: "Từ chối hàng loạt trong đợt review",
              updatedAt: Date.now(),
            }
          : p,
      ),
    );
    setSelectedIds(new Set());
  }

  // Edit Handlers
  function handleEditProduct(product: SeoProductUiViewModel) {
    setEditingProduct(product);
    setIsEditModalOpen(true);
  }

  function handleSaveEdit(id: string, updated: SeoProductEditInput) {
    setProducts((prev) =>
      prev.map((p) => {
        if (p.id !== id) return p;

        const updatedImages = p.images.map((img) => {
          const match = updated.imageAlts.find((a) => a.id === img.id);
          if (match && match.alt !== img.alt.value) {
            return {
              ...img,
              alt: { value: match.alt, source: "real" as const },
            };
          }
          return img;
        });

        return {
          ...p,
          productTitle: { value: updated.productTitle, source: "real" },
          productDescription: { value: updated.productDescription, source: "real" },
          seoTitle: { value: updated.seoTitle, source: "real" },
          seoDescription: { value: updated.seoDescription, source: "real" },
          handle: { value: updated.handle, source: "real" },
          images: updatedImages,
          updatedAt: Date.now(),
        };
      }),
    );
  }

  // Export approved JSON
  function handleExportApprovedJson() {
    const approvedProducts = products.filter((p) => p.reviewDecision === "approved");
    if (approvedProducts.length === 0) {
      alert("Chưa có sản phẩm nào được phê duyệt (Approved) để xuất file.");
      return;
    }

    const exportPayload = approvedProducts.map((p) => ({
      productId: p.productId,
      asin: p.asin,
      productTitle: p.productTitle.value,
      productDescription: p.productDescription.value,
      productSeoTitle: p.seoTitle.value,
      productSeoDescription: p.seoDescription.value,
      productHandle: p.handle.value,
      images: p.images.map((img) => ({
        sourceUrl: img.previewUrl.value,
        alt: img.alt.value,
        webp: {
          filename: img.webpFilename.value,
          url: img.webpUrl.value,
        },
      })),
      reviewStatus: p.reviewDecision,
    }));

    const blob = new Blob([JSON.stringify(exportPayload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `seo-approved-products-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function handleClearAll() {
    if (products.length === 0) return;
    if (confirm("Bạn có chắc chắn muốn xóa toàn bộ sản phẩm khỏi danh sách review?")) {
      setProducts([]);
      setSelectedIds(new Set());
      setActiveProduct(null);
      if (typeof window !== "undefined" && window.sessionStorage) {
        window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 text-lg shadow-lg shadow-cyan-500/20">
              📝
            </span>
            <h1 className="text-xl font-bold tracking-tight text-slate-100">
              SEO Content Review
            </h1>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Xem xét, tinh chỉnh và phê duyệt kết quả tối ưu SEO cho sản phẩm trước khi đồng bộ lên Shopify.
          </p>
        </div>

        {/* Quick Stats Badges */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1 md:pb-0">
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-center">
            <div className="text-[10px] text-slate-500 font-semibold uppercase">Tổng số</div>
            <div className="text-sm font-bold text-slate-200 font-mono">{stats.total}</div>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-center">
            <div className="text-[10px] text-emerald-500 font-semibold uppercase">Đã duyệt</div>
            <div className="text-sm font-bold text-emerald-400 font-mono">{stats.approved}</div>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-center">
            <div className="text-[10px] text-amber-500 font-semibold uppercase">Chờ review</div>
            <div className="text-sm font-bold text-amber-400 font-mono">{stats.pending}</div>
          </div>
          <div className="rounded-lg bg-slate-900 border border-slate-800 px-3 py-1.5 text-center">
            <div className="text-[10px] text-rose-500 font-semibold uppercase">Từ chối</div>
            <div className="text-sm font-bold text-rose-400 font-mono">{stats.rejected}</div>
          </div>
        </div>
      </div>

      {/* Handover Success Banner */}
      {handoffBanner ? (
        <div className="flex items-center justify-between rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-4 text-emerald-200 animate-fadeIn">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-base shadow-sm">
              ✓
            </span>
            <div>
              <p className="font-semibold text-emerald-100">
                Bàn giao từ {handoffBanner.source || "Distributed Crawler"} thành công!
              </p>
              <p className="text-xs text-emerald-300/80">
                Đã nạp và tối ưu hóa SEO cho {handoffBanner.count} sản phẩm mới. Dữ liệu đã sẵn sàng để review và phê duyệt.
              </p>
            </div>
          </div>
          <button
            className="rounded-lg bg-emerald-900/50 hover:bg-emerald-800/60 px-3 py-1.5 text-xs font-semibold text-emerald-300 transition-colors"
            type="button"
            onClick={() => setHandoffBanner(null)}
          >
            ✕ Đóng
          </button>
        </div>
      ) : null}

      {/* Batch Actions & Filters Toolbar */}
      <SeoBatchToolbar
        totalCount={products.length}
        filteredCount={filteredProducts.length}
        pendingCount={stats.pending}
        approvedCount={stats.approved}
        rejectedCount={stats.rejected}
        selectedCount={selectedIds.size}
        filter={filter}
        viewMode={viewMode}
        isAllExpanded={isAllExpanded}
        onFilterChange={(newFilter) => setFilter((prev) => ({ ...prev, ...newFilter }))}
        onViewModeChange={setViewMode}
        onToggleExpandAll={handleToggleExpandAllTable}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onApproveSelected={handleApproveSelected}
        onRejectSelected={handleRejectSelected}
        onExportApprovedJson={handleExportApprovedJson}
        onClearAll={handleClearAll}
      />

      {/* Review Content View based on active viewMode */}
      {products.length === 0 ? (
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
      ) : (
        <>
          {viewMode === "cards" && (
            <ProductCardList
              products={filteredProducts}
              selectedIds={selectedIds}
              onToggleSelect={handleToggleSelect}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onZoomImage={handleOpenZoomImage}
            />
          )}

          {viewMode === "table" && (
            <ProductListTable
              products={filteredProducts}
              selectedIds={selectedIds}
              expandedIds={expandedTableIds}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onToggleExpand={handleToggleExpandTable}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onZoomImage={handleOpenZoomImage}
            />
          )}

          {viewMode === "split" && (
            <ProductSplitView
              products={filteredProducts}
              selectedIds={selectedIds}
              activeProduct={activeProduct}
              onSelectActive={setActiveProduct}
              onToggleSelect={handleToggleSelect}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onApproveAndNext={handleApproveAndNext}
              onRejectAndNext={handleRejectAndNext}
              onZoomImage={handleOpenZoomImage}
            />
          )}
        </>
      )}

      {/* Slide-over Detail Drawer (Full inspection modal) */}
      <ProductDetailDrawer
        product={activeProduct}
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        onEdit={handleEditProduct}
        onApprove={(id) => {
          handleApproveProduct(id);
          setIsDrawerOpen(false);
        }}
        onReject={(id) => {
          handleRejectProduct(id);
          setIsDrawerOpen(false);
        }}
        onZoomImage={handleOpenZoomImage}
      />

      {/* Edit Modal */}
      <ProductEditModal
        product={editingProduct}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveEdit}
        onZoomImage={handleOpenZoomImage}
      />

      {/* High-Resolution Image Zoom Lightbox */}
      <ImageZoomModal
        isOpen={zoomState.isOpen}
        images={zoomState.images}
        initialIndex={zoomState.initialIndex}
        onClose={handleCloseZoomImage}
      />
    </div>
  );
}
