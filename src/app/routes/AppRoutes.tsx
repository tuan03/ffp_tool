import { useMemo } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { environment } from "../../config/environment";
import { AppLayout } from "../../layouts/AppLayout";
import { amazonCrawlerRoutes } from "../../modules/amazon-crawler";
import type {
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerJobController,
  AmazonCrawlerJobLoader,
  AmazonCrawlerReviewClient,
  AmazonCrawlerRunner,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfileManager,
} from "../../modules/amazon-crawler";
import { createAutoSeoRoutes } from "../../modules/auto-seo";
import type { ShopifyProductForAutoSeoUi } from "../../modules/auto-seo";
import { createCustomizationManagerRoutes } from "../../modules/customization-manager";
import { getModuleApiRunner } from "../../modules/module-api";
import {
  applyApprovedProductUpdates,
  createAutoSeoModuleApiClient,
  handoverAutoSeoToSeo,
  handoverPinterestToSeo,
  hasWritableChanges,
} from "../../modules/orchestrator";
import type {
  ApplyApprovedProductUpdatesResult,
  ApprovedProductUpdate,
  ApprovedProductUpdateItemResult,
  AutoSeoSourceProduct,
  WorkflowInput,
  WorkflowOutput,
} from "../../modules/orchestrator";
import { createPinterestPodRoutes, getPinterestPodClient } from "../../modules/pinterest-pod";
import type { PinterestPodDeliverables } from "../../modules/pinterest-pod";
import { createProductCrawlerRoutes, getProductCrawlerClient } from "../../modules/product-crawler";
import { getSeoContentRunner } from "../../modules/seo-content";
import { HomePage } from "../../pages/home/HomePage";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";
import {
  adaptAutoSeoItemToViewModel,
  adaptPinterestPodItemToViewModel,
  adaptViewModelToApprovedUpdate,
  adaptViewModelToRollbackUpdate,
  SeoReviewPage,
} from "../../pages/seo-review";
import type { SeoProductUiViewModel } from "../../pages/seo-review";

interface AppRoutesProps {
  amazonCrawlerJobs: AmazonCrawlerJobController;
  amazonCrawlerReviews: AmazonCrawlerReviewClient;
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier;
  imageProcessingProfiles: ImageProcessingProfileManager;
  loadAmazonCrawlerJob?: AmazonCrawlerJobLoader;
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({
  amazonCrawlerJobs,
  amazonCrawlerReviews,
  clearAmazonCrawlerCache,
  imageProcessingProfiles,
  loadAmazonCrawlerClients,
  loadAmazonCrawlerJob,
  retryAmazonCrawlerSyncs,
  runAmazonCrawler,
  runWorkflow,
}: AppRoutesProps): React.JSX.Element {
  const router = useMemo(() => {
    const podClient = getPinterestPodClient(environment);
    const crawlerClient = getProductCrawlerClient(environment);
    const crawlerRoutes = createProductCrawlerRoutes(crawlerClient);
    const moduleApiRunner = getModuleApiRunner(environment);
    const autoSeoClient = createAutoSeoModuleApiClient(moduleApiRunner);
    const seoRunner = getSeoContentRunner(environment);

    const handlePinterestHandover = async (
      payload: PinterestPodDeliverables,
      serverViewModels?: readonly unknown[],
    ): Promise<void> => {
      let newViewModels: readonly SeoProductUiViewModel[];

      if (serverViewModels && Array.isArray(serverViewModels) && serverViewModels.length > 0) {
        newViewModels = serverViewModels as readonly SeoProductUiViewModel[];
      } else {
        const result = await handoverPinterestToSeo(
          {
            deliverables: payload,
            defaultNiche: payload.items[0]?.trendKeywords?.[0] || payload.productType || "home decor",
          },
          {
            seoRunner,
          },
        );

        newViewModels = result.items.map((item) =>
          adaptPinterestPodItemToViewModel(item),
        );
      }

      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          const storageKey = "ffp_seo_review_session_v1";
          const existingRaw = window.sessionStorage.getItem(storageKey);
          let existingList: readonly SeoProductUiViewModel[] = [];
          if (existingRaw) {
            const parsed = JSON.parse(existingRaw) as unknown;
            if (Array.isArray(parsed)) {
              existingList = parsed as SeoProductUiViewModel[];
            }
          }
          const existingFiltered = existingList.filter(
            (ex) =>
              !ex.id.startsWith("sample-prod-") &&
              !newViewModels.some((nv) => nv.id === ex.id),
          );
          if (payload.storeId) {
            try {
              window.localStorage.setItem("ffp_seo_review_selected_store", payload.storeId);
            } catch {
              // Ignore
            }
          }
          const merged = [...newViewModels, ...existingFiltered];
          window.sessionStorage.setItem(storageKey, JSON.stringify(merged));
          window.sessionStorage.setItem(
            "ffp_seo_review_handoff_banner",
            JSON.stringify({
              count: newViewModels.length,
              timestamp: Date.now(),
              source: "Pinterest POD Studio",
              storeId: payload.storeId,
            }),
          );
        } catch {
          // Ignore storage quota limits
        }
      }
    };

    const podRoutes = createPinterestPodRoutes(podClient, handlePinterestHandover);

    const handleAutoSeoHandover = async (
      shopifyProducts: readonly ShopifyProductForAutoSeoUi[],
      storeId?: string,
    ): Promise<void> => {
      const effectiveStoreId =
        storeId ||
        shopifyProducts.find((p) => p.storeId)?.storeId;

      const result = await handoverAutoSeoToSeo(
        {
          products: shopifyProducts as unknown as AutoSeoSourceProduct[],
          storeId: effectiveStoreId,
        },
        {
          seoRunner,
        },
      );

      const newViewModels = result.items.map((item) =>
        adaptAutoSeoItemToViewModel(item, effectiveStoreId),
      );

      if (typeof window !== "undefined" && window.sessionStorage) {
        try {
          const storageKey = "ffp_seo_review_session_v1";
          const existingRaw = window.sessionStorage.getItem(storageKey);
          let existingList: readonly SeoProductUiViewModel[] = [];
          if (existingRaw) {
            const parsed = JSON.parse(existingRaw) as unknown;
            if (Array.isArray(parsed)) {
              existingList = parsed as SeoProductUiViewModel[];
            }
          }
          const existingFiltered = existingList.filter(
            (ex) =>
              !ex.id.startsWith("sample-prod-") &&
              !newViewModels.some((nv) => nv.id === ex.id),
          );
          const merged = [...newViewModels, ...existingFiltered];
          window.sessionStorage.setItem(storageKey, JSON.stringify(merged));
          window.sessionStorage.setItem(
            "ffp_seo_review_handoff_banner",
            JSON.stringify({
              count: newViewModels.length,
              timestamp: Date.now(),
              source: "Auto SEO",
            }),
          );
        } catch {
          // Ignore storage quota limits
        }
      }
    };

    const autoSeoRoutes = createAutoSeoRoutes(autoSeoClient, handleAutoSeoHandover);
    const customizationRoutes = createCustomizationManagerRoutes(moduleApiRunner);

    const handleSyncApprovedProducts = async (
      items: readonly SeoProductUiViewModel[],
    ): Promise<ApplyApprovedProductUpdatesResult> => {
      if (items.length === 0) {
        return {
          workflowId: `seo-sync-${Date.now()}`,
          requestedCount: 0,
          successCount: 0,
          failedCount: 0,
          items: [],
        };
      }

      // Group products by storeId
      const itemsByStore = new Map<string, SeoProductUiViewModel[]>();
      let defaultStoreId: string | undefined = undefined;

      for (const item of items) {
        let targetStoreId = item.storeId?.trim();
        if (!targetStoreId) {
          if (!defaultStoreId) {
            try {
              const info = await autoSeoClient.getStoreInfo();
              if (info?.storeId) {
                defaultStoreId = info.storeId.trim();
              }
            } catch {
              // Ignore failure to fetch default store info
            }
          }
          targetStoreId = defaultStoreId;
        }

        const effectiveKey = targetStoreId || "__missing_store__";
        const group = itemsByStore.get(effectiveKey) ?? [];
        group.push(item);
        itemsByStore.set(effectiveKey, group);
      }

      const workflowId = `seo-sync-${Date.now()}`;
      const allItemResults: ApprovedProductUpdateItemResult[] = [];
      let totalSuccess = 0;
      let totalFailed = 0;

      for (const [storeId, group] of itemsByStore.entries()) {
        if (storeId === "__missing_store__") {
          for (const item of group) {
            allItemResults.push({
              productId: (item.productId || item.id).trim(),
              ok: false,
              error: "Không tìm thấy storeId cho sản phẩm. Vui lòng kiểm tra cấu hình cửa hàng trong Auto SEO.",
              errorCode: "MISSING_STORE_ID",
            });
            totalFailed++;
          }
          continue;
        }

        const validGroupUpdates: ApprovedProductUpdate[] = [];
        const seenProductIds = new Set<string>();

        for (const item of group) {
          const rawId = (item.productId || item.id).trim();
          if (!rawId) {
            allItemResults.push({
              productId: item.id,
              ok: false,
              error: "Thiếu productId hợp lệ cho sản phẩm.",
              errorCode: "MISSING_PRODUCT_ID",
            });
            totalFailed++;
            continue;
          }

          if (seenProductIds.has(rawId)) {
            allItemResults.push({
              productId: rawId,
              ok: false,
              error: `Trùng lặp productId trong cùng đợt đồng bộ: ${rawId}`,
              errorCode: "DUPLICATE_PRODUCT_ID",
            });
            totalFailed++;
            continue;
          }

          const update = adaptViewModelToApprovedUpdate(item);
          if (!hasWritableChanges(update.patch)) {
            allItemResults.push({
              productId: rawId,
              ok: false,
              error: "Sản phẩm không có nội dung thay đổi để đồng bộ lên Shopify.",
              errorCode: "EMPTY_PATCH",
            });
            totalFailed++;
            continue;
          }

          seenProductIds.add(rawId);
          validGroupUpdates.push(update);
        }

        if (validGroupUpdates.length === 0) {
          continue;
        }

        try {
          const syncResult = await applyApprovedProductUpdates(moduleApiRunner, {
            workflowId,
            storeId,
            products: validGroupUpdates,
          });

          totalSuccess += syncResult.successCount;
          totalFailed += syncResult.failedCount;
          allItemResults.push(...syncResult.items);
        } catch (groupError) {
          const errMsg = groupError instanceof Error ? groupError.message : String(groupError);
          for (const validItem of validGroupUpdates) {
            allItemResults.push({
              productId: validItem.productId,
              ok: false,
              error: errMsg,
              errorCode: "SHOPIFY_SYNC_FAILED",
            });
            totalFailed++;
          }
        }
      }

      return {
        workflowId,
        requestedCount: items.length,
        successCount: totalSuccess,
        failedCount: totalFailed,
        items: allItemResults,
      };
    };

    const handleRollbackApprovedProducts = async (
      items: readonly SeoProductUiViewModel[],
    ): Promise<ApplyApprovedProductUpdatesResult> => {
      if (items.length === 0) {
        return {
          workflowId: `seo-rollback-${Date.now()}`,
          requestedCount: 0,
          successCount: 0,
          failedCount: 0,
          items: [],
        };
      }

      // Group products by storeId
      const itemsByStore = new Map<string, SeoProductUiViewModel[]>();
      let defaultStoreId: string | undefined = undefined;

      for (const item of items) {
        let targetStoreId = item.storeId?.trim();
        if (!targetStoreId) {
          if (!defaultStoreId) {
            try {
              const info = await autoSeoClient.getStoreInfo();
              if (info?.storeId) {
                defaultStoreId = info.storeId.trim();
              }
            } catch {
              // Ignore failure to fetch default store info
            }
          }
          targetStoreId = defaultStoreId;
        }

        const effectiveKey = targetStoreId || "__missing_store__";
        const group = itemsByStore.get(effectiveKey) ?? [];
        group.push(item);
        itemsByStore.set(effectiveKey, group);
      }

      const workflowId = `seo-rollback-${Date.now()}`;
      const allItemResults: ApprovedProductUpdateItemResult[] = [];
      let totalSuccess = 0;
      let totalFailed = 0;

      for (const [storeId, group] of itemsByStore.entries()) {
        if (storeId === "__missing_store__") {
          for (const item of group) {
            allItemResults.push({
              productId: (item.productId || item.id).trim(),
              ok: false,
              error: "Không tìm thấy storeId cho sản phẩm. Vui lòng kiểm tra cấu hình cửa hàng trong Auto SEO.",
              errorCode: "MISSING_STORE_ID",
            });
            totalFailed++;
          }
          continue;
        }

        const validGroupUpdates: ApprovedProductUpdate[] = [];
        const seenProductIds = new Set<string>();

        for (const item of group) {
          const rawId = (item.productId || item.id).trim();
          if (!rawId) {
            allItemResults.push({
              productId: item.id,
              ok: false,
              error: "Thiếu productId hợp lệ cho sản phẩm.",
              errorCode: "MISSING_PRODUCT_ID",
            });
            totalFailed++;
            continue;
          }

          if (seenProductIds.has(rawId)) {
            allItemResults.push({
              productId: rawId,
              ok: false,
              error: `Trùng lặp productId trong cùng đợt hoàn tác: ${rawId}`,
              errorCode: "DUPLICATE_PRODUCT_ID",
            });
            totalFailed++;
            continue;
          }

          const rollbackUpdate = adaptViewModelToRollbackUpdate(item);
          if (!rollbackUpdate) {
            allItemResults.push({
              productId: rawId,
              ok: false,
              error: "Không tìm thấy dữ liệu backup gốc để hoàn tác cho sản phẩm này.",
              errorCode: "MISSING_BACKUP",
            });
            totalFailed++;
            continue;
          }

          if (!hasWritableChanges(rollbackUpdate.patch)) {
            allItemResults.push({
              productId: rawId,
              ok: false,
              error: "Dữ liệu backup gốc không có nội dung hợp lệ để hoàn tác lên Shopify.",
              errorCode: "EMPTY_PATCH",
            });
            totalFailed++;
            continue;
          }

          seenProductIds.add(rawId);
          validGroupUpdates.push(rollbackUpdate);
        }

        if (validGroupUpdates.length === 0) {
          continue;
        }

        try {
          const rollbackResult = await applyApprovedProductUpdates(moduleApiRunner, {
            workflowId,
            storeId,
            products: validGroupUpdates,
          });

          totalSuccess += rollbackResult.successCount;
          totalFailed += rollbackResult.failedCount;
          allItemResults.push(...rollbackResult.items);
        } catch (groupError) {
          const errMsg = groupError instanceof Error ? groupError.message : String(groupError);
          for (const validItem of validGroupUpdates) {
            allItemResults.push({
              productId: validItem.productId,
              ok: false,
              error: errMsg,
              errorCode: "SHOPIFY_ROLLBACK_FAILED",
            });
            totalFailed++;
          }
        }
      }

      return {
        workflowId,
        requestedCount: items.length,
        successCount: totalSuccess,
        failedCount: totalFailed,
        items: allItemResults,
      };
    };

    const distributedCrawlerRoutes = amazonCrawlerRoutes(
      runAmazonCrawler,
      clearAmazonCrawlerCache,
      loadAmazonCrawlerClients,
      undefined,
      retryAmazonCrawlerSyncs,
      imageProcessingProfiles,
      amazonCrawlerJobs,
      loadAmazonCrawlerJob,
    );

    return createBrowserRouter([
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/amazon-crawler" replace />,
          },
          ...crawlerRoutes,
          ...distributedCrawlerRoutes,
          ...podRoutes,
          ...autoSeoRoutes,
          ...customizationRoutes,
          {
            path: "seo-review",
            element: (
              <SeoReviewPage
                amazonCrawlerReviews={amazonCrawlerReviews}
                moduleApiRunner={moduleApiRunner}
                onSyncApprovedProducts={handleSyncApprovedProducts}
                onRollbackApprovedProducts={handleRollbackApprovedProducts}
              />
            ),
          },
          {
            path: "workflow-demo",
            element: <HomePage runWorkflow={runWorkflow} />,
          },
          {
            path: "*",
            element: <NotFoundPage />,
          },
        ],
      },
    ]);
  }, [amazonCrawlerJobs, amazonCrawlerReviews, clearAmazonCrawlerCache, imageProcessingProfiles, loadAmazonCrawlerClients, loadAmazonCrawlerJob, retryAmazonCrawlerSyncs, runAmazonCrawler, runWorkflow]);

  return <RouterProvider router={router} />;
}
