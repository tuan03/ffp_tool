import { useEffect, useMemo, useState } from "react";
import { ProductDetailDrawer } from "./components/ProductDetailDrawer";
import { ProductEditModal } from "./components/ProductEditModal";
import { ProductListTable } from "./components/ProductListTable";
import { SeoBatchToolbar } from "./components/SeoBatchToolbar";
import { getInitialSampleViewModels } from "./seo-content-ui-adapter";
import type {
  SeoProductEditInput,
  SeoProductUiViewModel,
  SeoReviewFilterState,
} from "./types";

const SESSION_STORAGE_KEY = "ffp_seo_review_session_v1";

export function SeoReviewPage(): React.JSX.Element {
  const [products, setProducts] = useState<readonly SeoProductUiViewModel[]>(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // Fall back to default samples
      }
    }
    return getInitialSampleViewModels();
  });

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeProduct, setActiveProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);

  const [filter, setFilter] = useState<SeoReviewFilterState>({
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
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

  // Keep activeProduct in sync if products are updated
  useEffect(() => {
    if (activeProduct) {
      const updated = products.find((p) => p.id === activeProduct.id);
      if (updated) {
        setActiveProduct(updated);
      }
    }
  }, [products, activeProduct]);

  // Filtered products list
  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      // 1. Search query
      if (filter.searchQuery.trim()) {
        const query = filter.searchQuery.toLowerCase().trim();
        const titleMatch = p.productTitle.value.toLowerCase().includes(query);
        const handleMatch = p.handle.value.toLowerCase().includes(query);
        const asinMatch = p.asin ? p.asin.toLowerCase().includes(query) : false;
        if (!titleMatch && !handleMatch && !asinMatch) {
          return false;
        }
      }

      // 2. SEO Status filter
      if (filter.statusFilter !== "all" && p.seoStatus.value !== filter.statusFilter) {
        return false;
      }

      // 3. Review Decision filter
      if (filter.decisionFilter !== "all" && p.reviewDecision !== filter.decisionFilter) {
        return false;
      }

      // 4. Only Mock data filter
      if (filter.onlyMockData) {
        const hasMock =
          p.productTitle.source === "mock" ||
          p.productDescription.source === "mock" ||
          p.seoTitle.source === "mock" ||
          p.seoDescription.source === "mock" ||
          p.handle.source === "mock" ||
          p.images.some((img) => img.alt.source === "mock" || img.webpUrl.source === "mock");
        if (!hasMock) {
          return false;
        }
      }

      return true;
    });
  }, [products, filter]);

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

  function handleResetToSamples() {
    if (confirm("Khôi phục danh sách sản phẩm mẫu mặc định?")) {
      const samples = getInitialSampleViewModels();
      setProducts(samples);
      setSelectedIds(new Set());
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

      {/* Batch Actions & Filters Toolbar */}
      <SeoBatchToolbar
        totalCount={products.length}
        selectedCount={selectedIds.size}
        filter={filter}
        onFilterChange={(newFilter) => setFilter((prev) => ({ ...prev, ...newFilter }))}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onApproveSelected={handleApproveSelected}
        onRejectSelected={handleRejectSelected}
        onExportApprovedJson={handleExportApprovedJson}
        onResetToSamples={handleResetToSamples}
      />

      {/* Product List Table */}
      <ProductListTable
        products={filteredProducts}
        selectedIds={selectedIds}
        onToggleSelect={handleToggleSelect}
        onToggleSelectAll={handleToggleSelectAll}
        onViewProduct={handleViewProduct}
        onApproveProduct={handleApproveProduct}
        onRejectProduct={handleRejectProduct}
      />

      {/* Slide-over Detail Drawer */}
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
      />

      {/* Edit Modal */}
      <ProductEditModal
        product={editingProduct}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveEdit}
      />
    </div>
  );
}
