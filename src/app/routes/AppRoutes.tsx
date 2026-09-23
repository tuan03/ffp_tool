import { useMemo } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { environment } from "../../config/environment";
import { AppLayout } from "../../layouts/AppLayout";
import { amazonCrawlerRoutes } from "../../modules/amazon-crawler";
import { createAutoSeoRoutes } from "../../modules/auto-seo";
import { getModuleApiRunner } from "../../modules/module-api";
import { createAutoSeoModuleApiClient } from "../../modules/orchestrator";
import { createPinterestPodRoutes, getPinterestPodClient } from "../../modules/pinterest-pod";
import { createProductCrawlerRoutes, getProductCrawlerClient } from "../../modules/product-crawler";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerRunner, AmazonCrawlerSyncRetrier, ImageProcessingProfileManager } from "../../modules/amazon-crawler";
import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";
import { HomePage } from "../../pages/home/HomePage";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";

interface AppRoutesProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier;
  imageProcessingProfiles: ImageProcessingProfileManager;
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({
  clearAmazonCrawlerCache,
  loadAmazonCrawlerClients,
  retryAmazonCrawlerSyncs,
  imageProcessingProfiles,
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
    const autoSeoRoutes = createAutoSeoRoutes(autoSeoClient);
    const amazonRoutes = amazonCrawlerRoutes(
      runAmazonCrawler,
      clearAmazonCrawlerCache,
      loadAmazonCrawlerClients,
      retryAmazonCrawlerSyncs,
      imageProcessingProfiles,
    );

    return createBrowserRouter([
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/product-crawler" replace />,
          },
          ...crawlerRoutes,
          ...amazonRoutes,
          ...podRoutes,
          ...autoSeoRoutes,
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
  }, [clearAmazonCrawlerCache, imageProcessingProfiles, loadAmazonCrawlerClients, retryAmazonCrawlerSyncs, runAmazonCrawler, runWorkflow]);

  return <RouterProvider router={router} />;
}
