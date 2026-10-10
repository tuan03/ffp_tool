import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { environment } from "../../config/environment";
import { getCustomGptClient } from "../../modules/custom-gpt-seo";
import { adaptCustomGptReview, loadAllCustomGptReviewRecords } from "./custom-gpt-review";
import { loadAutoSeoReview, saveAutoSeoReviewSyncOutcome, updateAutoSeoReviewPayload, updateAutoSeoReviewStatus } from "./auto-seo-review-client";
import { adaptReviewListItem } from "./review-catalog";
import { useReviewCatalog } from "./use-review-catalog";
import type { AmazonCrawlerReviewClient } from "../../modules/amazon-crawler";
import { getModuleApiRunner, type ModuleApiRunner } from "../../modules/module-api";
import {
  pushSeoReviewProductsBatch,
  pushSeoReviewProductToShopify,
  type PushSeoReviewProductResult,
  type SeoReviewPushProductItem,
} from "../../modules/orchestrator";
import type { ApplyApprovedProductUpdatesResult } from "../../modules/orchestrator";
import { persistBrowserActiveStoreId, readActiveStoreId } from "../../shared/active-store";
import { notifyUser } from "../../shared/utils";
import { ImageZoomModal } from "./components/ImageZoomModal";
import { ProductCardList } from "./components/ProductCardList";
import { ProductDetailDrawer } from "./components/ProductDetailDrawer";
import { ProductEditModal } from "./components/ProductEditModal";
import { ProductListTable } from "./components/ProductListTable";
import { ProductSplitView } from "./components/ProductSplitView";
import { RequeueModal } from "./components/RequeueModal";
import { SeoBatchToolbar } from "./components/SeoBatchToolbar";
import { ShopifySyncErrorModal } from "./components/ShopifySyncErrorModal";
import { VersionConflictModal } from "./components/VersionConflictModal";
import { archiveSeoReviewProduct } from "./archive-review-product";
import { canStartReviewSync, isReviewSynced, reviewActions, reviewStage } from "./review-actions";
import { prepareReviewSync } from "./prepare-review-sync";
import { emptySeoReviewCounts } from "../../shared/seo-review-list";
import type { SeoReviewWorkspace } from "../../shared/seo-review-list";
import { filterSeoProducts, findNextProductInList } from "./review-navigation";
import { buildProductRawJson } from "./product-raw-json-helper";
import {
  adaptAmazonCrawlerReviewToViewModel,
  adaptPersistedSeoReviewItemToViewModel,
  getProductSourceOrigin,
} from "./seo-content-ui-adapter";
import { mergeCrawlerReviewPollingState } from "./review-polling-state";
import type { PersistedSeoReviewItem } from "./seo-content-ui-adapter";
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

function isDurableAutoSeoReview(product: SeoProductUiViewModel): boolean {
  return product.sourceOrigin === "auto_seo" && !product.gptJobId;
}

function toPushProductItem(vm: SeoProductUiViewModel): SeoReviewPushProductItem {
  if (vm.reviewListItem) throw new Error("Review details must be loaded before sync");
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

  // Vendor is not an SEO field. Only forward a value supplied by a product
  // source; deriving it from storeId can overwrite an existing Shopify vendor.
  const effectiveVendor = vm.sourcePinterestItem?.vendor?.trim() || undefined;

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
    aeo: vm.aeoQuickSummary && vm.aeoFaq && vm.aeoJsonLd
      ? {
          quickSummary: vm.aeoQuickSummary.value,
          faq: vm.aeoFaq.value,
          jsonLd: vm.aeoJsonLd.value,
        }
      : undefined,
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
    sourceShopifyUpdatedAt: vm.sourceShopifyUpdatedAt,
    currentSeoVersion: vm.seoVersion,
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
                  if (environment !== "mock" && (p as SeoProductUiViewModel).sourceOrigin === "auto_seo") return false;
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
    if (!amazonCrawlerReviews || (environment !== "mock" && amazonCrawlerReviews.catalog)) return;
    return amazonCrawlerReviews.subscribe((reviewItems) => {
      const crawlerProducts = reviewItems.map((item) =>
        adaptAmazonCrawlerReviewToViewModel(item, amazonCrawlerReviews.imageUrl),
      );
      setProducts((current) => {
        const currentMap = new Map(current.map((p) => [p.id, p]));
        const mergedCrawlerProducts = crawlerProducts.map((fresh) =>
          mergeCrawlerReviewPollingState(currentMap.get(fresh.id), fresh),
        );

        const legacyProducts = current.filter((product) => !product.coordinatorReview);
        return [...mergedCrawlerProducts, ...legacyProducts];
      });
    });
  }, [amazonCrawlerReviews]);

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const [requeueTargetIds, setRequeueTargetIds] = useState<readonly string[] | null>(null);
  const [activeProduct, setActiveProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<SeoProductUiViewModel | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [errorModalProduct, setErrorModalProduct] = useState<SeoProductUiViewModel | null>(null);
  const [conflictModalProduct, setConflictModalProduct] = useState<SeoProductUiViewModel | null>(null);
  const setSyncFeedback = useCallback((fb: { type: "success" | "error" | "warning"; message: string } | null) => {
    if (!fb) return;
    if (fb.type === "success" && typeof window !== "undefined") window.dispatchEvent(new Event("ffp-review-changed"));
    notifyUser({
      title: fb.type === "success" ? "✓ Thành công" : fb.type === "warning" ? "⚠️ Cảnh báo" : "✕ Lỗi thao tác",
      message: fb.message,
      type: fb.type,
      sound: fb.type === "error" ? "alert" : "chime",
      url: "/seo-review",
    });
  }, []);
  const [pendingCrawlerSyncIds, setPendingCrawlerSyncIds] = useState<readonly string[]>([]);
  const [isApprovingAll, setIsApprovingAll] = useState(false);

  useEffect(() => {
    if (pendingCrawlerSyncIds.length === 0) return;
    const targets = pendingCrawlerSyncIds.map((id) => products.find((product) => product.id === id || product.coordinatorReview?.itemId === id));
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
      const saved = readActiveStoreId(window.localStorage);
      if (saved) return saved.toLowerCase();
    }
    return "capozen";
  });

  useEffect(() => {
    if (environment !== "mock") return;
    let isCancelled = false;

    async function loadPersistedAutoSeoReviews(): Promise<void> {
      const response = await fetch(
        `/api/seo-review/items?storeId=${encodeURIComponent(selectedStoreId)}&limit=100`,
      );
      if (!response.ok) {
        throw new Error(`SEO Review API returned HTTP ${response.status}`);
      }

      const body: unknown = await response.json();
      if (!body || typeof body !== "object") {
        throw new Error("SEO Review API returned an invalid response");
      }

      const rawItems = (body as { items?: unknown }).items;
      if (!Array.isArray(rawItems) || isCancelled) {
        return;
      }

      const persistedProducts = rawItems
        .filter((item): item is PersistedSeoReviewItem => {
          if (!item || typeof item !== "object") return false;
          const candidate = item as Partial<PersistedSeoReviewItem>;
          return (
            typeof candidate.itemId === "string" &&
            typeof candidate.storeId === "string" &&
            typeof candidate.productId === "string" &&
            typeof candidate.handle === "string" &&
            typeof candidate.title === "string" &&
            typeof candidate.generatedPayload === "string" &&
            (candidate.reviewStatus === "pending" ||
              candidate.reviewStatus === "approved" ||
              candidate.reviewStatus === "rejected")
          );
        })
        .map(adaptPersistedSeoReviewItemToViewModel);

      setProducts((current) => {
        const persistedProductIds = new Set(
          persistedProducts.map((product) => product.productId).filter(Boolean),
        );
        const currentWithoutStaleAutoSeo = current.filter(
          (product) =>
            product.sourceOrigin !== "auto_seo" ||
            !persistedProductIds.has(product.productId),
        );
        return [...persistedProducts, ...currentWithoutStaleAutoSeo];
      });
    }

    void loadPersistedAutoSeoReviews().catch(() => {
      // Keep session data available when the Gateway is temporarily unavailable.
    });

    return () => {
      isCancelled = true;
    };
  }, [selectedStoreId]);

  const gptClient = useMemo(() => getCustomGptClient(environment), []);
  const [, setGptReviewLoadState] = useState<"loading" | "has_reviews" | "empty">("loading");
  const persistedGptReviews = useRef(new Map<string, string>());
  const gptSaveChain = useRef(Promise.resolve());
  useEffect(() => {
    if (environment !== "mock") return;
    let cancelled = false;
    async function loadGptReviews(): Promise<void> {
      const loaded: SeoProductUiViewModel[] = [];
      const reviews = await loadAllCustomGptReviewRecords(gptClient, selectedStoreId);
      for (const review of reviews) {
        if (review.job.source !== "auto_seo" || review.job.status !== "REVIEW_READY") continue;
        loaded.push(adaptCustomGptReview(review.job, review.state));
      }
      if (cancelled) return;
      for (const product of loaded) persistedGptReviews.current.set(product.id, JSON.stringify(product));
      setProducts(current => [...current.filter(product => !product.gptJobId || product.storeId !== selectedStoreId), ...loaded]);
      setGptReviewLoadState(loaded.length > 0 ? "has_reviews" : "empty");
    }
    setGptReviewLoadState("loading");
    void loadGptReviews().catch(error => {
      if (!cancelled) {
        setGptReviewLoadState("empty");
        console.error("[SEO Review] Lỗi xử lý kết quả GPT:", error);
        notifyUser({ title: "GPT SEO", message: "Không tải được kết quả GPT từ server. Mở GPT SEO để kiểm tra kết nối.", type: "error" });
      }
    });
    return () => { cancelled = true; };
  }, [gptClient, selectedStoreId]);

  useEffect(() => {
    for (const product of products) {
      if (product.reviewListItem || !product.gptJobId || !product.storeId || !persistedGptReviews.current.has(product.id)) continue;
      if (environment !== "mock" || product.reviewArchivedAt || product.backendPublish || (product.backendPublishRequired && product.isSyncing)) continue;
      const serialized = JSON.stringify(product);
      if (persistedGptReviews.current.get(product.id) === serialized) continue;
      persistedGptReviews.current.set(product.id, serialized);
      const jobId = product.gptJobId; const targetStore = product.storeId;
      gptSaveChain.current = gptSaveChain.current.then(async () => {
        await gptClient.saveReviewState(targetStore, jobId, product);
        window.dispatchEvent(new Event("ffp-review-changed"));
      }).catch(() => {
        persistedGptReviews.current.set(product.id, "");
        notifyUser({ title: "GPT SEO", message: "Không lưu được trạng thái Review. Giữ trang mở và kiểm tra kết nối trước khi tiếp tục.", type: "error" });
      });
    }
  }, [products, gptClient]);

  useEffect(() => {
    const pending = products.filter(product => product.storeId === selectedStoreId && product.gptJobId && product.backendPublish && !["SUCCEEDED", "BLOCKED"].includes(product.backendPublish.state));
    if (!pending.length) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void Promise.all(pending.map(async product => {
        if (!product.gptJobId) return;
        const state = await gptClient.reviewState(selectedStoreId, product.gptJobId);
        if (cancelled) return;
        setProducts(current => current.map(existing => existing.id === product.id && existing.storeId === selectedStoreId
          ? { ...existing, ...state, reviewActions: undefined, reviewLifecycleStage: undefined, id: existing.id, storeId: existing.storeId, gptJobId: existing.gptJobId } as SeoProductUiViewModel : existing));
      })).catch(() => {
        if (!cancelled) notifyUser({ title: "Backend Sync", message: "Chưa đọc được tiến độ. Tác vụ vẫn được lưu trên server; tải lại trang để kiểm tra, không gửi lại Shopify.", type: "warning" });
      });
    }, 5000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [products, selectedStoreId, gptClient]);

  // Sync selectedStoreId whenever urlStoreId query param changes
  useEffect(() => {
    if (urlStoreId && urlStoreId !== selectedStoreId.toLowerCase()) {
      setSelectedStoreId(urlStoreId);
      persistBrowserActiveStoreId(urlStoreId);
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
              return environment === "mock" ? Array.from(map.values()) : fetchedStores;
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

  const [workspace, setWorkspace] = useState<SeoReviewWorkspace>("all");
  const [pinnedReviewIds, setPinnedReviewIds] = useState<ReadonlySet<string>>(new Set());
  const inFlightSyncIds = useRef(new Set<string>());
  const [filter, setFilter] = useState<SeoReviewFilterState>({
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });

  const catalog = useReviewCatalog({ enabled: environment !== "mock", gpt: gptClient, crawler: amazonCrawlerReviews, pinnedIds: pinnedReviewIds,
    source: filter.sourceOriginFilter ?? "all", query: { storeId: effectiveStoreId, search: filter.searchQuery,
      decision: filter.decisionFilter === "all" ? undefined : filter.decisionFilter, workspace,
      stage: filter.stageFilter === "all" ? undefined : filter.stageFilter } });
  const productsRef = useRef(products);
  productsRef.current = products;
  const viewingStoreRef = useRef(effectiveStoreId);
  viewingStoreRef.current = effectiveStoreId;
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const detailController = useRef(new AbortController());
  const hydratedCatalogVersions = useRef(new Map<string, number>());

  useEffect(() => {
    detailController.current.abort(); detailController.current = new AbortController();
    hydratedCatalogVersions.current.clear();
    setSelectedIds(new Set()); setActiveProduct(null); setIsDrawerOpen(false); setIsEditModalOpen(false);
    setExpandedTableIds(new Set()); setPendingCrawlerSyncIds([]);
    setFilter({ searchQuery: "", statusFilter: "all", decisionFilter: "all", onlyMockData: false });
    setWorkspace("all");
    return () => detailController.current.abort();
  }, [effectiveStoreId]);

  useEffect(() => {
    setPinnedReviewIds(new Set());
  }, [effectiveStoreId, workspace, filter.sourceOriginFilter, filter.searchQuery, filter.stageFilter, catalog.page]);

  useEffect(() => {
    if (environment === "mock" || !catalog.catalog) return;
    setProducts(current => {
      const byId = new Map(current.filter(product => product.storeId === effectiveStoreId).map(product => [product.id, product]));
      const rows = catalog.catalog?.items.map(item => {
        const existing = byId.get(item.id);
        if (existing && (inFlightSyncIds.current.has(item.id) || pinnedReviewIds.has(item.id) &&
          (existing.backendPublish || isReviewSynced(existing) && item.syncStatus !== "synced"))) return existing;
        if (existing && !existing.reviewListItem && (hydratedCatalogVersions.current.get(item.id) === item.updatedAt || existing.updatedAt >= item.updatedAt)) {
          return existing.isSyncing ? existing : { ...existing, reviewDecision: item.decision, shopifySyncStatus: item.syncStatus,
            shopifySyncError: item.syncError, reviewActions: item.actions, reviewArchivedAt: item.archivedAt, reviewLifecycleStage: item.stage };
        }
        return adaptReviewListItem(item);
      }) ?? [];
      return [...current.filter(product => product.storeId === effectiveStoreId && (product.sourceOrigin === "pinterest_pod" || (!amazonCrawlerReviews?.catalog && product.coordinatorReview))), ...rows];
    });
  }, [catalog.catalog, effectiveStoreId, amazonCrawlerReviews, pinnedReviewIds]);

  useEffect(() => {
    const fetchDetail = amazonCrawlerReviews?.detail;
    if (!amazonCrawlerReviews || !fetchDetail || pendingCrawlerSyncIds.length === 0) return;
    const controller = new AbortController();
    let isPolling = false;
    const poll = async () => {
      if (isPolling) return;
      isPolling = true;
      try {
        await Promise.all(pendingCrawlerSyncIds.map(async id => {
          const fresh = adaptAmazonCrawlerReviewToViewModel(await fetchDetail(id, effectiveStoreId, controller.signal), amazonCrawlerReviews.imageUrl);
          if (controller.signal.aborted || inFlightSyncIds.current.has(id)) return;
          setProducts(current => current.map(product => product.id === id && product.storeId === effectiveStoreId ? mergeCrawlerReviewPollingState(product, fresh) : product));
        }));
      } catch (error: unknown) {
        if (!controller.signal.aborted) setSyncFeedback({ type: "warning", message: "Chưa tải được tiến độ sync. Tác vụ vẫn được giữ trên server; không cần gửi lại." });
      } finally { isPolling = false; }
    };
    const timer = setInterval(() => void poll(), 3000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [amazonCrawlerReviews, pendingCrawlerSyncIds, effectiveStoreId, setSyncFeedback]);

  const hydrateProduct = useCallback(async (product: SeoProductUiViewModel): Promise<SeoProductUiViewModel> => {
    if (product.storeId && product.storeId !== viewingStoreRef.current) throw new Error("Sản phẩm không thuộc store đang xem.");
    if (!product.reviewListItem) return product;
    const item = product.reviewListItem;
    const signal = AbortSignal.any([detailController.current.signal, AbortSignal.timeout(15_000)]);
    let loaded: SeoProductUiViewModel;
    if (item.source === "gpt") {
      const detail = await gptClient.reviewDetail(item.storeId, item.recordId, signal);
      loaded = adaptCustomGptReview(detail.job, detail.state);
    } else if (item.source === "auto_seo") loaded = await loadAutoSeoReview(item.recordId, item.storeId, signal);
    else {
      if (!amazonCrawlerReviews?.detail) throw new Error("Crawler Review detail API is unavailable");
      loaded = adaptAmazonCrawlerReviewToViewModel(await amazonCrawlerReviews.detail(item.recordId, item.storeId, signal), amazonCrawlerReviews.imageUrl);
    }
    if (viewingStoreRef.current !== item.storeId || loaded.storeId !== item.storeId) throw new Error("Store đã đổi; hãy chọn lại sản phẩm.");
    loaded = { ...loaded, reviewActions: item.source === "crawler" ? loaded.reviewActions ?? item.actions : item.actions,
      reviewArchivedAt: loaded.reviewArchivedAt ?? item.archivedAt, reviewLifecycleStage: item.stage };
    hydratedCatalogVersions.current.set(item.id, item.updatedAt);
    if (loaded.gptJobId) persistedGptReviews.current.set(loaded.id, JSON.stringify(loaded));
    const displayed = inFlightSyncIds.current.has(product.id) ? { ...loaded, isSyncing: true, shopifySyncStatus: "syncing" as const } : loaded;
    productsRef.current = productsRef.current.map(existing => existing.id === product.id && existing.storeId === item.storeId ? displayed : existing);
    setProducts(current => current.map(existing => existing.id === product.id && existing.storeId === item.storeId ? displayed : existing));
    return loaded;
  }, [gptClient, amazonCrawlerReviews]);

  async function hydrateTargets(targets: readonly SeoProductUiViewModel[]): Promise<readonly SeoProductUiViewModel[]> {
    const loaded: SeoProductUiViewModel[] = [];
    for (let index = 0; index < targets.length; index += 5) loaded.push(...await Promise.all(targets.slice(index, index + 5).map(hydrateProduct)));
    return loaded;
  }

  async function loadTarget(product: SeoProductUiViewModel | undefined): Promise<SeoProductUiViewModel | undefined> {
    if (!product) return undefined;
    setIsDetailLoading(true);
    try {
      const loaded = await hydrateProduct(product);
      return loaded.storeId && loaded.storeId !== viewingStoreRef.current ? undefined : loaded;
    }
    catch (error: unknown) {
      if (!(error instanceof Error && error.name === "AbortError")) setSyncFeedback({ type: "error", message: error instanceof Error ? error.message : "Không tải được chi tiết Review." });
      return undefined;
    }
    finally { setIsDetailLoading(false); }
  }

  useEffect(() => {
    if (viewMode !== "split" || !activeProduct?.reviewListItem || activeProduct.storeId !== effectiveStoreId) return;
    void loadTarget(activeProduct).then(product => { if (product && product.storeId === viewingStoreRef.current) setActiveProduct(product); });
  }, [viewMode, activeProduct?.id, activeProduct?.reviewListItem, effectiveStoreId]);

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
              title: "📥 Sản phẩm mới sẵn sàng sync!",
              message: `Hệ thống vừa nhận ${handoff.count} sản phẩm từ ${handoff.source || "hệ thống"}${handoff.storeId ? ` cho store ${handoff.storeId.toUpperCase()}` : ""}. Bạn có thể xem nội dung và bấm Sync Shopify.`,
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
        const legacyProducts = products.filter((product) => !product.reviewListItem && !product.coordinatorReview && (environment === "mock" || product.sourceOrigin !== "auto_seo"));
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
    const matchingIds = new Set(filterSeoProducts(storeScopedProducts, filter).map(product => product.id));
    return storeScopedProducts.filter(product => {
      if (pinnedReviewIds.has(product.id)) return true;
      if (!matchingIds.has(product.id)) return false;
      const stage = reviewStage(product);
      return (workspace === "all" || (workspace === "synced" ? isReviewSynced(product) : workspace === "history" ? stage === "history" : stage !== "history")) &&
        (!filter.stageFilter || filter.stageFilter === "all" || stage === filter.stageFilter);
    });
  }, [storeScopedProducts, filter, workspace, pinnedReviewIds]);

  const workspaceCounts = useMemo(() => {
    const counts = catalog.catalog ? { ...catalog.catalog.counts, synced: catalog.catalog.counts.synced ?? 0 } : { ...emptySeoReviewCounts(), synced: 0 };
    for (const product of storeScopedProducts) {
      if (catalog.catalog && product.sourceOrigin !== "pinterest_pod" && (amazonCrawlerReviews?.catalog || !product.coordinatorReview)) continue;
      if (filter.sourceOriginFilter && filter.sourceOriginFilter !== "all" && product.sourceOrigin !== filter.sourceOriginFilter) continue;
      counts[reviewStage(product)] += 1;
      if (isReviewSynced(product)) counts.synced += 1;
    }
    return counts;
  }, [catalog.catalog, storeScopedProducts, filter.sourceOriginFilter, amazonCrawlerReviews]);
  const selectedActionCounts = useMemo(() => {
    const counts = { approve: 0, sync: 0, archive: 0 };
    for (const product of filteredProducts) {
      if (!selectedIds.has(product.id)) continue;
      const actions = reviewActions(product);
      if (actions.canDecide && product.reviewDecision !== "approved") counts.approve += 1;
      if (canStartReviewSync(product)) counts.sync += 1;
      if (actions.canArchive) counts.archive += 1;
    }
    return counts;
  }, [filteredProducts, selectedIds]);

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
  async function handleToggleExpandTable(id: string) {
    if (!expandedTableIds.has(id) && !await loadTarget(productsRef.current.find(product => product.id === id))) return;
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

  async function handleToggleExpandAllTable() {
    if (filteredProducts.length > 0 && filteredProducts.every((p) => expandedTableIds.has(p.id))) {
      setExpandedTableIds(new Set());
    } else {
      try { await hydrateTargets(filteredProducts); } catch { setSyncFeedback({ type: "error", message: "Không tải được đầy đủ chi tiết để mở các dòng." }); return; }
      setExpandedTableIds(new Set(filteredProducts.map((p) => p.id)));
    }
  }

  const isAllExpanded =
    filteredProducts.length > 0 &&
    filteredProducts.every((p) => expandedTableIds.has(p.id));

  // Push to Shopify Store handlers
  async function triggerPushToShopify(targetProduct: SeoProductUiViewModel, options?: { force?: boolean }) {
    const targetStore = effectiveStoreId;
    let gptSyncToken: string | undefined;
    try {
      targetProduct = await hydrateProduct(targetProduct);
      if (targetProduct.coordinatorReview) {
        if (!amazonCrawlerReviews) throw new Error("Coordinator Review API is unavailable.");
        const coordinatorItemId = targetProduct.coordinatorReview.itemId;
        if (options?.force) {
          throw new Error("Sản phẩm Distributed Crawler phải được đối soát và đồng bộ qua Pipeline Worker.");
        }
        const queuedReview = targetProduct.shopifySyncStatus === "synced"
          ? await amazonCrawlerReviews.reconcile(coordinatorItemId)
          : await amazonCrawlerReviews.sync(coordinatorItemId);
        const queuedProduct = adaptAmazonCrawlerReviewToViewModel(
          queuedReview,
          amazonCrawlerReviews.imageUrl,
        );
        setProducts((current) => current.map((product) => (
          product.id === targetProduct.id ? queuedProduct : product
        )));
        setPendingCrawlerSyncIds((current) => (
          current.includes(coordinatorItemId)
            ? current
            : [...current, coordinatorItemId]
        ));
        notifyUser({
          title: targetProduct.shopifySyncStatus === "synced" ? "Đang kiểm tra Shopify" : "Đã xếp hàng đồng bộ",
          message: targetProduct.shopifySyncStatus === "synced"
            ? `Pipeline Worker sẽ kiểm tra và tạo lại "${targetProduct.productTitle.value}" nếu sản phẩm đã bị xóa.`
            : `Pipeline Worker sẽ upload ảnh đã xử lý và đồng bộ "${targetProduct.productTitle.value}".`,
          type: "success",
          url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
        });
        return;
      }
      if (targetProduct.gptJobId) {
        if (targetProduct.storeId !== targetStore) throw new Error("GPT SEO review belongs to another store");
        await gptSaveChain.current;
        if (targetProduct.backendPublishRequired) {
          if (options?.force) throw new Error("Backend Sync không cho ghi đè cưỡng bức. Hãy đánh giá lại nguồn đã thay đổi.");
          const status = await gptClient.publishStatus(targetStore, targetProduct.gptJobId);
          if (!status.managed) throw new Error("Cấu hình publish đã thay đổi. Tải lại Review trước khi tiếp tục.");
          let receipt = status.operation;
          if (receipt?.state === "BLOCKED") receipt = await gptClient.reconcilePublish(targetStore, targetProduct.gptJobId);
          if (!receipt) {
            await gptClient.saveReviewState(targetStore, targetProduct.gptJobId, { ...targetProduct, isSyncing: false, shopifySyncStatus: "idle" });
            receipt = await gptClient.publishReview(targetStore, targetProduct.gptJobId, targetProduct.updatedAt, `publish-${targetProduct.gptJobId}-${targetProduct.updatedAt}`);
          }
          const savedReceipt = receipt;
          setProducts(current => current.map(product => product.id === targetProduct.id && product.storeId === targetStore ? {
            ...product, backendPublish: savedReceipt,
            reviewActions: undefined, reviewLifecycleStage: undefined,
            shopifySyncStatus: savedReceipt.state === "SUCCEEDED" ? "synced" : savedReceipt.state === "BLOCKED" ? "failed" : "syncing",
            isSyncing: !["SUCCEEDED", "BLOCKED"].includes(savedReceipt.state),
            shopifySyncError: savedReceipt.state === "BLOCKED" ? `Cần kiểm tra: ${savedReceipt.errorCode}` : undefined,
          } : product));
          notifyUser({ title: "Backend Sync", message: savedReceipt.state === "BLOCKED" ? "Tác vụ bị chặn; cần đối chiếu dữ liệu trước khi xử lý tiếp." : "Tác vụ đã lưu trên server. Bạn có thể đóng tab; mở lại Review để xem kết quả.", type: savedReceipt.state === "BLOCKED" ? "warning" : "success" });
          return;
        }
        gptSyncToken = (await gptClient.beginSync(targetStore, targetProduct.gptJobId)).token;
      }
      const pushItem = {
        ...toPushProductItem(targetProduct),
        force: options?.force,
      };
      const result = await pushSeoReviewProductToShopify(
        pushItem,
        {
          moduleApiRunner: runner,
          storeId: targetStore,
          force: options?.force,
        },
      );

      if (targetProduct.gptJobId && gptSyncToken) await gptClient.finishSync(targetStore, targetProduct.gptJobId, gptSyncToken, result.success ? "SYNCED" : "UNKNOWN");
      if (isDurableAutoSeoReview(targetProduct) && !targetProduct.coordinatorReview) {
        try {
          await saveAutoSeoReviewSyncOutcome(targetProduct, { shopifySyncStatus: result.success ? "synced" : "failed", shopifyAdminUrl: result.adminUrl });
        } catch (error: unknown) {
          notifyUser({ title: "Chưa lưu được trạng thái Review", type: "warning", message: result.success
            ? "Shopify đã sync thành công nhưng chưa lưu được trạng thái lịch sử. Không gửi lại sản phẩm; cần đối chiếu trước."
            : "Chưa lưu được trạng thái lỗi sync; xem chi tiết sản phẩm trước khi thử lại." });
        }
      }
      if (result.success) {
        notifyUser({
          title: "🛍️ Shopify Sync thành công!",
          message: `Sản phẩm "${targetProduct.productTitle.value}" đã được đồng bộ lên Store ${targetStore.toUpperCase()}.`,
          type: "success",
          sound: "chime",
          url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
        });
      } else {
        const errorMsg = result.conflictDetails
          ? JSON.stringify(result.conflictDetails)
          : result.error || "Lỗi khi đẩy sản phẩm lên Shopify";

        notifyUser({
          title: result.conflictDetails ? "⚠️ Xung đột phiên bản Shopify" : "❌ Shopify Sync thất bại",
          message: result.conflictDetails
            ? `Sản phẩm "${targetProduct.productTitle.value}" đã bị thay đổi trên Shopify kể từ khi tạo SEO.`
            : result.error || "Lỗi khi đẩy sản phẩm lên Shopify",
          type: result.conflictDetails ? "warning" : "error",
          sound: "alert",
          url: `/seo-review?storeId=${encodeURIComponent(targetStore)}`,
        });
      }

      const finalErrorMsg = result.conflictDetails
        ? JSON.stringify(result.conflictDetails)
        : result.error || "Lỗi khi đẩy sản phẩm lên Shopify";

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
              seoVersion: result.seoVersion ?? ((p.seoVersion ?? 0) + 1),
            };
          } else {
            return {
              ...p,
              shopifySyncStatus: "failed",
              isSyncing: false,
              shopifySyncError: finalErrorMsg,
              syncError: finalErrorMsg,
              updatedAt: Date.now(),
            };
          }
        }),
      );
    } catch (err: unknown) {
      if (targetProduct.gptJobId && gptSyncToken) {
        await gptClient.finishSync(targetStore, targetProduct.gptJobId, gptSyncToken, "UNKNOWN").catch(() => undefined);
      }
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
    targets = await hydrateTargets(targets);
    const crawlerTargets = targets.filter((target) => target.coordinatorReview);
    if (crawlerTargets.length > 0) {
      const concurrency = 3;
      for (let index = 0; index < crawlerTargets.length; index += concurrency) {
        await Promise.all(crawlerTargets.slice(index, index + concurrency).map((target) => triggerPushToShopify(target)));
      }
    }
    const directTargets = targets.filter((target) => !target.coordinatorReview);
    if (directTargets.length === 0) return;
    if (directTargets.some(target => target.gptJobId)) {
      const concurrency = 3;
      for (let index = 0; index < directTargets.length; index += concurrency) {
        await Promise.all(directTargets.slice(index, index + concurrency).map(target => triggerPushToShopify(target)));
      }
      return;
    }
    try {
      const pushItems = directTargets.map(toPushProductItem);
      const results = await pushSeoReviewProductsBatch(
        pushItems,
        {
          moduleApiRunner: runner,
          storeId: effectiveStoreId,
        },
        3,
        (res, completedCount, totalCount) => {
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
                  seoVersion: res.seoVersion ?? ((p.seoVersion ?? 0) + 1),
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
      const targetIds = new Set(directTargets.map((t) => t.id));
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
  async function handleViewProduct(product: SeoProductUiViewModel) {
    const loaded = await loadTarget(product);
    if (!loaded) return;
    product = loaded;
    setActiveProduct(product);
    setIsDrawerOpen(true);
  }

  async function handleRetrySync(id: string) {
    if (inFlightSyncIds.current.has(id)) return;
    const original = productsRef.current.find(product => product.id === id);
    if (!original || !canStartReviewSync(original) && !reviewActions(original).canReconcile) return;
    inFlightSyncIds.current.add(id);
    setPinnedReviewIds(current => new Set([...current, id]));
    setProducts(current => current.map(product => product.id === id ? { ...product, isSyncing: true, shopifySyncStatus: "syncing", shopifySyncError: undefined } : product));
    try {
      const loaded = await hydrateProduct(original);
      const prepared = await prepareReviewSync(loaded, { storeId: effectiveStoreId, crawler: amazonCrawlerReviews, gpt: gptClient });
      const syncingTarget: SeoProductUiViewModel = { ...prepared, isSyncing: true, shopifySyncStatus: "syncing", shopifySyncError: undefined };
      setProducts(current => current.map(product => product.id === id ? syncingTarget : product));
      await triggerPushToShopify(prepared);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Không thể chuẩn bị Sync.";
      setProducts(current => current.map(product => product.id === id ? { ...original, isSyncing: false, shopifySyncError: message } : product));
      setSyncFeedback({ type: "error", message: `Không thể sync: ${message}` });
    } finally {
      inFlightSyncIds.current.delete(id);
      catalog.invalidate();
    }
  }

  function handleViewSyncError(product: SeoProductUiViewModel) {
    setErrorModalProduct(product);
  }

  async function handleForceOverwrite(id: string) {
    const target = await loadTarget(productsRef.current.find((p) => p.id === id || p.productId === id));
    if (!target) return;

    const syncingTarget: SeoProductUiViewModel = {
      ...target,
      shopifySyncStatus: "syncing",
      isSyncing: true,
      shopifySyncError: undefined,
      updatedAt: Date.now(),
    };

    setProducts((prev) =>
      prev.map((p) => (p.id === target.id ? syncingTarget : p)),
    );

    void triggerPushToShopify(syncingTarget, { force: true });
  }

  async function handleReRunSeo(id: string) {
    const target = await loadTarget(productsRef.current.find((p) => p.id === id || p.productId === id));
    if (!target) return;

    setProducts((prev) =>
      prev.map((p) =>
        p.id === target.id
          ? {
              ...p,
              seoStatus: { value: "processing", source: "real" },
              shopifySyncStatus: "idle",
              shopifySyncError: undefined,
              updatedAt: Date.now(),
            }
          : p,
      ),
    );

    setSyncFeedback({
      type: "success",
      message: `🔄 Đã lên lịch tạo lại SEO cho "${target.productTitle.value}" từ dữ liệu Shopify mới nhất.`,
    });
  }

  async function handleApproveProduct(id: string): Promise<void> {
    const target = await loadTarget(productsRef.current.find((p) => p.id === id));
    if (!target) return;
    if (!reviewActions(target).canDecide) { setSyncFeedback({ type: "warning", message: "Bản Review này không còn cho phép thay đổi quyết định." }); return; }
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
      if (isDurableAutoSeoReview(target)) await updateAutoSeoReviewStatus(target, "approved");
      if (target.gptJobId && target.storeId) {
        const approved = { ...target, reviewDecision: "approved" as const, rejectionReason: undefined, reviewActions: undefined, reviewLifecycleStage: undefined };
        await gptClient.saveReviewState(target.storeId, target.gptJobId, approved);
        persistedGptReviews.current.set(target.id, JSON.stringify(approved));
      }
      setProducts((prev) => prev.map((product) =>
        product.id === id
          ? {
              ...product,
              reviewDecision: "approved",
              reviewActions: undefined,
              reviewLifecycleStage: undefined,
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
      catalog.invalidate();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể duyệt sản phẩm: ${message}` });
    }
  }

  async function handleRejectProduct(id: string, reason = "Nội dung SEO chưa đạt yêu cầu"): Promise<void> {
    const target = await loadTarget(productsRef.current.find((p) => p.id === id));
    if (target?.backendPublish) { setSyncFeedback({ type: "warning", message: "Không thể thay quyết định của bản Review đã gửi publish." }); return; }
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
      if (isDurableAutoSeoReview(target)) await updateAutoSeoReviewStatus(target, "rejected", reason);
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
  async function approveTargets(targets: readonly SeoProductUiViewModel[]): Promise<void> {
    if (targets.length === 0) return;
    if (targets.some(product => product.backendPublish)) { setSyncFeedback({ type: "warning", message: "Bỏ chọn bản Review đã gửi publish trước khi duyệt hàng loạt." }); return; }
    try {
      targets = await hydrateTargets(targets);
      if (targets.some(product => !reviewActions(product).canDecide)) throw new Error("Một bản Review không còn cho phép duyệt.");
      const updatedReviews = await Promise.all(targets.flatMap((target) => {
        if (!target.coordinatorReview || !amazonCrawlerReviews) return [];
        return [amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "approved",
        )];
      }));
      await Promise.all(targets.filter(isDurableAutoSeoReview).map((target) => updateAutoSeoReviewStatus(target, "approved")));
      const versions = new Map(updatedReviews.map((review) => [review.id, review.version]));
      const targetIds = new Set(targets.map((target) => target.id));
      const approvedTargets = targets.map((product): SeoProductUiViewModel => ({
        ...product,
        reviewDecision: "approved",
        reviewActions: undefined,
        reviewLifecycleStage: undefined,
        rejectionReason: undefined,
        coordinatorReview: product.coordinatorReview && versions.has(product.coordinatorReview.itemId)
          ? { ...product.coordinatorReview, version: versions.get(product.coordinatorReview.itemId) ?? product.coordinatorReview.version }
          : product.coordinatorReview,
        updatedAt: Date.now(),
      }));
      const gptTargets = approvedTargets.filter((product) => product.gptJobId && product.storeId === effectiveStoreId);
      if (gptTargets.length > 0) {
        const chunkSize = 10;
        for (let index = 0; index < gptTargets.length; index += chunkSize) {
          const chunk = gptTargets.slice(index, index + chunkSize);
          await gptClient.saveReviewStates(effectiveStoreId, chunk.map((product) => ({
            jobId: product.gptJobId ?? "",
            state: product,
          })));
        }
        for (const product of gptTargets) persistedGptReviews.current.set(product.id, JSON.stringify(product));
      }
      const approvedById = new Map(approvedTargets.map((product) => [product.id, product]));
      setProducts((prev) => prev.map((product) => approvedById.get(product.id) ?? product));
      setSelectedIds((previous) => new Set([...previous].filter((id) => !targetIds.has(id))));
      setSyncFeedback({ type: "success", message: `✓ Đã duyệt ${targets.length} sản phẩm. Chưa có sản phẩm nào được sync.` });
      catalog.invalidate();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      setSyncFeedback({ type: "error", message: `Không thể duyệt hàng loạt: ${message}` });
    }
  }

  async function handleApproveSelected(): Promise<void> {
    setIsApprovingAll(true);
    try {
      await approveTargets(filteredProducts.filter(product => selectedIds.has(product.id) && reviewActions(product).canDecide && product.reviewDecision !== "approved"));
    } finally { setIsApprovingAll(false); }
  }

  async function handleSyncSelected(): Promise<void> {
    const targets = filteredProducts.filter(product => selectedIds.has(product.id) && canStartReviewSync(product));
    for (const target of targets) await handleRetrySync(target.id);
    catalog.invalidate();
  }

  async function handleApproveAllPending(): Promise<void> {
    const targets = storeScopedProducts.filter(
      (product) => product.reviewDecision === "pending" && !product.isSyncing && !product.isReverting,
    );
    if (targets.length === 0) return;
    setIsApprovingAll(true);
    try {
      await approveTargets(targets);
    } finally {
      setIsApprovingAll(false);
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
    if (products.some(product => selectedIds.has(product.id) && product.backendPublish)) { setSyncFeedback({ type: "warning", message: "Bỏ chọn bản Review đã gửi publish trước khi từ chối hàng loạt." }); return; }
    let targets = products.filter(
      (p) => selectedIds.has(p.id) && !p.isSyncing && !p.isReverting,
    );
    if (targets.length === 0) return;
    const targetIdSet = new Set(targets.map((t) => t.id));

    const reason = "Từ chối hàng loạt trong đợt review";
    try {
      targets = [...await hydrateTargets(targets)];
      if (targets.some(product => product.backendPublish)) throw new Error("Không thể từ chối bản Review đã gửi publish.");
      const updatedReviews = await Promise.all(targets.flatMap((target) => {
        if (!target.coordinatorReview || !amazonCrawlerReviews) return [];
        return [amazonCrawlerReviews.decide(
          target.coordinatorReview.itemId,
          target.coordinatorReview.version,
          "rejected",
          reason,
        )];
      }));
      await Promise.all(targets.filter(isDurableAutoSeoReview).map((target) => updateAutoSeoReviewStatus(target, "rejected", reason)));
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
      ...(p.gptJobId ? { shopifySyncStatus: "idle" as const, shopifySyncedAt: undefined, shopifySyncError: undefined } : {}),
      lastRevertedAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  async function handleRollbackProduct(id: string): Promise<void> {
    const target = await loadTarget(productsRef.current.find((p) => p.id === id));
    if (!target) return;
    if (target.backendPublishRequired) { setSyncFeedback({ type: "warning", message: "Store dùng backend publish không cho hoàn tác trực tiếp từ trình duyệt. Cần tạo và duyệt revision mới." }); return; }
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
    try { await hydrateTargets(products.filter(product => selectedIds.has(product.id))); }
    catch { setSyncFeedback({ type: "error", message: "Không tải được backup để hoàn tác." }); return; }
    if (products.some(product => selectedIds.has(product.id) && product.backendPublishRequired)) { setSyncFeedback({ type: "warning", message: "Không thể hoàn tác trực tiếp các bản backend publish. Cần revision mới." }); return; }
    const targets = productsRef.current.filter(
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
  async function handleEditProduct(product: SeoProductUiViewModel) {
    const loaded = await loadTarget(product);
    if (!loaded) return;
    product = loaded;
    if (!reviewActions(product).canEdit) return;
    setEditingProduct(product);
    setIsEditModalOpen(true);
  }

  async function handleSaveEdit(id: string, updated: SeoProductEditInput, autoApprove = false): Promise<boolean> {
    const target = await loadTarget(productsRef.current.find((product) => product.id === id));
    if (!target) return false;
    if (!reviewActions(target).canEdit) { setSyncFeedback({ type: "warning", message: "Bản này không còn cho phép sửa; cần bản SEO mới để thay đổi nội dung." }); return false; }

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
      if (isDurableAutoSeoReview(target)) {
        await updateAutoSeoReviewPayload(target, updated);
        if (autoApprove) await updateAutoSeoReviewStatus(target, "approved");
        else if (target.reviewDecision !== "pending") await updateAutoSeoReviewStatus(target, "pending");
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
      reviewActions: undefined,
      reviewLifecycleStage: undefined,
      rejectionReason: undefined,
      coordinatorReview: target.coordinatorReview && nextVersion !== undefined
        ? { ...target.coordinatorReview, version: nextVersion }
        : target.coordinatorReview,
      updatedAt: Date.now(),
    };

    // If autoApprove is requested AND product was already synced on Shopify (or already has a Shopify GID):
    // Directly push the updated product data to Shopify!
    if (autoApprove && wasAlreadySynced && target.coordinatorReview) {
      const syncingProduct: SeoProductUiViewModel = {
        ...updatedProductBase,
        isSyncing: true,
        shopifySyncStatus: "syncing",
        shopifySyncError: undefined,
      };
      setProducts((prev) => prev.map((product) => product.id === id ? syncingProduct : product));
      await triggerPushToShopify(syncingProduct);
      return true;
    }

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
            seoVersion: pushResult.seoVersion ?? ((target.seoVersion ?? 0) + 1),
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
    if (finalProduct.gptJobId && finalProduct.storeId) {
      try {
        await gptClient.saveReviewState(finalProduct.storeId, finalProduct.gptJobId, finalProduct);
        persistedGptReviews.current.set(finalProduct.id, JSON.stringify(finalProduct));
      } catch (error: unknown) {
        setSyncFeedback({ type: "error", message: error instanceof Error ? error.message : "Không lưu được bản Review." });
        return false;
      }
    }

    setProducts((prev) => prev.map((p) => (p.id === id ? finalProduct : p)));
    catalog.invalidate();

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
  async function handleExportApprovedJson() {
    let approvedProducts: readonly SeoProductUiViewModel[];
    try { approvedProducts = await hydrateTargets(storeScopedProducts.filter((p) => p.reviewDecision === "approved")); }
    catch { setSyncFeedback({ type: "error", message: "Không tải được chi tiết để xuất JSON." }); return; }
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

  const removeProductsFromUi = useCallback((ids: ReadonlySet<string>) => {
    setProducts((prev) => {
      const nextProducts = prev.filter((product) => !ids.has(product.id));
      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          const legacy = nextProducts.filter((product) => !product.coordinatorReview);
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(legacy));
        } catch {
          // Session storage is a best-effort cache; the server remains authoritative.
        }
      }
      return nextProducts;
    });
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
    if (activeProduct && ids.has(activeProduct.id)) {
      setIsDrawerOpen(false);
      setActiveProduct(null);
    }
  }, [activeProduct]);

  const handleRequeueConfirm = useCallback(async (options: {
    provider?: "gemini" | "custom_gpt" | "codex_mcp";
    instructions?: string;
  }) => {
    if (!requeueTargetIds || requeueTargetIds.length === 0) return;
    const targetIdSet = new Set(requeueTargetIds);
    const targets = products.filter((p) => targetIdSet.has(p.id));
    if (targets.length === 0) {
      setRequeueTargetIds(null);
      return;
    }

    try {
      const loadedTargets = await hydrateTargets(targets);
      const gptTargets = loadedTargets.filter((t) => Boolean(t.gptJobId));
      const durableTargets = loadedTargets.filter((t) => isDurableAutoSeoReview(t));

      if (gptTargets.length > 0) {
        const revisionTargets = gptTargets.filter(target => target.backendPublishRequired);
        if (revisionTargets.length && options.provider && options.provider !== "codex_mcp") throw new Error("Revision mới giữ Codex MCP; không tự chuyển AI xử lý.");
        for (const target of revisionTargets) {
          if (target.gptJobId) await gptClient.createRevision(effectiveStoreId, target.gptJobId, crypto.randomUUID(), options.instructions);
        }
        const jobIds = gptTargets.filter(target => !target.backendPublishRequired).map((t) => t.gptJobId as string);
        if (jobIds.length) await gptClient.requeue(effectiveStoreId, jobIds, options);
      }

      if (durableTargets.length > 0) {
        await Promise.allSettled(
          durableTargets.map((t) =>
            fetch(`/api/seo-review/items?storeId=${encodeURIComponent(t.storeId || effectiveStoreId)}&productId=${encodeURIComponent(t.productId || "")}`, {
              method: "DELETE",
            }),
          ),
        );
      }

      removeProductsFromUi(new Set(targets.filter(target => !target.backendPublishRequired).map(target => target.id)));

      const count = targets.length;
      setSyncFeedback({
        type: "success",
        message: `✓ Đã đưa ${count} sản phẩm quay lại SEO Queue thành công!`,
      });
      notifyUser({
        title: "🔄 Đã đưa vào SEO Queue",
        message: `${count} sản phẩm đã được đưa vào Queue. Với Worker, tạo revision mới và giữ nguyên lịch sử Review cũ.`,
        type: "success",
        sound: "chime",
        url: `/seo-queue?storeId=${encodeURIComponent(effectiveStoreId)}`,
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      setSyncFeedback({
        type: "error",
        message: `✕ Lỗi khi đưa sản phẩm về Queue: ${errorMsg}`,
      });
    } finally {
      setRequeueTargetIds(null);
    }
  }, [requeueTargetIds, products, effectiveStoreId, gptClient, removeProductsFromUi, setSyncFeedback]);

  const isDeletingReviewsRef = useRef(false);
  const [isArchivingReviews, setIsArchivingReviews] = useState(false);
  const deleteProductsFromReview = useCallback(async (
    targets: readonly SeoProductUiViewModel[],
  ): Promise<{ readonly deletedIds: ReadonlySet<string>; readonly errors: readonly string[] } | null> => {
    if (isDeletingReviewsRef.current) return null;
    isDeletingReviewsRef.current = true; setIsArchivingReviews(true);
    try {
      const outcomes: PromiseSettledResult<string>[] = [];
      for (let index = 0; index < targets.length; index += 5) {
        outcomes.push(...await Promise.allSettled(targets.slice(index, index + 5).map(async target => {
          await archiveSeoReviewProduct(target, { crawler: amazonCrawlerReviews, gpt: gptClient });
          return target.id;
        })));
      }
      const deletedIds = new Set<string>();
      const errors: string[] = [];
      outcomes.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") deletedIds.add(outcome.value);
        else errors.push(`${targets[index]?.productTitle.value ?? "Sản phẩm"}: ${outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason)}`);
      });
      if (deletedIds.size > 0) {
        setProducts(current => current.map(product => deletedIds.has(product.id) ? { ...product, reviewArchivedAt: Date.now(),
          reviewActions: undefined, reviewLifecycleStage: "history" } : product));
        setSelectedIds(current => new Set([...current].filter(id => !deletedIds.has(id))));
        catalog.invalidate();
      }
      return { deletedIds, errors };
    } finally { isDeletingReviewsRef.current = false; setIsArchivingReviews(false); }
  }, [amazonCrawlerReviews, gptClient, catalog.invalidate]);

  const handleDeleteProduct = useCallback(async (id: string) => {
    const target = productsRef.current.find(product => product.id === id);
    if (!target) return;
    if (!confirm("Lưu trữ bản Review này? Giữ nguyên SEO, ảnh, backup và lịch sử; không xóa sản phẩm Shopify.")) return;
    const outcome = await deleteProductsFromReview([target]);
    if (outcome) setSyncFeedback({ type: outcome.errors.length ? "error" : "success",
      message: outcome.errors.length ? `Không thể lưu trữ: ${outcome.errors[0]}` : "Đã lưu trữ. Nội dung và lịch sử vẫn xem được trong Tất cả." });
  }, [deleteProductsFromReview]);

  const handleDeleteSelected = useCallback(async () => {
    const targets = productsRef.current.filter(product => selectedIds.has(product.id) && reviewActions(product).canArchive);
    if (!targets.length) return;
    if (!confirm(`Lưu trữ ${targets.length} bản đã chọn? Không xóa sản phẩm Shopify, SEO, ảnh hoặc backup.`)) return;
    const outcome = await deleteProductsFromReview(targets);
    if (outcome) setSyncFeedback({ type: outcome.errors.length ? "warning" : "success",
      message: `Đã lưu trữ ${outcome.deletedIds.size}/${targets.length} bản.${outcome.errors.length ? " Bản không thể lưu trữ được giữ nguyên: " + outcome.errors.join("; ") : " Xem lại trong Tất cả."}` });
  }, [selectedIds, deleteProductsFromReview]);

  const canRollbackSelectedCount = useMemo(() => {
    return products.filter(
      (p) =>
        selectedIds.has(p.id) &&
        (Boolean(p.originalBackup) || p.reviewListItem?.source === "auto_seo") &&
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

      </div>

      {/* Viewing store selection never changes a product's immutable publish destination. */}
      <div className="flex flex-col gap-3 rounded-xl border border-teal-800/40 bg-gradient-to-r from-slate-900/95 via-slate-900/80 to-teal-950/30 p-3.5 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/20 text-teal-300 text-sm">
              🏪
            </span>
            <span className="text-sm font-semibold text-slate-200">
              <label htmlFor="review-store">Store đang xem:</label>
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-md border border-teal-500/40 bg-teal-500/10 px-2.5 py-1 font-mono text-xs font-bold text-teal-300">
              <span>{effectiveStoreId.toUpperCase()}</span>
              <span className="text-[10px] text-slate-400 font-normal">
                ({availableStores.find((s) => s.storeId.toLowerCase() === effectiveStoreId.toLowerCase())?.shopDomain || effectiveStoreId})
              </span>
            </span>
            <select id="review-store" value={effectiveStoreId} className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
              onChange={event => {
                const nextStore = event.target.value;
                setSelectedIds(new Set()); setActiveProduct(null); setIsDrawerOpen(false); setIsEditModalOpen(false);
                persistBrowserActiveStoreId(nextStore);
                navigate(`/seo-review?storeId=${encodeURIComponent(nextStore)}`);
              }}>
              {!availableStores.some(store => store.storeId === effectiveStoreId) && <option value={effectiveStoreId}>{effectiveStoreId}</option>}
              {availableStores.map(store => <option key={store.storeId} value={store.storeId}>{store.storeId} ({store.shopDomain})</option>)}
            </select>
            <span className="text-xs text-slate-400">Đổi store để xem; store đích của từng sản phẩm được giữ nguyên.</span>
          </div>

          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Trang hiện tại:</span>
            <span className="font-mono text-cyan-300 font-semibold bg-slate-800/90 px-2.5 py-1 rounded border border-slate-700">
              {storeScopedProducts.length} sản phẩm
            </span>
          </div>
        </div>

        {/* Other stores that have products in review queue */}
        {otherStoresWithProducts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-slate-800/60 text-xs text-slate-400">
            <span className="text-slate-500">Các store khác có bản Review:</span>
            {otherStoresWithProducts.map((os) => (
              <button
                key={os.storeId}
                type="button"
                onClick={() => {
                  persistBrowserActiveStoreId(os.storeId);
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
      {environment !== "mock" && <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400">
        <span>{catalog.isLoading ? "Đang tải danh sách Review…" : `${catalog.catalog?.total ?? 0} kết quả · Trang ${catalog.page} · Các thao tác hàng loạt áp dụng cho trang hiện tại`}</span>
        <div className="flex gap-2">
          <button type="button" disabled={!catalog.hasPreviousPage || catalog.isLoading} onClick={() => { setSelectedIds(new Set()); catalog.previous(); }} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Trang trước</button>
          <button type="button" disabled={!catalog.catalog?.hasNextPage || catalog.isLoading} onClick={() => { setSelectedIds(new Set()); catalog.next(); }} className="rounded border border-slate-700 px-3 py-1 disabled:opacity-40">Trang sau</button>
          <button type="button" onClick={() => { setPinnedReviewIds(new Set()); catalog.refresh(); }} className="rounded border border-slate-700 px-3 py-1">Làm mới</button>
        </div>
        {catalog.error && <p role="alert" className="w-full text-rose-300">{catalog.error} <button type="button" onClick={catalog.refresh}>Thử lại</button></p>}
      </div>}
      {isDetailLoading && <p role="status" className="text-sm text-cyan-300">Đang tải chi tiết sản phẩm…</p>}
      <SeoBatchToolbar
        counts={workspaceCounts} workspace={workspace} filter={filter} viewMode={viewMode}
        selectedCount={selectedIds.size} approvableCount={selectedActionCounts.approve}
        syncableCount={selectedActionCounts.sync} archivableCount={selectedActionCounts.archive}
        isBusy={isApprovingAll || isDetailLoading || isArchivingReviews || storeScopedProducts.some(product => product.isSyncing)}
        onWorkspaceChange={nextWorkspace => { setWorkspace(nextWorkspace); setSelectedIds(new Set()); setFilter(current => ({ ...current, stageFilter: "all", decisionFilter: "all" })); }}
        onFilterChange={nextFilter => { setSelectedIds(new Set()); setFilter(current => ({ ...current, ...nextFilter })); }}
        onViewModeChange={setViewMode} onSelectAll={handleSelectAll} onClearSelection={handleClearSelection}
        onApproveSelected={() => void handleApproveSelected()} onSyncSelected={() => void handleSyncSelected()}
        onArchiveSelected={() => void handleDeleteSelected()}
      />

      {/* Review Content View based on active viewMode */}
      {filteredProducts.length === 0 ? (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/40 p-12 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-800/80 text-2xl text-slate-400 border border-slate-700/50 shadow-inner">
            📝
          </div>
          <h3 className="mt-4 text-base font-bold text-slate-200">
            {catalog.isLoading ? "Đang tải Review…" : workspace === "synced" ? "Chưa có sản phẩm đã sync phù hợp" : "Không có sản phẩm Review phù hợp"}
          </h3>
          <p className="mt-2 text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
            {workspace === "synced" ? "Sản phẩm sync thành công sẽ xuất hiện ở đây và vẫn xem được trong Tất cả."
              : "Chọn Tất cả để xem cả bản đã sync hoặc lưu trữ; bản sẵn sàng có thể Sync ngay, không cần duyệt."}
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
              onRequeueProduct={(id) => setRequeueTargetIds([id])}
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
              activeProduct={activeProduct?.reviewListItem ? null : activeProduct}
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
        workerClient={gptClient}
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
        onRequeue={(id) => {
          setRequeueTargetIds([id]);
          setIsDrawerOpen(false);
        }}
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
        onOpenVersionConflict={(p) => setConflictModalProduct(p)}
      />

      {/* Shopify Optimistic Concurrency Conflict Diff Modal */}
      <VersionConflictModal
        isOpen={Boolean(conflictModalProduct)}
        product={conflictModalProduct}
        onClose={() => setConflictModalProduct(null)}
        onForceOverwrite={handleForceOverwrite}
        onReRunSeo={handleReRunSeo}
      />

      {/* High-Resolution Image Zoom Lightbox */}
      <ImageZoomModal
        isOpen={zoomState.isOpen}
        images={zoomState.images}
        initialIndex={zoomState.initialIndex}
        onClose={handleCloseZoomImage}
      />

      {/* Re-queue Modal */}
      <RequeueModal
        isRevision={products.some(product => product.backendPublishRequired && requeueTargetIds?.includes(product.id))}
        isOpen={requeueTargetIds !== null && requeueTargetIds.length > 0}
        count={requeueTargetIds?.length ?? 0}
        onClose={() => setRequeueTargetIds(null)}
        onConfirm={handleRequeueConfirm}
      />
    </div>
  );
}
