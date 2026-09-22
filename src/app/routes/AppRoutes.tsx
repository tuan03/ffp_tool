import { useMemo } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { environment } from "../../config/environment";
import { AppLayout } from "../../layouts/AppLayout";
import { amazonCrawlerRoutes } from "../../modules/amazon-crawler";
import type {
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerRunner,
} from "../../modules/amazon-crawler";
import { createAutoSeoRoutes } from "../../modules/auto-seo";
import type { ShopifyProductForAutoSeoUi } from "../../modules/auto-seo";
import { getCustomizationNormalizerRunner } from "../../modules/customization-normalizer";
import type { CrawlProduct } from "../../modules/customization-normalizer";
import { getModuleApiRunner } from "../../modules/module-api";
import {
  createAutoSeoModuleApiClient,
  handoverAutoSeoToSeo,
  handoverCrawlerToSeo,
} from "../../modules/orchestrator";
import type {
  AutoSeoSourceProduct,
  WorkflowInput,
  WorkflowOutput,
} from "../../modules/orchestrator";
import { createPinterestPodRoutes, getPinterestPodClient } from "../../modules/pinterest-pod";
import { createProductCrawlerRoutes, getProductCrawlerClient } from "../../modules/product-crawler";
import { getSeoContentRunner } from "../../modules/seo-content";
import { HomePage } from "../../pages/home/HomePage";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";
import {
  adaptAutoSeoItemToViewModel,
  adaptCustomizationItemToViewModel,
  SeoReviewPage,
} from "../../pages/seo-review";
import type { SeoProductUiViewModel } from "../../pages/seo-review";
import type { AmazonCrawlerProduct } from "../../modules/amazon-crawler";

interface AppRoutesProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({
  clearAmazonCrawlerCache,
  loadAmazonCrawlerClients,
  runAmazonCrawler,
  runWorkflow,
}: AppRoutesProps): React.JSX.Element {
  const router = useMemo(() => {
    const podClient = getPinterestPodClient(environment);
    const podRoutes = createPinterestPodRoutes(podClient);
    const crawlerClient = getProductCrawlerClient(environment);
    const crawlerRoutes = createProductCrawlerRoutes(crawlerClient);
    const moduleApiRunner = getModuleApiRunner(environment);
    const autoSeoClient = createAutoSeoModuleApiClient(moduleApiRunner);
    const seoRunner = getSeoContentRunner(environment);

    const handleAutoSeoHandover = async (
      shopifyProducts: readonly ShopifyProductForAutoSeoUi[],
    ): Promise<void> => {
      const result = await handoverAutoSeoToSeo(
        {
          products: shopifyProducts as unknown as AutoSeoSourceProduct[],
        },
        {
          seoRunner,
        },
      );

      const newViewModels = result.items.map((item) =>
        adaptAutoSeoItemToViewModel(item),
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

    const handleHandoverToSeo = async (
      crawlerProducts: readonly AmazonCrawlerProduct[],
    ): Promise<void> => {
      const normalizer = getCustomizationNormalizerRunner(environment);

      const result = await handoverCrawlerToSeo(
        {
          products: crawlerProducts as unknown as CrawlProduct[],
        },
        {
          normalizer,
          seoRunner,
        },
      );

      const newViewModels = result.items.map((item) =>
        adaptCustomizationItemToViewModel(item),
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
            }),
          );
        } catch {
          // Ignore storage quota limits
        }
      }
    };

    const distributedCrawlerRoutes = amazonCrawlerRoutes(
      runAmazonCrawler,
      clearAmazonCrawlerCache,
      loadAmazonCrawlerClients,
      handleHandoverToSeo,
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
          {
            path: "seo-review",
            element: <SeoReviewPage />,
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
  }, [clearAmazonCrawlerCache, loadAmazonCrawlerClients, runAmazonCrawler, runWorkflow]);

  return <RouterProvider router={router} />;
}
