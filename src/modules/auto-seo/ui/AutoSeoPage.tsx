import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppError } from "../../../shared/errors/app-error";
import { notifyUser } from "../../../shared/utils";
import { mapShopifyProductToAutoSeoCandidate } from "../shopify-adapter";
import type {
  AutoSeoClient,
  AutoSeoHandoverHandler,
  AutoSeoOutput,
  AutoSeoStoreOption,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
} from "../types";
import {
  setAutoSeoLastHydratedProducts,
  setAutoSeoOutput,
  setAutoSeoProducts,
  setAutoSeoSearchQuery,
  setAutoSeoSelectedProductIds,
  setAutoSeoSelectedStoreId,
  setAutoSeoStatusFilter,
  useAutoSeoSession,
} from "./auto-seo-session";
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
  client: AutoSeoClient;
  initialProducts?: readonly ShopifyProductForAutoSeoUi[];
  initialSelectedProductIds?: readonly string[];
  onHandoverToSeo?: AutoSeoHandoverHandler;
  navigate?: (path: string) => void;
}

export function AutoSeoPage({
  client,
  initialProducts,
  initialSelectedProductIds,
  onHandoverToSeo,
  navigate: customNavigate,
}: AutoSeoPageProps): React.JSX.Element {
  const navigate = customNavigate ?? ((path: string) => {
    if (typeof window !== "undefined") {
      window.location.assign(path);
    }
  });
  const activeClient = client;

  const session = useAutoSeoSession();

  const products = initialProducts ?? session.products;
  const [testSelectedProductIds, setTestSelectedProductIds] = useState<string[] | undefined>(
    initialSelectedProductIds ? [...initialSelectedProductIds] : undefined,
  );
  const selectedProductIds = testSelectedProductIds ?? session.selectedProductIds;

  const searchQuery = session.searchQuery;
  const statusFilter = session.statusFilter;
  const output = session.output;
  const lastHydratedProducts = session.lastHydratedProducts;

  const [availableStores, setAvailableStores] = useState<readonly AutoSeoStoreOption[]>([]);
  const [isLoadingStores, setIsLoadingStores] = useState(false);
  const selectedStoreId = session.selectedStoreId;

  const [isLoadingProducts, setIsLoadingProducts] = useState(false);
  const [isRunningAutoSeo, setIsRunningAutoSeo] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [activeProduct, setActiveProduct] = useState<ShopifyProductForAutoSeoUi | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [detailErrorMessage, setDetailErrorMessage] = useState<string | null>(null);
  const activeDetailIdRef = useRef<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const selectedStoreIdRef = useRef(selectedStoreId);
  selectedStoreIdRef.current = selectedStoreId;
  const [isSendingToSeo, setIsSendingToSeo] = useState(false);

  // Load available stores on mount
  useEffect(() => {
    let isMounted = true;
    async function loadStores(): Promise<void> {
      setIsLoadingStores(true);
      try {
        let storeOptions: readonly AutoSeoStoreOption[] = [];
        if (activeClient.listStores) {
          storeOptions = await activeClient.listStores();
        }
        if (storeOptions.length === 0) {
          const info = await activeClient.getStoreInfo();
          if (info && info.storeId) {
            storeOptions = [{ storeId: info.storeId, shopDomain: info.shopDomain }];
          }
        }

        if (isMounted && storeOptions.length > 0) {
          setAvailableStores(storeOptions);
          const currentStoreId = selectedStoreIdRef.current;
          if (!currentStoreId || !storeOptions.some((s) => s.storeId === currentStoreId)) {
            const firstStoreId = storeOptions[0].storeId;
            setAutoSeoSelectedStoreId(firstStoreId);
            activeClient.setActiveStoreId?.(firstStoreId);
          } else {
            activeClient.setActiveStoreId?.(currentStoreId);
          }
        }
      } catch {
        // Fallback silently if stores cannot be listed
      } finally {
        if (isMounted) {
          setIsLoadingStores(false);
        }
      }
    }

    void loadStores();
    return () => {
      isMounted = false;
    };
  }, [activeClient]);

  const filteredProducts = useMemo(() => {
    return filterAutoSeoProducts(products, {
      searchQuery,
      statusFilter,
    });
  }, [products, searchQuery, statusFilter]);

  const handleSelectStore = useCallback((storeId: string): void => {
    if (storeId === selectedStoreId) {
      return;
    }
    loadRequestIdRef.current++;
    setIsLoadingProducts(false);
    setErrorMessage(null);
    setAutoSeoSelectedStoreId(storeId);
    activeClient.setActiveStoreId?.(storeId);
    activeClient.clearDetailCache?.();
    setAutoSeoProducts([]);
    setAutoSeoSelectedProductIds([]);
    setTestSelectedProductIds(undefined);
    setAutoSeoOutput(null);
    setAutoSeoLastHydratedProducts([]);
  }, [activeClient, selectedStoreId]);

  const handleLoadProducts = useCallback(async (): Promise<void> => {
    const currentRequestId = ++loadRequestIdRef.current;
    const targetStoreId = selectedStoreId;
    setIsLoadingProducts(true);
    setErrorMessage(null);

    try {
      const fetchedProducts = await activeClient.loadProducts(targetStoreId);
      if (currentRequestId === loadRequestIdRef.current) {
        setAutoSeoProducts(fetchedProducts);
        setAutoSeoSelectedProductIds([]);
        setTestSelectedProductIds(undefined);
      }
    } catch (err) {
      if (currentRequestId === loadRequestIdRef.current) {
        setErrorMessage(
          err instanceof Error ? err.message : "Không thể tải danh sách sản phẩm từ Shopify.",
        );
      }
    } finally {
      if (currentRequestId === loadRequestIdRef.current) {
        setIsLoadingProducts(false);
      }
    }
  }, [activeClient, selectedStoreId]);

  // Do NOT automatically load products on mount; user must click "Tải sản phẩm" button.

  // Open & hydrate product detail drawer
  const openProductDetail = useCallback(
    async (product: ShopifyProductForAutoSeoUi): Promise<void> => {
      activeDetailIdRef.current = product.id;

      const cached = activeClient.getCachedDetail?.(product.id, selectedStoreId);
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
        const fullProduct = selectedStoreId
          ? await activeClient.loadProductDetail(selectedStoreId, product.id)
          : await activeClient.loadProductDetail(product.id);
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
    [activeClient, selectedStoreId],
  );

  // Toggle selection
  const handleToggleSelect = (productId: string): void => {
    const next = selectedProductIds.includes(productId)
      ? selectedProductIds.filter((id) => id !== productId)
      : [...selectedProductIds, productId];
    if (testSelectedProductIds !== undefined) {
      setTestSelectedProductIds(next);
    }
    setAutoSeoSelectedProductIds(next);
  };

  // Select all currently visible / filtered products
  const handleSelectAll = useCallback((): void => {
    const next = selectAllVisibleProducts(selectedProductIds, filteredProducts);
    if (testSelectedProductIds !== undefined) {
      setTestSelectedProductIds(next);
    }
    setAutoSeoSelectedProductIds(next);
  }, [filteredProducts, selectedProductIds, testSelectedProductIds]);

  // Clear selection for currently visible / filtered products
  const handleClearSelection = useCallback((): void => {
    const next = clearVisibleProductsSelection(selectedProductIds, filteredProducts);
    if (testSelectedProductIds !== undefined) {
      setTestSelectedProductIds(next);
    }
    setAutoSeoSelectedProductIds(next);
  }, [filteredProducts, selectedProductIds, testSelectedProductIds]);

  // Open detail modal
  const handleOpenDetail = (product: ShopifyProductForAutoSeoUi): void => {
    void openProductDetail(product);
  };

  // Run Auto SEO
  const handleRunAutoSeo = async (): Promise<void> => {
    if (products.length === 0 || selectedProductIds.length === 0) {
      return;
    }

    setIsRunningAutoSeo(true);
    setErrorMessage(null);

    try {
      const hydratedProducts = await activeClient.hydrateSelectedProductsFresh(
        selectedProductIds,
        5,
        selectedStoreId,
      );

      const workflowId = `auto_seo_${Date.now()}`;

      const storeInfo = await activeClient.getStoreInfo(selectedStoreId);
      if (!storeInfo) {
        throw new AppError("Không thể xác định thông tin cửa hàng Shopify.", "AUTO_SEO_STORE_INFO_UNAVAILABLE");
      }

      const backupResult = await activeClient.runAutoSeoBackup({
        workflowId,
        storeId: storeInfo.storeId,
        shopDomain: storeInfo.shopDomain,
        products: hydratedProducts,
      });

      if (backupResult.downstreamStatus !== "SENT") {
        throw new AppError(
          `Auto SEO backup succeeded, but downstream handoff failed: ${backupResult.downstreamError || "Unknown downstream error"}`,
          "AUTO_SEO_DOWNSTREAM_FAILED",
        );
      }

      const autoSeoProducts = hydratedProducts.map(mapShopifyProductToAutoSeoCandidate);
      const result = await activeClient.runAutoSeo({
        workflowId,
        products: autoSeoProducts,
        selectedProductIds,
      });

      const effectiveStoreId = selectedStoreId || storeInfo.storeId;
      const productsWithStore = hydratedProducts.map((p) => ({
        ...p,
        storeId: p.storeId || effectiveStoreId,
      }));

      setAutoSeoOutput(result);
      setAutoSeoLastHydratedProducts(productsWithStore);

      if (effectiveStoreId) {
        try {
          window.localStorage.setItem("ffp_seo_review_selected_store", effectiveStoreId);
        } catch {
          // ignore
        }
      }

      notifyUser({
        title: "✨ Auto SEO: Tối ưu hóa hoàn tất!",
        message: `Đã tạo nội dung Auto SEO thành công cho ${result.selectedCount} sản phẩm. Đã sẵn sàng kiểm duyệt tại SEO Review.`,
        type: "success",
        sound: "chime",
        url: effectiveStoreId ? `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}` : "/seo-review",
      });

      if (onHandoverToSeo) {
        await onHandoverToSeo(productsWithStore, effectiveStoreId);
        navigate(effectiveStoreId ? `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}` : "/seo-review");
      }
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Đã xảy ra lỗi khi chạy Auto SEO.";
      setErrorMessage(errText);
      notifyUser({
        title: "❌ Auto SEO thất bại",
        message: errText,
        type: "error",
        sound: "alert",
        url: "/auto-seo",
      });
    } finally {
      setIsRunningAutoSeo(false);
    }
  };

  const handleSendToSeo = async (): Promise<void> => {
    if (!onHandoverToSeo || lastHydratedProducts.length === 0) {
      return;
    }

    setIsSendingToSeo(true);
    setErrorMessage(null);

    try {
      let effectiveStoreId = selectedStoreId || lastHydratedProducts.find((product) => product.storeId)?.storeId;
      if (!effectiveStoreId) {
        try {
          const storeInfo = await activeClient.getStoreInfo();
          effectiveStoreId = storeInfo?.storeId;
        } catch {
          // The handover can still continue when the store is already present on each product.
        }
      }
      const productsWithStore = lastHydratedProducts.map((product) => ({
        ...product,
        storeId: product.storeId || effectiveStoreId,
      }));
      await onHandoverToSeo(productsWithStore, effectiveStoreId);
      if (effectiveStoreId) {
        try {
          window.localStorage.setItem("ffp_seo_review_selected_store", effectiveStoreId);
        } catch {
          // ignore
        }
      }
      notifyUser({
        title: "📦 Auto SEO: Bàn giao SEO thành công!",
        message: `Đã bàn giao ${lastHydratedProducts.length} sản phẩm sang SEO Review.`,
        type: "success",
        sound: "chime",
        url: effectiveStoreId ? `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}` : "/seo-review",
      });
      navigate(effectiveStoreId ? `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}` : "/seo-review");
    } catch (err) {
      const errText = err instanceof Error ? err.message : "Đã xảy ra lỗi khi bàn giao sang SEO Content.";
      setErrorMessage(errText);
      notifyUser({
        title: "❌ Bàn giao SEO thất bại",
        message: errText,
        type: "error",
        sound: "alert",
        url: "/auto-seo",
      });
    } finally {
      setIsSendingToSeo(false);
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
        stores={availableStores}
        selectedStoreId={selectedStoreId}
        onSelectStore={handleSelectStore}
        isLoadingStores={isLoadingStores}
      />

      {/* Product Selection Table */}
      <ProductSelectionTable
        products={products}
        selectedProductIds={selectedProductIds}
        searchQuery={searchQuery}
        onSearchQueryChange={setAutoSeoSearchQuery}
        statusFilter={statusFilter}
        onStatusFilterChange={setAutoSeoStatusFilter}
        filteredProducts={filteredProducts}
        onToggleSelect={handleToggleSelect}
        onOpenDetail={handleOpenDetail}
        isLoading={isLoadingProducts}
      />

      {/* PDP Detail Drawer */}
      <ProductDetailDrawer
        product={activeProduct}
        isOpen={isDetailOpen}
        isLoading={isDetailLoading}
        errorMessage={detailErrorMessage}
        onClose={() => {
          activeDetailIdRef.current = null;
          setIsDetailOpen(false);
          setIsDetailLoading(false);
          setDetailErrorMessage(null);
        }}
      />

      {/* Output Panel: Prepared SEO Content Inputs */}
      <AutoSeoOutputPanel
        output={output}
        onClearOutput={() => setAutoSeoOutput(null)}
        onSendToSeoContent={onHandoverToSeo && lastHydratedProducts.length > 0 ? () => void handleSendToSeo() : undefined}
        isSendingToSeo={isSendingToSeo}
      />
    </div>
  );
}
