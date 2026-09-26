import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { environment } from "../../config/environment";
import type { AmazonCrawlerReviewClient } from "../../modules/amazon-crawler";
import { getModuleApiRunner, type ModuleApiRunner } from "../../modules/module-api";
import {
  pushSeoReviewProductsBatch,
  pushSeoReviewProductToShopify,
  type PushSeoReviewProductResult,
  type SeoReviewPushProductItem,
} from "../../modules/orchestrator";
import type { ApplyApprovedProductUpdatesResult } from "../../modules/orchestrator";
import { notifyUser } from "../../shared/utils";
import { ImageZoomModal } from "./components/ImageZoomModal";
import { ProductCardList } from "./components/ProductCardList";
import { ProductDetailDrawer } from "./components/ProductDetailDrawer";
import { ProductEditModal } from "./components/ProductEditModal";
import { ProductListTable } from "./components/ProductListTable";
import { ProductSplitView } from "./components/ProductSplitView";
import { SeoBatchToolbar } from "./components/SeoBatchToolbar";
import { ShopifySyncErrorModal } from "./components/ShopifySyncErrorModal";
import { filterSeoProducts, findNextProductInList } from "./review-navigation";
import { buildProductRawJson } from "./product-raw-json-helper";
import { adaptAmazonCrawlerReviewToViewModel, getProductSourceOrigin } from "./seo-content-ui-adapter";
import type {
  SeoProductEditInput,
  SeoProductUiViewModel,
  SeoReviewFilterState,
  SeoReviewViewMode,
  StoreProfile,
  ZoomImageItem,
} from "./types";

const SESSION_STORAGE_KEY = "ffp_seo_review_session_v1";
const VIEW_MODE_STORAGE_KEY = "ffp_seo_review_view_mode";
const CLEANUP_STUCK_FAILED_KEY = "ffp_seo_review_cleaned_stuck_failed_v1";

function toPushProductItem(vm: SeoProductUiViewModel): SeoReviewPushProductItem {
  const printMaster = vm.sourcePinterestItem?.printMaster;
  const metafields = printMaster ? [
    {
      namespace: "custom",
      key: "print_file_url",
      value: printMaster.cmykUrl || printMaster.rgbUrl || printMaster.localFilePath || "",
      type: "single_line_text_field",
    },
    {
      namespace: "custom",
      key: "print_specs",
      value: JSON.stringify({
        designId: vm.sourcePinterestItem?.designId,
        productType: vm.sourcePinterestItem?.productType,
        dpi: printMaster.dpi || 300,
        widthPx: printMaster.widthPx,
        heightPx: printMaster.heightPx,
        colorMode: printMaster.colorMode || "CMYK",
        cmykUrl: printMaster.cmykUrl,
        rgbUrl: printMaster.rgbUrl,
        localFilePath: printMaster.localFilePath,
      }),
      type: "json",
    },
  ] : undefined;

  const targetCollectionIds = vm.sourcePinterestItem?.collectionIds
    ?? (vm.coordinatorReview?.target?.collectionIds && vm.coordinatorReview.target.collectionIds.length > 0
        ? vm.coordinatorReview.target.collectionIds
        : undefined);

  const effectiveProductType = vm.sourcePinterestItem?.productType
    || (vm.coordinatorReview?.target?.productType?.trim() ? vm.coordinatorReview.target.productType.trim() : undefined)
    || (vm.sourceCrawlProduct?.productType ? String(vm.sourceCrawlProduct.productType) : undefined);

  const effectiveVendor = vm.sourcePinterestItem?.vendor
    || (vm.storeId ? (vm.storeId.split("--")[0] || vm.storeId).trim().toUpperCase() : undefined);

  const priceAddition = vm.coordinatorReview?.target?.priceAddition
    ?? vm.sourcePinterestItem?.priceAddition
    ?? 0;

  const discountPercent = vm.coordinatorReview?.target?.discountPercent
    ?? vm.sourcePinterestItem?.discountPercent
    ?? 0;

  return {
    id: vm.id,
    productId: vm.productId,
    originalStoreId: vm.storeId,
    asin: vm.asin,
    productTitle: vm.productTitle.value,
    productDescription: vm.productDescription.value,
    seoTitle: vm.seoTitle.value,
    seoDescription: vm.seoDescription.value,
    handle: vm.handle.value,
    images: vm.images.map((img) => ({
      id: img.id,
      previewUrl: img.previewUrl.value,
      alt: img.alt.value,
    })),
    sourceCrawlProduct: vm.sourceCrawlProduct,
    productType: effectiveProductType,
    tags: vm.sourcePinterestItem
      ? ["pod", "pinterest-pod", ...(vm.sourcePinterestItem.trendKeywords || [])]
      : (Array.isArray(vm.sourceCrawlProduct?.tags) ? vm.sourceCrawlProduct.tags.map(String) : undefined),
    vendor: effectiveVendor,
    collectionsToJoin: targetCollectionIds,
    priceAddition,
    discountPercent,
    metafields,
    variants: vm.sourcePinterestItem?.variants,
  };
}

export interface SeoReviewPageProps {
  readonly amazonCrawlerReviews?: AmazonCrawlerReviewClient;
  readonly moduleApiRunner?: ModuleApiRunner;
  readonly storeId?: string;
  readonly onSyncApprovedProducts?: (
    items: readonly SeoProductUiViewModel[],
  ) => Promise<ApplyApprovedProductUpdatesResult>;
  readonly onRollbackApprovedProducts?: (
    items: readonly SeoProductUiViewModel[],
  ) => Promise<ApplyApprovedProductUpdatesResult>;
}

export function SeoReviewPage({
  amazonCrawlerReviews,
  moduleApiRunner: injectedRunner,
  storeId,
  onSyncApprovedProducts,
  onRollbackApprovedProducts,
}: SeoReviewPageProps = {}): React.JSX.Element {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const urlStoreId = searchParams.get("storeId")?.trim().toLowerCase();

  const runner = useMemo(
    () => injectedRunner || getModuleApiRunner(environment),
    [injectedRunner],
  );
  const [products, setProducts] = useState<readonly SeoProductUiViewModel[]>(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const saved = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed) && parsed.length > 0) {
            const hasCleaned = window.sessionStorage.getItem(CLEANUP_STUCK_FAILED_KEY);
            // Filter out any leftover fake sample data and remove stuck failed sync product from previous sessions
            const realOnly = parsed
              .filter(
                (p: { id?: string; shopifySyncStatus?: string }) => {
                  if (!p || typeof p.id !== "string" || p.id.startsWith("sample-prod-")) {
                    return false;
                  }
                  if (!hasCleaned && p.shopifySyncStatus === "failed") {
                    return false;
                  }
                  return true;
                },
              )
              .map((p: SeoProductUiViewModel) => {
                let updated = p;
                if (updated.isSyncing) updated = { ...updated, isSyncing: false };
                if (updated.isReverting) updated = { ...updated, isReverting: false };
                return updated;
              });

            if (!hasCleaned) {
              window.sessionStorage.setItem(CLEANUP_STUCK_FAILED_KEY, "true");
              window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(realOnly));
            }
            return realOnly;
          }
        }
      } catch {
        // Fall back to empty list
      }
    }
    return [];
  });

  useEffect(() => {
    if (!amazonCrawlerReviews) return;
    return amazonCrawlerReviews.subscribe((reviewItems) => {
      const crawlerProducts = reviewItems.map((item) =>
        adaptAmazonCrawlerReviewToViewModel(item, amazonCrawlerReviews.imageUrl),
      );
      setProducts((current) => {
        const currentMap = new Map(current.map((p) => [p.id, p]));
        const mergedCrawlerProducts = crawlerProducts.map((fresh) => {
          const existing = currentMap.get(fresh.id);
          if (!existing) return fresh;

          // Preserve in-flight syncing state so polling does not clear the spinner
          if (existing.isSyncing) {
            return {
              ...fresh,
              isSyncing: true,
              shopifySyncStatus: "syncing" as const,
            };
          }

          // Preserve in-flight reverting state
          if (existing.isReverting) {
            return {
              ...fresh,
              isReverting: true,
            };
          }

          // Preserve failed sync status if server review is still idle / not yet synced
          if (existing.shopifySyncStatus === "failed" && fresh.shopifySyncStatus !== "synced") {
            return {
              ...fresh,
              shopifySyncStatus: "failed" as const,
              shopifySyncError: existing.shopifySyncError || fresh.shopifySyncError,
              syncError: existing.syncError || fresh.syncError,
              isSyncing: false,
            };
          }

          return fresh;
        });

        const legacyProducts = current.filter((product) => !product.coordinatorReview);
        return [...mergedCrawlerProducts, ...legacyProducts];
      });
    });
  }, [amazonCrawlerReviews]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [activeProduct, setActiveProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [errorModalProduct, setErrorModalProduct] = useState<SeoProductUiViewModel | null>(null);
  const setSyncFeedback = useCallback((fb: { type: "success" | "error" | "warning"; message: string } | null) => {
    if (!fb) return;
    notifyUser({
      title: fb.type === "success" ? "✓ Thành công" : fb.type === "warning" ? "⚠️ Cảnh báo" : "✕ Lỗi thao tác",
      message: fb.message,
      type: fb.type,
      sound: fb.type === "error" ? "alert" : "chime",
      url: "/seo-review",
    });
  }, []);
  const [pendingCrawlerSyncIds, setPendingCrawlerSyncIds] = useState<readonly string[]>([]);

  useEffect(() => {
    if (pendingCrawlerSyncIds.length === 0) return;
    const targets = pendingCrawlerSyncIds.map((id) => products.find((product) => product.coordinatorReview?.itemId === id));
    const succeeded = targets.filter((product) => product?.shopifySyncStatus === "synced").length;
    const failed = targets.filter((product) => product?.shopifySyncStatus === "failed").length;
    if (succeeded + failed < pendingCrawlerSyncIds.length) {
      if (failed > 0) {
        setSyncFeedback({ type: "warning", message: `${failed}/${pendingCrawlerSyncIds.length} sản phẩm sync lỗi; các sản phẩm còn lại đang xử lý.` });
      }
      return;
    }
    setPendingCrawlerSyncIds([]);
    setSyncFeedback({
      type: failed === 0 ? "success" : succeeded === 0 ? "error" : "warning",
      message: failed === 0
        ? `✓ Đã sync thành công ${succeeded} sản phẩm lên Shopify.`
        : `Đã sync ${succeeded}/${pendingCrawlerSyncIds.length} sản phẩm; ${failed} sản phẩm lỗi. Xem lỗi trên từng sản phẩm.`,
    });
  }, [pendingCrawlerSyncIds, products]);

  // Shopify Store Selection State (matching Distributed Crawl logic)
  const [availableStores, setAvailableStores] = useState<Array<StoreProfile>>([
    {
      storeId: "chillgen",
      shopDomain: "bbjttb-n9.myshopify.com",
      productTypes: ["Rug", "Doormat", "Area Rug"],
      defaultProductType: "Rug",
    },
    {
      storeId: "capozen",
      shopDomain: "capozen.myshopify.com",
      productTypes: ["Rug", "Doormat", "Area Rug"],
      defaultProductType: "Rug",
    },
    {
      storeId: "jeminise",
      shopDomain: "b6-theme-test.myshopify.com",
      productTypes: ["Blanket", "Bedding Set", "Quilt", "Comforter", "Pillow"],
      defaultProductType: "Blanket",
    },
  ]);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(() => {
    if (urlStoreId) return urlStoreId;
    if (storeId) return storeId.toLowerCase();
    if (typeof window !== "undefined" && window.localStorage) {
      const saved = window.localStorage.getItem("ffp_seo_review_selected_store");
      if (saved) return saved.toLowerCase();
    }
    return "capozen";
  });

  // Sync selectedStoreId whenever urlStoreId query param changes
  useEffect(() => {
    if (urlStoreId && urlStoreId !== selectedStoreId.toLowerCase()) {
      setSelectedStoreId(urlStoreId);
      try {
        window.localStorage.setItem("ffp_seo_review_selected_store", urlStoreId);
      } catch {
        // ignore
      }
    }
  }, [urlStoreId, selectedStoreId]);

  useEffect(() => {
    let isMounted = true;
    async function fetchStores(): Promise<void> {
      try {
        const res = await fetch("/api/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "stores.list", payload: {} }),
        });
        const data = await res.json();
        if (data.success && Array.isArray(data.data?.stores) && isMounted) {
          const fetchedStores: StoreProfile[] = data.data.stores.map((s: Record<string, unknown>) => ({
            storeId: String(s.storeId || ""),
            shopDomain: String(s.shopDomain || ""),
            productTypes: Array.isArray(s.productTypes) ? (s.productTypes as string[]) : undefined,
            defaultProductType: typeof s.defaultProductType === "string" ? s.defaultProductType : undefined,
          })).filter((s: StoreProfile) => Boolean(s.storeId && s.shopDomain));

          if (fetchedStores.length > 0) {
            setAvailableStores((prev) => {
              const map = new Map<string, StoreProfile>();
              for (const s of prev) map.set(s.storeId.toLowerCase(), s);
              for (const s of fetchedStores) {
                const existing = map.get(s.storeId.toLowerCase());
                map.set(s.storeId.toLowerCase(), {
                  storeId: s.storeId,
                  shopDomain: s.shopDomain,
                  productTypes: s.productTypes || existing?.productTypes,
                  defaultProductType: s.defaultProductType || existing?.defaultProductType,
                });
              }
              return Array.from(map.values());
            });
          }
        }
      } catch {
        // Keep default stores if fetch fails
      }
    }
    void fetchStores();
    return () => {
      isMounted = false;
    };
  }, []);

  const effectiveStoreId = useMemo(() => {
    if (urlStoreId) return urlStoreId;
    if (storeId) return storeId.toLowerCase();
    if (selectedStoreId) return selectedStoreId.toLowerCase();
    const firstProductStore = products.find((p) => p.storeId)?.storeId?.toLowerCase();
    if (firstProductStore) return firstProductStore;
    return "capozen";
  }, [urlStoreId, storeId, selectedStoreId, products]);

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

  // Notify approver when new products arrive from other pipelines
  useEffect(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const raw = window.sessionStorage.getItem("ffp_seo_review_handoff_banner");
        if (raw) {
          window.sessionStorage.removeItem("ffp_seo_review_handoff_banner");
          const handoff = JSON.parse(raw) as { count: number; timestamp: number; source?: string; storeId?: string };
          if (handoff && handoff.count > 0) {
            if (handoff.storeId) {
              const targetStore = handoff.storeId.toLowerCase();
              setSelectedStoreId(targetStore);
              try {
                window.localStorage.setItem("ffp_seo_review_selected_store", targetStore);
              } catch {
                // ignore
              }
              if (!urlStoreId || urlStoreId !== targetStore) {
                navigate(`/seo-review?storeId=${encodeURIComponent(targetStore)}`, { replace: true });
              }
            }
            notifyUser({
              title: "📥 Sản phẩm mới cần kiểm duyệt!",
              message: `Hệ thống vừa nhận ${handoff.count} sản phẩm từ ${handoff.source || "hệ thống"}${handoff.storeId ? ` cho store ${handoff.storeId.toUpperCase()}` : ""}. Vui lòng kiểm tra và duyệt nội dung SEO.`,
              type: "info",
              sound: "chime",
              url: handoff.storeId ? `/seo-review?storeId=${encodeURIComponent(handoff.storeId)}` : "/seo-review",
            });
          }
        }
      } catch {
        // ignore
      }
    }
  }, [navigate, urlStoreId]);

  // Persist review state to sessionStorage
  useEffect(() => {
    if (typeof window !== "undefined" && window.sessionStorage) {
      try {
        const legacyProducts = products.filter((product) => !product.coordinatorReview);
        window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(legacyProducts));
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

  // 1. Strictly scope products to the effective target store
  const storeScopedProducts = useMemo(() => {
    return products.filter((p) => {
      const itemStore = (p.storeId || "capozen").trim().toLowerCase();
      return itemStore === effectiveStoreId.toLowerCase();
    });
  }, [products, effectiveStoreId]);

  // 2. Filter products within the scoped store
  const filteredProducts = useMemo(() => {
    return filterSeoProducts(storeScopedProducts, filter);
  }, [storeScopedProducts, filter]);

  // Track other stores that have products awaiting review in memory/session
  const otherStoresWithProducts = useMemo(() => {
    const storeCountMap = new Map<string, number>();
    for (const p of products) {
      const s = (p.storeId || "capozen").trim().toLowerCase();
      storeCountMap.set(s, (storeCountMap.get(s) || 0) + 1);
    }
    return Array.from(storeCountMap.entries())
      .filter(([s]) => s !== effectiveStoreId.toLowerCase())
      .map(([s, count]) => ({
        storeId: s,
        count,
        shopDomain: availableStores.find((as) => as.storeId.toLowerCase() === s)?.shopDomain || s,
      }));
  }, [products, effectiveStoreId, availableStores]);

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

  // Stats calculation scoped strictly to the current active store
  const stats = useMemo(() => {
    const total = storeScopedProducts.length;
    const completed = storeScopedProducts.filter((p) => p.seoStatus.value === "completed").length;
    const pending = storeScopedProducts.filter((p) => p.reviewDecision === "pending").length;
    const approved = storeScopedProducts.filter((p) => p.reviewDecision === "approved").length;
    const approvedUnsynced = storeScopedProducts.filter(
      (p) => p.reviewDecision === "approved" && !p.isSyncing && !p.isReverting && !["queued", "syncing", "synced"].includes(p.shopifySyncStatus || "idle"),
    ).length;
    const rejected = storeScopedProducts.filter((p) => p.reviewDecision === "rejected").length;
    const synced = storeScopedProducts.filter((p) => p.shopifySyncStatus === "synced").length;
    const syncing = storeScopedProducts.filter((p) => p.shopifySyncStatus === "syncing" || p.isSyncing).length;
    const syncFailed = storeScopedProducts.filter((p) => p.shopifySyncStatus === "failed").length;
    const hasMock = storeScopedProducts.filter((p) =>
      p.productTitle.source === "mock" ||
      p.seoTitle.source === "mock" ||
      p.seoDescription.source === "mock" ||
      p.handle.source === "mock",
    ).length;
    const crawlCount = storeScopedProducts.filter((p) => getProductSourceOrigin(p) === "distributed_crawler").length;
    const podCount = storeScopedProducts.filter((p) => getProductSourceOrigin(p) === "pinterest_pod").length;
    const autoSeoCount = storeScopedProducts.filter((p) => getProductSourceOrigin(p) === "auto_seo").length;

    return { total, completed, pending, approved, approvedUnsynced, rejected, synced, syncing, syncFailed, hasMock, crawlCount, podCount, autoSeoCount };
  }, [storeScopedProducts]);

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

  // Push to Shopify Store handlers
  async function triggerPushToShopify(targetProduct: SeoProductUiViewModel) {
    const targetStore = effectiveStoreId;
    try {
      const result = await pushSeoReviewProductToShopify(
        toPushProductItem(targetProduct),
        {
          moduleApiRunner: runner,
          storeId: targetStore,
        },
      );

      if (result.success) {
        if (targetProduct.coordinatorReview && amazonCrawlerReviews) {
          void amazonCrawlerReviews.markSynced(targetProduct.coordinatorReview.itemId, {
            productId: result.productId,
            productHandle: result.productHandle,
            adminUrl: result.adminUrl,
          }).catch(() => {});
        }
        notifyUser({
          title: "🛍️ Shopify Sync thành công!",
          message: `Sản phẩm "${targetProduct.productTitle.value}" đã được đồng bộ lên Store ${targetStore.toUpperCase()}.`,
          type: "success",
          sound: "chime",
          url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
        });
      } else {
        if (targetProduct.coordinatorReview && amazonCrawlerReviews) {
          void amazonCrawlerReviews.markFailed(
            targetProduct.coordinatorReview.itemId,
            result.error || "Lỗi khi đẩy sản phẩm lên Shopify",
          ).catch(() => {});
        }
        notifyUser({
          title: "❌ Shopify Sync thất bại",
          message: result.error || "Lỗi khi đẩy sản phẩm lên Shopify",
          type: "error",
          sound: "alert",
          url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
        });
      }

      setProducts((prev) =>
        prev.map((p) => {
          if (p.id !== targetProduct.id) return p;
          if (result.success) {
            return {
              ...p,
              storeId: targetStore,
              shopifySyncStatus: "synced",
              isSyncing: false,
              productId: result.productId ?? p.productId,
              handle: result.productHandle
                ? { value: result.productHandle, source: "real" }
                : p.handle,
              shopifyAdminUrl: result.adminUrl ?? p.shopifyAdminUrl,
              shopifySyncedAt: Date.now(),
              shopifySyncError: undefined,
              syncError: undefined,
              updatedAt: Date.now(),
            };
          } else {
            return {
              ...p,
              shopifySyncStatus: "failed",
              isSyncing: false,
              shopifySyncError: result.error || "Lỗi khi đẩy sản phẩm lên Shopify",
              syncError: result.error || "Lỗi khi đẩy sản phẩm lên Shopify",
              updatedAt: Date.now(),
            };
          }
        }),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyUser({
        title: "❌ Shopify Sync thất bại",
        message,
        type: "error",
        sound: "alert",
        url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
      });
      setProducts((prev) =>
        prev.map((p) =>
          p.id === targetProduct.id
            ? {
                ...p,
                shopifySyncStatus: "failed",
                isSyncing: false,
                shopifySyncError: message,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
    }
  }

  async function triggerBatchPushToShopify(targets: readonly SeoProductUiViewModel[]) {
    try {
      const pushItems = targets.map(toPushProductItem);
      const results = await pushSeoReviewProductsBatch(
        pushItems,
        {
          moduleApiRunner: runner,
          storeId: effectiveStoreId,
        },
        3,
        (res, completedCount, totalCount) => {
          const matchedTarget = targets.find((t) => t.id === res.id);
          if (res.success) {
            if (matchedTarget?.coordinatorReview && amazonCrawlerReviews) {
              void amazonCrawlerReviews.markSynced(matchedTarget.coordinatorReview.itemId, {
                productId: res.productId,
                productHandle: res.productHandle,
                adminUrl: res.adminUrl,
              }).catch(() => {});
            }
          } else {
            if (matchedTarget?.coordinatorReview && amazonCrawlerReviews) {
              void amazonCrawlerReviews.markFailed(
                matchedTarget.coordinatorReview.itemId,
                res.error || "Lỗi khi đẩy sản phẩm lên Shopify",
              ).catch(() => {});
            }
          }

          setProducts((prev) =>
            prev.map((p) => {
              if (p.id !== res.id) return p;
              if (res.success) {
                return {
                  ...p,
                  storeId: effectiveStoreId,
                  shopifySyncStatus: "synced",
                  isSyncing: false,
                  productId: res.productId ?? p.productId,
                  handle: res.productHandle
                    ? { value: res.productHandle, source: "real" }
                    : p.handle,
                  shopifyAdminUrl: res.adminUrl ?? p.shopifyAdminUrl,
                  shopifySyncedAt: Date.now(),
                  shopifySyncError: undefined,
                  syncError: undefined,
                  updatedAt: Date.now(),
                };
              } else {
                return {
                  ...p,
                  shopifySyncStatus: "failed",
                  isSyncing: false,
                  shopifySyncError: res.error || "Lỗi khi đẩy sản phẩm lên Shopify",
                  syncError: res.error || "Lỗi khi đẩy sản phẩm lên Shopify",
                  updatedAt: Date.now(),
                };
              }
            }),
          );
        },
      );

      const successCount = results.filter((r) => r.success).length;
      const failCount = results.length - successCount;
      if (failCount === 0) {
        notifyUser({
          title: "🛍️ Shopify Sync: Đẩy hàng loạt thành công!",
          message: `Đã đồng bộ toàn bộ ${successCount} sản phẩm lên Shopify Store (${effectiveStoreId.toUpperCase()}).`,
          type: "success",
          sound: "chime",
          url: `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}`,
        });
        setSyncFeedback({
          type: "success",
          message: `✓ Đã đồng bộ thành công toàn bộ ${successCount} sản phẩm lên Store ${effectiveStoreId.toUpperCase()}.`,
        });
      } else if (successCount > 0) {
        notifyUser({
          title: "⚠️ Shopify Sync: Đã đẩy một phần",
          message: `Đã đồng bộ ${successCount}/${results.length} sản phẩm lên Store ${effectiveStoreId.toUpperCase()}. Có ${failCount} sản phẩm gặp lỗi cần retry.`,
          type: "warning",
          sound: "alert",
          url: `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}`,
        });
        setSyncFeedback({
          type: "warning",
          message: `⚠️ Đã đồng bộ ${successCount}/${results.length} sản phẩm lên Store ${effectiveStoreId.toUpperCase()}. Có ${failCount} sản phẩm gặp lỗi.`,
        });
      } else {
        notifyUser({
          title: "❌ Shopify Sync Thất bại",
          message: `Cả ${failCount} sản phẩm đều không thể đồng bộ lên Shopify Store ${effectiveStoreId.toUpperCase()}.`,
          type: "error",
          sound: "alert",
          url: `/seo-review?storeId=${encodeURIComponent(effectiveStoreId)}`,
        });
        setSyncFeedback({
          type: "error",
          message: `❌ Cả ${failCount} sản phẩm đều không thể đồng bộ lên Store ${effectiveStoreId.toUpperCase()}.`,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      notifyUser({
        title: "❌ Shopify Sync gặp lỗi hệ thống",
        message,
        type: "error",
        sound: "alert",
        url: "/seo-review",
      });
      const targetIds = new Set(targets.map((t) => t.id));
      setProducts((prev) =>
        prev.map((p) =>
          targetIds.has(p.id)
            ? {
                ...p,
                shopifySyncStatus: "failed",
                isSyncing: false,
                shopifySyncError: message,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
      setSyncFeedback({
        type: "error",
        message: `✕ Lỗi hệ thống khi đồng bộ: ${message}`,
      });
    }
  }

  // Individual Actions
  function handleViewProduct(product: SeoProductUiViewModel) {
    setActiveProduct(product);
    setIsDrawerOpen(true);
  }

  function handleRetrySync(id: string) {
    const target = products.find((p) => p.id === id);
    if (!target) return;

    const syncingTarget: SeoProductUiViewModel = {
      ...target,
      shopifySyncStatus: "syncing",
      isSyncing: true,
      shopifySyncError: undefined,
      updatedAt: Date.now(),
    };

    setProducts((prev) =>
      prev.map((p) => (p.id === id ? syncingTarget : p)),
    );

    void triggerPushToShopify(syncingTarget);
  }

  function handleViewSyncError(product: SeoProductUiViewModel) {
    setErrorModalProduct(product);
  }

  async function handleApproveProduct(id: string): Promise<void> {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    if (target.isSyncing || target.isReverting) return;
    try {
      let nextVersion = target.coordinatorReview?.version;
      if (target.coordinatorReview && amazonCrawlerReviews) {
        const reviewed = await amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "approved",
        );
        nextVersion = reviewed.version;
      }
      setProducts((prev) => prev.map((product) =>
        product.id === id
          ? {
              ...product,
              reviewDecision: "approved",
              rejectionReason: undefined,
              coordinatorReview: product.coordinatorReview && nextVersion !== undefined
                ? { ...product.coordinatorReview, version: nextVersion }
                : product.coordinatorReview,
              updatedAt: Date.now(),
            }
          : product,
      ));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSyncFeedback({ type: "success", message: `✓ Đã duyệt "${target.productTitle.value}". Sản phẩm đang chờ lệnh Sync.` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể duyệt sản phẩm: ${message}` });
    }
  }

  async function handleRejectProduct(id: string, reason = "Nội dung SEO chưa đạt yêu cầu"): Promise<void> {
    const target = products.find((p) => p.id === id);
    if (!target || target.isSyncing || target.isReverting) return;

    try {
      let nextVersion = target.coordinatorReview?.version;
      if (target.coordinatorReview && amazonCrawlerReviews) {
        const reviewed = await amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "rejected",
          reason,
        );
        nextVersion = reviewed.version;
      }
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                reviewDecision: "rejected",
                rejectionReason: reason,
                coordinatorReview: p.coordinatorReview && nextVersion !== undefined
                  ? { ...p.coordinatorReview, version: nextVersion }
                  : p.coordinatorReview,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
      setSelectedIds((prev) => {
        if (!prev.has(id)) return prev;
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể từ chối sản phẩm: ${message}` });
    }
  }

  function advanceToNextProduct(currentId: string) {
    const next = findNextProductInList(filteredProducts, currentId);
    if (next && next.id !== currentId) {
      setActiveProduct(next);
    } else if (filteredProducts.length <= 1) {
      setActiveProduct(null);
    }
  }

  async function handleApproveAndNext(id: string): Promise<void> {
    advanceToNextProduct(id);
    await handleApproveProduct(id);
  }

  function handleRejectAndNext(id: string) {
    void handleRejectProduct(id);
    advanceToNextProduct(id);
  }

  // Batch Actions
  async function handleApproveSelected(): Promise<void> {
    const targets = products.filter(
      (p) => selectedIds.has(p.id) && !p.isSyncing && !p.isReverting,
    );
    if (targets.length === 0) return;
    try {
      const updatedReviews = await Promise.all(targets.flatMap((target) => {
        if (!target.coordinatorReview || !amazonCrawlerReviews) return [];
        return [amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "approved",
        )];
      }));
      const versions = new Map(updatedReviews.map((review) => [review.id, review.version]));
      const targetIds = new Set(targets.map((target) => target.id));
      setProducts((prev) => prev.map((product) =>
        targetIds.has(product.id)
          ? {
              ...product,
              reviewDecision: "approved",
              rejectionReason: undefined,
              coordinatorReview: product.coordinatorReview && versions.has(product.coordinatorReview.itemId)
                ? { ...product.coordinatorReview, version: versions.get(product.coordinatorReview.itemId) ?? product.coordinatorReview.version }
                : product.coordinatorReview,
              updatedAt: Date.now(),
            }
          : product,
      ));
      setSelectedIds(new Set());
      setSyncFeedback({ type: "success", message: `✓ Đã duyệt ${targets.length} sản phẩm. Chưa có sản phẩm nào được sync.` });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể duyệt hàng loạt: ${message}` });
    }
  }

  async function handleSyncAllApproved(): Promise<void> {
    const eligible = storeScopedProducts.filter((product) =>
      product.reviewDecision === "approved" &&
      !["queued", "syncing", "synced"].includes(product.shopifySyncStatus || "idle") &&
      !product.isSyncing &&
      !product.isReverting,
    );
    if (eligible.length === 0) {
      setSyncFeedback({
        type: "warning",
        message: "Không có sản phẩm nào đã duyệt cần đồng bộ lên Store.",
      });
      return;
    }

    const syncingTargets = eligible.map((p) => ({
      ...p,
      shopifySyncStatus: "syncing" as const,
      isSyncing: true,
      shopifySyncError: undefined,
      updatedAt: Date.now(),
    }));

    const syncingMap = new Map(syncingTargets.map((t) => [t.id, t]));
    setProducts((prev) => prev.map((p) => syncingMap.get(p.id) ?? p));

    try {
      await triggerBatchPushToShopify(syncingTargets);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const eligibleIds = new Set(eligible.map((target) => target.id));
      setProducts((prev) => prev.map((product) =>
        eligibleIds.has(product.id) && product.isSyncing
          ? { ...product, shopifySyncStatus: "failed", isSyncing: false, shopifySyncError: message, syncError: message }
          : product,
      ));
      setSyncFeedback({ type: "error", message: `Không thể sync tất cả sản phẩm đã duyệt: ${message}` });
    }
  }

  async function handleRetryFailedSync(): Promise<void> {
    const failedTargets = storeScopedProducts.filter(
      (product) =>
        product.shopifySyncStatus === "failed" &&
        !product.isSyncing &&
        !product.isReverting,
    );
    if (failedTargets.length === 0) {
      setSyncFeedback({
        type: "warning",
        message: "Không có sản phẩm nào bị lỗi cần thử lại.",
      });
      return;
    }

    const syncingTargets = failedTargets.map((p) => ({
      ...p,
      shopifySyncStatus: "syncing" as const,
      isSyncing: true,
      shopifySyncError: undefined,
      syncError: undefined,
      updatedAt: Date.now(),
    }));

    const syncingMap = new Map(syncingTargets.map((t) => [t.id, t]));
    setProducts((prev) => prev.map((p) => syncingMap.get(p.id) ?? p));

    try {
      await triggerBatchPushToShopify(syncingTargets);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const failedIds = new Set(failedTargets.map((target) => target.id));
      setProducts((prev) =>
        prev.map((product) =>
          failedIds.has(product.id) && product.isSyncing
            ? { ...product, shopifySyncStatus: "failed", isSyncing: false, shopifySyncError: message, syncError: message }
            : product,
        ),
      );
      setSyncFeedback({ type: "error", message: `Không thể thử lại các sản phẩm lỗi: ${message}` });
    }
  }

  async function handleRejectSelected(): Promise<void> {
    const targets = products.filter(
      (p) => selectedIds.has(p.id) && !p.isSyncing && !p.isReverting,
    );
    if (targets.length === 0) return;
    const targetIdSet = new Set(targets.map((t) => t.id));

    const reason = "Từ chối hàng loạt trong đợt review";
    try {
      const updatedReviews = await Promise.all(targets.flatMap((target) => {
        if (!target.coordinatorReview || !amazonCrawlerReviews) return [];
        return [amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "rejected",
          reason,
        )];
      }));
      const versions = new Map(updatedReviews.map((review) => [review.id, review.version]));
      setProducts((prev) =>
        prev.map((p) =>
          targetIdSet.has(p.id)
            ? {
                ...p,
                reviewDecision: "rejected",
                rejectionReason: reason,
                coordinatorReview: p.coordinatorReview && versions.has(p.coordinatorReview.itemId)
                  ? { ...p.coordinatorReview, version: versions.get(p.coordinatorReview.itemId) ?? p.coordinatorReview.version }
                  : p.coordinatorReview,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (!targetIdSet.has(id)) {
            next.add(id);
          }
        }
        return next;
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể từ chối hàng loạt: ${message}` });
    }
  }

  function restoreProductFromBackup(p: SeoProductUiViewModel): SeoProductUiViewModel {
    if (!p.originalBackup) return p;
    const backup = p.originalBackup;
    const fallbackHandle = (backup.handle || backup.productTitle)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

    return {
      ...p,
      productTitle: { value: backup.productTitle, source: "real" },
      productDescription: { value: backup.productDescription, source: "real" },
      handle: { value: backup.handle ?? fallbackHandle, source: "real" },
      seoTitle: {
        value: backup.seoTitle ?? (backup.productTitle.length > 70 ? backup.productTitle.slice(0, 67) + "..." : backup.productTitle),
        source: "real",
      },
      seoDescription: {
        value: backup.seoDescription ?? "",
        source: "real",
      },
      reviewDecision: "pending",
      isReverting: false,
      revertError: undefined,
      syncError: undefined,
      lastSyncedAt: undefined,
      lastRevertedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async function handleRollbackProduct(id: string): Promise<void> {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    if (target.isSyncing || target.isReverting) return;
    if (target.reviewDecision !== "approved" && !target.lastSyncedAt) return;

    if (!target.originalBackup) {
      setSyncFeedback({
        type: "error",
        message: `Không có dữ liệu gốc đã lưu để hoàn tác cho sản phẩm "${target.productTitle.value}".`,
      });
      return;
    }

    if (!onRollbackApprovedProducts) {
      setProducts((prev) =>
        prev.map((p) => (p.id === id ? restoreProductFromBackup(p) : p)),
      );
      setSyncFeedback({
        type: "success",
        message: `✓ Đã hoàn tác dữ liệu gốc cho sản phẩm "${target.originalBackup.productTitle}".`,
      });
      return;
    }

    setProducts((prev) =>
      prev.map((p) =>
        p.id === id ? { ...p, isReverting: true, revertError: undefined } : p,
      ),
    );

    try {
      const result = await onRollbackApprovedProducts([target]);
      const targetId = (target.productId || target.id).trim();
      const itemResult =
        result.items.find(
          (i) =>
            i.productId === targetId ||
            i.productId === target.id ||
            i.productId === target.productId,
        ) ?? result.items[0];

      if (itemResult?.ok) {
        setProducts((prev) =>
          prev.map((p) => (p.id === id ? restoreProductFromBackup(p) : p)),
        );
        setSyncFeedback({
          type: "success",
          message: `✓ Đã hoàn tác dữ liệu gốc của "${target.originalBackup.productTitle}" lên Shopify thành công!`,
        });
      } else {
        const errorMsg = itemResult?.error || "Hoàn tác sản phẩm lên Shopify thất bại.";
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id
              ? {
                  ...p,
                  isReverting: false,
                  revertError: errorMsg,
                  updatedAt: Date.now(),
                }
              : p,
          ),
        );
        setSyncFeedback({
          type: "error",
          message: `✕ Lỗi khi hoàn tác "${target.productTitle.value}" lên Shopify: ${errorMsg}`,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                isReverting: false,
                revertError: errorMsg,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
      setSyncFeedback({
        type: "error",
        message: `✕ Lỗi khi hoàn tác "${target.productTitle.value}" lên Shopify: ${errorMsg}`,
      });
    }
  }

  async function handleRollbackSelected(): Promise<void> {
    const targets = products.filter(
      (p) =>
        selectedIds.has(p.id) &&
        Boolean(p.originalBackup) &&
        (p.reviewDecision === "approved" || Boolean(p.lastSyncedAt)) &&
        !p.isSyncing &&
        !p.isReverting,
    );
    if (targets.length === 0) return;

    if (!onRollbackApprovedProducts) {
      const targetIdSet = new Set(targets.map((t) => t.id));
      setProducts((prev) =>
        prev.map((p) => (targetIdSet.has(p.id) ? restoreProductFromBackup(p) : p)),
      );
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (!targetIdSet.has(id)) {
            next.add(id);
          }
        }
        return next;
      });
      setSyncFeedback({
        type: "success",
        message: `✓ Đã hoàn tác dữ liệu gốc cho ${targets.length} sản phẩm đã chọn.`,
      });
      return;
    }

    const targetIdSet = new Set(targets.map((t) => t.id));

    setProducts((prev) =>
      prev.map((p) =>
        targetIdSet.has(p.id)
          ? { ...p, isReverting: true, revertError: undefined }
          : p,
      ),
    );

    try {
      const result = await onRollbackApprovedProducts(targets);
      const resultMap = new Map<string, { ok: boolean; error?: string }>();
      for (const item of result.items) {
        resultMap.set(item.productId, item);
      }

      let successCount = 0;
      let failCount = 0;
      const successfulIds = new Set<string>();

      for (const target of targets) {
        const pId = (target.productId || target.id).trim();
        const itemRes =
          resultMap.get(pId) ??
          resultMap.get(target.id) ??
          (target.productId ? resultMap.get(target.productId.trim()) : undefined);

        if (itemRes?.ok) {
          successCount++;
          successfulIds.add(target.id);
        } else {
          failCount++;
        }
      }

      setProducts((prev) =>
        prev.map((p) => {
          if (!targetIdSet.has(p.id)) return p;

          const pId = (p.productId || p.id).trim();
          const itemRes =
            resultMap.get(pId) ??
            resultMap.get(p.id) ??
            (p.productId ? resultMap.get(p.productId.trim()) : undefined);

          if (itemRes?.ok) {
            return restoreProductFromBackup(p);
          } else {
            const err = itemRes?.error || "Hoàn tác lên Shopify thất bại.";
            return {
              ...p,
              isReverting: false,
              revertError: err,
              updatedAt: Date.now(),
            };
          }
        }),
      );

      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (!successfulIds.has(id)) {
            next.add(id);
          }
        }
        return next;
      });

      if (failCount === 0) {
        setSyncFeedback({
          type: "success",
          message: `✓ Đã hoàn tác dữ liệu gốc và đồng bộ thành công ${successCount} sản phẩm lên Shopify!`,
        });
      } else if (successCount > 0) {
        setSyncFeedback({
          type: "warning",
          message: `Đã hoàn tác ${successCount}/${targets.length} sản phẩm thành công. ${failCount} sản phẩm gặp lỗi hoàn tác.`,
        });
      } else {
        setSyncFeedback({
          type: "error",
          message: `✕ Hoàn tác thất bại cho cả ${targets.length} sản phẩm đã chọn. Vui lòng kiểm tra lỗi chi tiết trên từng sản phẩm.`,
        });
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setProducts((prev) =>
        prev.map((p) =>
          targetIdSet.has(p.id)
            ? {
                ...p,
                isReverting: false,
                revertError: errorMsg,
                updatedAt: Date.now(),
              }
            : p,
        ),
      );
      setSyncFeedback({
        type: "error",
        message: `✕ Lỗi trong quá trình hoàn tác hàng loạt lên Shopify: ${errorMsg}`,
      });
    }
  }

  // Edit Handlers
  function handleEditProduct(product: SeoProductUiViewModel) {
    if (product.isSyncing || product.isReverting) return;
    setEditingProduct(product);
    setIsEditModalOpen(true);
  }

  async function handleSaveEdit(id: string, updated: SeoProductEditInput, autoApprove = false): Promise<boolean> {
    const target = products.find((product) => product.id === id);
    if (!target) return false;

    const wasAlreadySynced = Boolean(
      target.shopifySyncStatus === "synced" ||
      target.shopifySyncedAt ||
      target.lastSyncedAt ||
      target.shopifyAdminUrl ||
      (target.productId && target.productId.startsWith("gid://shopify/Product/")),
    );

    let nextVersion = target?.coordinatorReview?.version;
    try {
      if (target?.coordinatorReview && amazonCrawlerReviews) {
        const reviewed = await amazonCrawlerReviews.update(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          updated,
        );
        nextVersion = reviewed.version;

        if (autoApprove) {
          const approved = await amazonCrawlerReviews.decide(
            target.coordinatorReview.itemId,
            nextVersion,
            "approved",
          );
          nextVersion = approved.version;
        }
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      const isNetworkOrCors = message.includes("Failed to fetch") || message.includes("NetworkError");
      const friendlyDetail = isNetworkOrCors
        ? "Không thể kết nối hoặc bị chặn bởi Coordinator Server (CORS/Network). Vui lòng đảm bảo Coordinator Server đang chạy và đã được khởi động lại để nhận cấu hình CORS mới."
        : message;
      setSyncFeedback({ type: "error", message: `Không thể lưu chỉnh sửa: ${friendlyDetail}` });
      return false;
    }

    const updatedImages = target.images.map((img) => {
      const match = updated.imageAlts.find((a) => a.id === img.id);
      if (match && match.alt !== img.alt.value) {
        return {
          ...img,
          alt: { value: match.alt, source: "real" as const },
        };
      }
      return img;
    });

    const updatedProductBase: SeoProductUiViewModel = {
      ...target,
      productTitle: { value: updated.productTitle, source: "real" },
      productDescription: { value: updated.productDescription, source: "real" },
      seoTitle: { value: updated.seoTitle, source: "real" },
      seoDescription: { value: updated.seoDescription, source: "real" },
      handle: { value: updated.handle, source: "real" },
      images: updatedImages,
      reviewDecision: autoApprove ? "approved" : "pending",
      rejectionReason: undefined,
      coordinatorReview: target.coordinatorReview && nextVersion !== undefined
        ? { ...target.coordinatorReview, version: nextVersion }
        : target.coordinatorReview,
      updatedAt: Date.now(),
    };

    // If autoApprove is requested AND product was already synced on Shopify (or already has a Shopify GID):
    // Directly push the updated product data to Shopify!
    if (autoApprove && wasAlreadySynced) {
      const targetStore = target.storeId || effectiveStoreId || "capozen";
      setProducts((prev) =>
        prev.map((p) =>
          p.id === id
            ? { ...updatedProductBase, isSyncing: true, shopifySyncStatus: "syncing", shopifySyncError: undefined }
            : p,
        ),
      );

      try {
        const pushResult = await pushSeoReviewProductToShopify(
          toPushProductItem(updatedProductBase),
          {
            moduleApiRunner: runner,
            storeId: targetStore,
          },
        );

        if (pushResult.success) {
          if (target.coordinatorReview && amazonCrawlerReviews) {
            void amazonCrawlerReviews.markSynced(target.coordinatorReview.itemId, {
              productId: pushResult.productId,
              productHandle: pushResult.productHandle,
              adminUrl: pushResult.adminUrl,
            }).catch(() => {});
          }
          const syncedProduct: SeoProductUiViewModel = {
            ...updatedProductBase,
            storeId: targetStore,
            shopifySyncStatus: "synced",
            isSyncing: false,
            productId: pushResult.productId ?? target.productId,
            handle: pushResult.productHandle
              ? { value: pushResult.productHandle, source: "real" }
              : updatedProductBase.handle,
            shopifyAdminUrl: pushResult.adminUrl ?? target.shopifyAdminUrl,
            shopifySyncedAt: Date.now(),
            shopifySyncError: undefined,
            updatedAt: Date.now(),
          };

          setProducts((prev) => prev.map((p) => (p.id === id ? syncedProduct : p)));
          setSelectedIds((prev) => {
            const next = new Set(prev);
            next.delete(id);
            return next;
          });

          setSyncFeedback({
            type: "success",
            message: `✓ Đã cập nhật, phê duyệt và đồng bộ dữ liệu mới của "${updated.productTitle}" lên Shopify (${targetStore.toUpperCase()}) thành công!`,
          });
          notifyUser({
            title: "🛍️ Shopify Sync thành công!",
            message: `Sản phẩm "${updated.productTitle}" đã được cập nhật dữ liệu mới lên Store ${targetStore.toUpperCase()}.`,
            type: "success",
            sound: "chime",
            url: "/seo-review",
          });
          return true;
        } else {
          const errorMsg = pushResult.error || "Lỗi khi đồng bộ dữ liệu mới lên Shopify";
          const failedProduct: SeoProductUiViewModel = {
            ...updatedProductBase,
            shopifySyncStatus: "failed",
            isSyncing: false,
            shopifySyncError: errorMsg,
            updatedAt: Date.now(),
          };
          setProducts((prev) => prev.map((p) => (p.id === id ? failedProduct : p)));
          setSyncFeedback({
            type: "error",
            message: `✕ Đã lưu chỉnh sửa nhưng không thể đồng bộ lên Shopify: ${errorMsg}`,
          });
          return false;
        }
      } catch (pushErr) {
        const errorMsg = pushErr instanceof Error ? pushErr.message : String(pushErr);
        const failedProduct: SeoProductUiViewModel = {
          ...updatedProductBase,
          shopifySyncStatus: "failed",
          isSyncing: false,
          shopifySyncError: errorMsg,
          updatedAt: Date.now(),
        };
        setProducts((prev) => prev.map((p) => (p.id === id ? failedProduct : p)));
        setSyncFeedback({
          type: "error",
          message: `✕ Lỗi khi đồng bộ lên Shopify: ${errorMsg}`,
        });
        return false;
      }
    }

    // Default save case (when not auto-synced):
    // If wasAlreadySynced is true, local content has changed while Shopify has old content.
    // Reset shopifySyncStatus to "idle" so approver sees it needs syncing,
    // and batch/single sync will recognize it!
    const finalProduct: SeoProductUiViewModel = {
      ...updatedProductBase,
      shopifySyncStatus: wasAlreadySynced && !autoApprove ? "idle" : target.shopifySyncStatus || "idle",
      isSyncing: false,
    };

    setProducts((prev) => prev.map((p) => (p.id === id ? finalProduct : p)));

    if (autoApprove) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      setSyncFeedback({
        type: "success",
        message: `✓ Đã cập nhật và phê duyệt "${updated.productTitle}". Sản phẩm sẵn sàng đồng bộ lên Store.`,
      });
    } else {
      if (wasAlreadySynced) {
        setSyncFeedback({
          type: "warning",
          message: `✓ Đã lưu thay đổi cho "${updated.productTitle}". Dữ liệu trên Shopify chưa được cập nhật, vui lòng duyệt và bấm "Sync Shopify" để đẩy nội dung mới lên Store.`,
        });
      } else {
        setSyncFeedback({
          type: "success",
          message: `✓ Đã cập nhật thông tin sản phẩm "${updated.productTitle}".`,
        });
      }
    }

    return true;
  }

  // Export approved JSON
  function handleExportApprovedJson() {
    const approvedProducts = products.filter((p) => p.reviewDecision === "approved");
    if (approvedProducts.length === 0) {
      alert("Chưa có sản phẩm nào được phê duyệt (Approved) để xuất file.");
      return;
    }

    const exportPayload = approvedProducts.map(buildProductRawJson);

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

  const handleDeleteProduct = useCallback((id: string) => {
    const target = products.find((p) => p.id === id);
    if (!target) return;
    setProducts((prev) => {
      const nextProducts = prev.filter((p) => p.id !== id);
      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          const legacy = nextProducts.filter((p) => !p.coordinatorReview);
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(legacy));
        } catch {
          // ignore
        }
      }
      return nextProducts;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    if (activeProduct?.id === id) {
      setActiveProduct(null);
      setIsDrawerOpen(false);
    }
    setSyncFeedback({
      type: "success",
      message: `✓ Đã xóa sản phẩm "${target.productTitle.value}" khỏi danh sách Review.`,
    });
  }, [products, activeProduct, setSyncFeedback]);

  const handleDeleteSelected = useCallback(() => {
    if (selectedIds.size === 0) return;
    const count = selectedIds.size;
    if (!confirm(`Xóa ${count} sản phẩm đã chọn khỏi danh sách SEO Review?`)) return;
    setProducts((prev) => {
      const nextProducts = prev.filter((p) => !selectedIds.has(p.id));
      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          const legacy = nextProducts.filter((p) => !p.coordinatorReview);
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(legacy));
        } catch {
          // ignore
        }
      }
      return nextProducts;
    });
    setSelectedIds(new Set());
    if (activeProduct && selectedIds.has(activeProduct.id)) {
      setActiveProduct(null);
      setIsDrawerOpen(false);
    }
    setSyncFeedback({
      type: "success",
      message: `✓ Đã xóa ${count} sản phẩm đã chọn khỏi danh sách Review.`,
    });
  }, [selectedIds, activeProduct, setSyncFeedback]);

  async function handleClearAll(): Promise<void> {
    if (storeScopedProducts.length === 0) return;
    if (!confirm(`Xóa ${storeScopedProducts.length} sản phẩm của store ${effectiveStoreId.toUpperCase()} khỏi danh sách SEO Review? Sản phẩm đã sync trên Shopify vẫn được giữ nguyên.`)) return;
    try {
      const storeScopedIds = new Set(storeScopedProducts.map((p) => p.id));
      if (storeScopedProducts.length === products.length && amazonCrawlerReviews) {
        try {
          await amazonCrawlerReviews.deleteAll();
        } catch {
          // Coordinator backend best-effort
        }
      }
      setProducts((prev) => {
        const nextProducts = prev.filter((p) => !storeScopedIds.has(p.id));
        if (typeof window !== "undefined" && window.sessionStorage) {
          try {
            const legacy = nextProducts.filter((p) => !p.coordinatorReview);
            window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(legacy));
          } catch {
            // ignore
          }
        }
        return nextProducts;
      });
      setSelectedIds((prev) => {
        const next = new Set<string>();
        for (const id of prev) {
          if (!storeScopedIds.has(id)) next.add(id);
        }
        return next;
      });
      if (activeProduct && storeScopedIds.has(activeProduct.id)) {
        setActiveProduct(null);
        setIsDrawerOpen(false);
      }
      setSyncFeedback({
        type: "success",
        message: `✓ Đã xóa ${storeScopedProducts.length} sản phẩm của store ${effectiveStoreId.toUpperCase()} khỏi danh sách Review.`,
      });
    } catch (error: unknown) {
      setSyncFeedback({ type: "error", message: `Không thể xóa danh sách Review: ${error instanceof Error ? error.message : String(error)}` });
    }
  }

  const canRollbackSelectedCount = useMemo(() => {
    return products.filter(
      (p) =>
        selectedIds.has(p.id) &&
        Boolean(p.originalBackup) &&
        (p.reviewDecision === "approved" || Boolean(p.lastSyncedAt)) &&
        !p.isSyncing &&
        !p.isReverting,
    ).length;
  }, [products, selectedIds]);

  const isRevertingSelected = useMemo(() => {
    return products.some((p) => selectedIds.has(p.id) && p.isReverting);
  }, [products, selectedIds]);

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
          <div className="rounded-lg bg-slate-900 border border-teal-800/60 px-3 py-1.5 text-center">
            <div className="text-[10px] text-teal-400 font-semibold uppercase">Đã đẩy Store</div>
            <div className="text-sm font-bold text-teal-300 font-mono">{stats.synced}</div>
          </div>
          {stats.syncing > 0 && (
            <div className="rounded-lg bg-slate-900 border border-blue-800/60 px-3 py-1.5 text-center animate-pulse">
              <div className="text-[10px] text-blue-400 font-semibold uppercase">Đang đẩy...</div>
              <div className="text-sm font-bold text-blue-300 font-mono">{stats.syncing}</div>
            </div>
          )}
          {stats.syncFailed > 0 && (
            <button
              type="button"
              onClick={() =>
                setFilter((prev) => ({
                  ...prev,
                  decisionFilter: prev.decisionFilter === "sync_failed" ? "all" : "sync_failed",
                }))
              }
              className={`rounded-lg bg-slate-900 border px-3 py-1.5 text-center cursor-pointer transition ${
                filter.decisionFilter === "sync_failed"
                  ? "border-rose-500 bg-rose-950/80 ring-1 ring-rose-500"
                  : "border-rose-800/60 hover:border-rose-600"
              }`}
              title="Bấm để lọc xem danh sách sản phẩm bị lỗi đẩy Store"
            >
              <div className="text-[10px] text-rose-400 font-semibold uppercase">Lỗi đẩy</div>
              <div className="text-sm font-bold text-rose-300 font-mono">{stats.syncFailed}</div>
            </button>
          )}
        </div>
      </div>

      {/* Target Shopify Store Destination Card - LOCKED TO PREVENT MISMATCH */}
      <div className="flex flex-col gap-3 rounded-xl border border-teal-800/40 bg-gradient-to-r from-slate-900/95 via-slate-900/80 to-teal-950/30 p-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 text-sm">
              🏪
            </span>
            <span className="text-sm font-semibold text-slate-200">
              Shopify Store đích:
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 font-mono text-xs font-bold text-teal-300">
              <span>{effectiveStoreId.toUpperCase()}</span>
              <span className="text-[10px] text-slate-400 font-normal">
                ({availableStores.find((s) => s.storeId.toLowerCase() === effectiveStoreId.toLowerCase())?.shopDomain || effectiveStoreId})
              </span>
            </span>
            <span
              className="inline-flex items-center gap-1 rounded bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-300"
              title="Store đích được cố định tự động từ pipeline Crawler / POD để bảo vệ không bị lẫn lộn dữ liệu giữa các store."
            >
              🔒 ĐÃ KHÓA THEO PIPELINE
            </span>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Đang hiển thị & sync cho:</span>
            <span className="font-mono text-cyan-300 font-semibold bg-slate-800/90 px-2.5 py-1 rounded border border-slate-700">
              {storeScopedProducts.length} sản phẩm
            </span>
          </div>
        </div>

        {/* Other stores that have products in review queue */}
        {otherStoresWithProducts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
            <span className="text-slate-500">Các store khác có sản phẩm chờ duyệt:</span>
            {otherStoresWithProducts.map((os) => (
              <button
                key={os.storeId}
                type="button"
                onClick={() => {
                  try {
                    window.localStorage.setItem("ffp_seo_review_selected_store", os.storeId);
                  } catch {
                    // ignore
                  }
                  navigate(`/seo-review?storeId=${encodeURIComponent(os.storeId)}`);
                }}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-700 bg-slate-800/80 px-2.5 py-1 font-mono text-[11px] text-cyan-300 hover:border-cyan-500 hover:bg-slate-700 transition cursor-pointer"
                title={`Chuyển sang xem danh sách review của store ${os.storeId.toUpperCase()}`}
              >
                <span>🏪 {os.storeId.toUpperCase()}</span>
                <span className="rounded bg-cyan-950 px-1.5 py-0.2 text-[10px] text-cyan-400 font-bold border border-cyan-800">
                  {os.count} sp
                </span>
                <span className="text-slate-400">➔</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Batch Actions & Filters Toolbar */}
      <SeoBatchToolbar
        totalCount={storeScopedProducts.length}
        filteredCount={filteredProducts.length}
        crawlCount={stats.crawlCount}
        podCount={stats.podCount}
        autoSeoCount={stats.autoSeoCount}
        pendingCount={stats.pending}
        approvedCount={stats.approved}
        approvedUnsyncedCount={stats.approvedUnsynced}
        rejectedCount={stats.rejected}
        syncFailedCount={stats.syncFailed}
        selectedCount={selectedIds.size}
        canRollbackCount={canRollbackSelectedCount}
        filter={filter}
        viewMode={viewMode}
        isAllExpanded={isAllExpanded}
        isSyncing={storeScopedProducts.some((p) => p.isSyncing)}
        isReverting={isRevertingSelected}
        onFilterChange={(newFilter) => setFilter((prev) => ({ ...prev, ...newFilter }))}
        onViewModeChange={setViewMode}
        onToggleExpandAll={handleToggleExpandAllTable}
        onSelectAll={handleSelectAll}
        onClearSelection={handleClearSelection}
        onApproveSelected={handleApproveSelected}
        onRejectSelected={handleRejectSelected}
        onDeleteSelected={handleDeleteSelected}
        onSyncAllApproved={() => void handleSyncAllApproved()}
        onRetryFailedSync={() => void handleRetryFailedSync()}
        onRollbackSelected={handleRollbackSelected}
        onExportApprovedJson={handleExportApprovedJson}
        onClearAll={handleClearAll}
      />

      {/* Review Content View based on active viewMode */}
      {storeScopedProducts.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800/80 text-2xl text-slate-400 border border-slate-700/50 shadow-inner">
            📝
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-200">
            Chưa có sản phẩm nào cho Store {effectiveStoreId.toUpperCase()}
          </h3>
          <p className="mt-2 text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            {otherStoresWithProducts.length > 0 ? (
              <>
                Store <strong className="text-cyan-400">{effectiveStoreId.toUpperCase()}</strong> hiện chưa có sản phẩm trong danh sách review.
                Bạn có thể bấm vào các store bên trên ({otherStoresWithProducts.map((os) => `${os.storeId.toUpperCase()} (${os.count})`).join(", ")}) để xem sản phẩm của các store đó.
              </>
            ) : (
              <>
                Danh sách đang trống. Bạn hãy sang tab <strong className="text-cyan-400">⚡ Distributed Crawler</strong> hoặc <strong className="text-pink-400">🎨 Pinterest POD Studio</strong> để cào/tạo sản phẩm và bấm nút <strong className="text-emerald-400">"✨ Bàn giao sang SEO"</strong> để tự động đưa sản phẩm vào đây.
              </>
            )}
          </p>
          <div className="mt-5 flex items-center justify-center gap-3">
            <a
              href="/amazon-crawler"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-cyan-600/20 hover:from-cyan-500 hover:to-blue-500 transition"
            >
              <span>⚡ Distributed Crawler</span>
              <span>➔</span>
            </a>
            <a
              href="/pinterest-pod"
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 px-4 py-2.5 text-xs font-semibold text-white shadow-lg shadow-pink-600/20 hover:from-pink-500 hover:to-rose-500 transition"
            >
              <span>🎨 Pinterest POD Studio</span>
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
              currentStoreId={effectiveStoreId}
              onToggleSelect={handleToggleSelect}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onRollbackProduct={handleRollbackProduct}
              onDeleteProduct={handleDeleteProduct}
              onRetrySync={handleRetrySync}
              onViewSyncError={handleViewSyncError}
            />
          )}

          {viewMode === "table" && (
            <ProductListTable
              products={filteredProducts}
              selectedIds={selectedIds}
              expandedIds={expandedTableIds}
              currentStoreId={effectiveStoreId}
              onToggleSelect={handleToggleSelect}
              onToggleSelectAll={handleToggleSelectAll}
              onToggleExpand={handleToggleExpandTable}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onRollbackProduct={handleRollbackProduct}
              onDeleteProduct={handleDeleteProduct}
              onZoomImage={handleOpenZoomImage}
              onRetrySync={handleRetrySync}
              onViewSyncError={handleViewSyncError}
            />
          )}

          {viewMode === "split" && (
            <ProductSplitView
              products={filteredProducts}
              selectedIds={selectedIds}
              activeProduct={activeProduct}
              currentStoreId={effectiveStoreId}
              onSelectActive={setActiveProduct}
              onToggleSelect={handleToggleSelect}
              onViewProduct={handleViewProduct}
              onEditProduct={handleEditProduct}
              onApproveProduct={handleApproveProduct}
              onRejectProduct={handleRejectProduct}
              onRollbackProduct={handleRollbackProduct}
              onDeleteProduct={handleDeleteProduct}
              onApproveAndNext={handleApproveAndNext}
              onRejectAndNext={handleRejectAndNext}
              onZoomImage={handleOpenZoomImage}
              onRetrySync={handleRetrySync}
              onViewSyncError={handleViewSyncError}
            />
          )}
        </>
      )}

      {/* Slide-over Detail Drawer (Full inspection modal) */}
      <ProductDetailDrawer
        product={activeProduct}
        isOpen={isDrawerOpen}
        currentStoreId={effectiveStoreId}
        onClose={() => setIsDrawerOpen(false)}
        onEdit={handleEditProduct}
        onApprove={(id) => {
          void handleApproveProduct(id);
        }}
        onReject={(id) => {
          handleRejectProduct(id);
          setIsDrawerOpen(false);
        }}
        onDelete={handleDeleteProduct}
        onRollback={(id) => {
          void handleRollbackProduct(id);
        }}
        onZoomImage={handleOpenZoomImage}
        onRetrySync={handleRetrySync}
      />

      {/* Edit Modal */}
      <ProductEditModal
        product={editingProduct}
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        onSave={handleSaveEdit}
        onZoomImage={handleOpenZoomImage}
      />

      {/* Shopify Sync Error Details Modal */}
      <ShopifySyncErrorModal
        isOpen={Boolean(errorModalProduct)}
        product={errorModalProduct}
        onClose={() => setErrorModalProduct(null)}
        onRetry={handleRetrySync}
        onDelete={handleDeleteProduct}
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
