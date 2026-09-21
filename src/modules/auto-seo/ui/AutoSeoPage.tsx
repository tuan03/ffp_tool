import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { environment } from "../../../config/environment";
import { getAutoSeoClient } from "../runtime";
import { hydrateSelectedProducts } from "../service";
import { mapShopifyProductToAutoSeoCandidate } from "../shopify-adapter";
import type {
  AutoSeoClient,
  AutoSeoOutput,
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../types";
import { AutoSeoOutputPanel } from "./components/AutoSeoOutputPanel";
import { AutoSeoToolbar } from "./components/AutoSeoToolbar";
import {
  clearVisibleProductsSelection,
  filterAutoSeoProducts,
  selectAllVisibleProducts,
} from "./components/product-filter";
import { ProductDetailDrawer } from "./components/ProductDetailDrawer";
import { ProductSelectionTable } from "./components/ProductSelectionTable";

export interface AutoSeoPageProps {
  client?: AutoSeoClient;
  initialProducts?: readonly ShopifyProductForAutoSeoUi[];
  initialSelectedProductIds?: readonly string[];
}

export function AutoSeoPage({
  client,
  initialProducts,
  initialSelectedProductIds,
}: AutoSeoPageProps): React.JSX.Element {
  const activeClient = useMemo(() => client ?? getAutoSeoClient(environment), [client, environment]);

  const [products, setProducts] = useState<readonly ShopifyProductForAutoSeoUi[]>(
    () => initialProducts ?? [],
  );
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>(() => {
    if (initialSelectedProductIds !== undefined) {
      return [...initialSelectedProductIds];
    }
    if (initialProducts && initialProducts.length > 0) {
      const activeIds = initialProducts
        .filter((p) => p.status?.toUpperCase() === "ACTIVE")
        .map((p) => p.id);
      return activeIds.length > 0 ? activeIds : initialProducts.map((p) => p.id);
    }
    return [];
  });
  const [decisions, setDecisions] = useState<Record<string, ProductReviewDecision>>({});

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<ShopifyStatusFilter>("all");
  const [decisionFilter, setDecisionFilter] = useState<string>("all");

  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isRunningAutoSeo, setIsRunningAutoSeo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeProduct, setActiveProduct] = useState<ShopifyProductForAutoSeoUi | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const activeDetailIdRef = useRef<string | null>(null);

  const [output, setOutput] = useState<AutoSeoOutput | null>(null);

  const filteredProducts = useMemo(() => {
    return filterAutoSeoProducts(products, {
      searchQuery,
      statusFilter,
      decisionFilter,
      decisions,
      selectedProductIds,
    });
  }, [products, searchQuery, statusFilter, decisionFilter, decisions, selectedProductIds]);

  const handleLoadProducts = useCallback(async (): Promise<void> => {
    setIsLoadingProducts(true);
    setErrorMessage(null);

    try {
      const fetchedProducts = await activeClient.loadProducts();
      setProducts(fetchedProducts);

      // Pre-select active products by default if none selected
      if (fetchedProducts.length > 0) {
        const activeIds = fetchedProducts
          .filter((p) => p.status?.toUpperCase() === "ACTIVE")
          .map((p) => p.id);
        setSelectedProductIds(activeIds.length > 0 ? activeIds : fetchedProducts.map((p) => p.id));
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Không thể tải danh sách sản phẩm từ Shopify.",
      );
    } finally {
      setIsLoadingProducts(false);
    }
  }, [activeClient]);

  // Load products on initial mount
  useEffect(() => {
    if (!initialProducts) {
      void handleLoadProducts();
    }
  }, [handleLoadProducts, initialProducts]);

  // Open & hydrate product detail drawer
  const openProductDetail = useCallback(
    async (product: ShopifyProductForAutoSeoUi): Promise<void> => {
      activeDetailIdRef.current = product.id;

      const cached = activeClient.getCachedDetail?.(product.id);
      if (cached) {
        setActiveProduct(cached);
        setIsDetailOpen(true);
        setIsDetailLoading(false);
        setDetailErrorMessage(null);
        return;
      }

      setActiveProduct(product);
      setIsDetailOpen(true);
      setIsDetailLoading(true);
      setDetailErrorMessage(null);

      try {
        const fullProduct = await activeClient.loadProductDetail(product.id);
        if (activeDetailIdRef.current === product.id) {
          setActiveProduct(fullProduct);
        }
      } catch (err) {
        if (activeDetailIdRef.current === product.id) {
          setDetailErrorMessage(
            err instanceof Error ? err.message : "Không thể tải chi tiết sản phẩm từ Shopify.",
          );
        }
      } finally {
        if (activeDetailIdRef.current === product.id) {
          setIsDetailLoading(false);
        }
      }
    },
    [activeClient],
  );

  // Approve product
  const handleApprove = (productId: string): void => {
    setDecisions((curr) => ({
      ...curr,
      [productId]: "approved",
    }));

    setSelectedProductIds((curr) =>
      curr.includes(productId) ? curr : [...curr, productId],
    );
  };

  // Edit product
  const handleEdit = (product: ShopifyProductForAutoSeoUi): void => {
    setDecisions((curr) => ({
      ...curr,
      [product.id]: "needs_edit",
    }));
    void openProductDetail(product);
  };

  // Mark as draft
  const handleMarkDraft = (productId: string): void => {
    setDecisions((curr) => ({
      ...curr,
      [productId]: "mark_draft",
    }));

    setSelectedProductIds((curr) => curr.filter((id) => id !== productId));
  };

  // Skip product
  const handleSkip = (productId: string): void => {
    setDecisions((curr) => ({
      ...curr,
      [productId]: "skipped",
    }));

    setSelectedProductIds((curr) => curr.filter((id) => id !== productId));
  };

  // Toggle selection
  const handleToggleSelect = (productId: string): void => {
    setSelectedProductIds((curr) =>
      curr.includes(productId) ? curr.filter((id) => id !== productId) : [...curr, productId],
    );
  };

  // Select all currently visible / filtered products
  const handleSelectAll = useCallback((): void => {
    setSelectedProductIds((current) => selectAllVisibleProducts(current, filteredProducts));
  }, [filteredProducts]);

  // Clear selection for currently visible / filtered products
  const handleClearSelection = useCallback((): void => {
    setSelectedProductIds((current) => clearVisibleProductsSelection(current, filteredProducts));
  }, [filteredProducts]);

  // Open detail modal
  const handleOpenDetail = (product: ShopifyProductForAutoSeoUi): void => {
    void openProductDetail(product);
  };

  // Run Auto SEO
  const handleRunAutoSeo = async (): Promise<void> => {
    if (products.length === 0) {
      setErrorMessage("Chưa có sản phẩm nào được tải để xử lý.");
      return;
    }

    let targetSelectedIds = selectedProductIds;

    // If no products selected, prompt user
    if (targetSelectedIds.length === 0) {
      const confirmAll = window.confirm(
        "Bạn chưa chọn sản phẩm nào. Bạn có muốn chạy Auto SEO cho TẤT CẢ sản phẩm không?",
      );
      if (!confirmAll) {
        return;
      }
      targetSelectedIds = products.map((p) => p.id);
      setSelectedProductIds(targetSelectedIds);
    }

    setIsRunningAutoSeo(true);
    setErrorMessage(null);

    try {
      // TASK 5 & 6: Hydrate full product details for all selected products before running Auto SEO
      const hydratedProducts = activeClient.hydrateSelectedProducts
        ? await activeClient.hydrateSelectedProducts(targetSelectedIds, 5)
        : await hydrateSelectedProducts(activeClient, targetSelectedIds, 5);

      const autoSeoProducts = hydratedProducts.map(mapShopifyProductToAutoSeoCandidate);
      const result = await activeClient.runAutoSeo({
        workflowId: `auto_seo_${Date.now()}`,
        products: autoSeoProducts,
        selectedProductIds: targetSelectedIds,
      });

      setOutput(result);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "Đã xảy ra lỗi khi chạy Auto SEO.",
      );
    } finally {
      setIsRunningAutoSeo(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-100 flex items-center gap-2">
            <span>✨</span> Auto SEO Product Selection & Payload Pipeline
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Chọn lọc sản phẩm từ Shopify Store, kiểm tra chất lượng dữ liệu và chuẩn bị payload cho SEO Content Generator.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="rounded-md bg-slate-800/80 px-2.5 py-1 text-xs font-mono text-slate-400 border border-slate-700">
            phase: UI Selection & Mapping
          </span>
        </div>
      </div>

      {/* Global Error Banner */}
      {errorMessage && (
        <div className="rounded-xl border border-rose-800/80 bg-rose-950/40 p-4 text-xs text-rose-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-base">⚠️</span>
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-rose-400 hover:text-white"
          >
            ✕
          </button>
        </div>
      )}

      {/* Toolbar: Actions & Batch Controls */}
      <AutoSeoToolbar
        isLoadingProducts={isLoadingProducts}
        isRunningAutoSeo={isRunningAutoSeo}
        totalProductsCount={products.length}
        selectedCount={selectedProductIds.length}
        visibleProductsCount={filteredProducts.length}
        onLoadProducts={() => void handleLoadProducts()}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onRunAutoSeo={() => void handleRunAutoSeo()}
      />

      {/* Product Selection Table */}
      <ProductSelectionTable
        products={products}
        selectedProductIds={selectedProductIds}
        decisions={decisions}
        searchQuery={searchQuery}
        onSearchQueryChange={setSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        decisionFilter={decisionFilter}
        onDecisionFilterChange={setDecisionFilter}
        filteredProducts={filteredProducts}
        onToggleSelect={handleToggleSelect}
        onApprove={handleApprove}
        onEdit={handleEdit}
        onMarkDraft={handleMarkDraft}
        onSkip={handleSkip}
        onOpenDetail={handleOpenDetail}
      />

      {/* PDP Detail Drawer */}
      <ProductDetailDrawer
        product={activeProduct}
        isOpen={isDetailOpen}
        decision={activeProduct ? decisions[activeProduct.id] : undefined}
        isLoading={isDetailLoading}
        errorMessage={detailErrorMessage}
        onClose={() => {
          activeDetailIdRef.current = null;
          setIsDetailOpen(false);
          setIsDetailLoading(false);
          setDetailErrorMessage(null);
        }}
        onApprove={(id) => {
          handleApprove(id);
          setIsDetailOpen(false);
        }}
        onMarkNeedsEdit={(id) => {
          setDecisions((c) => ({ ...c, [id]: "needs_edit" }));
          setIsDetailOpen(false);
        }}
        onMarkDraft={(id) => {
          handleMarkDraft(id);
          setIsDetailOpen(false);
        }}
        onSkip={(id) => {
          handleSkip(id);
          setIsDetailOpen(false);
        }}
      />

      {/* Output Panel: Prepared SEO Content Inputs */}
      <AutoSeoOutputPanel
        output={output}
        onClearOutput={() => setOutput(null)}
      />
    </div>
  );
}
