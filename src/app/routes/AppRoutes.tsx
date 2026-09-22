import { useMemo } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppLayout } from "../../layouts/AppLayout";
import { amazonCrawlerRoutes } from "../../modules/amazon-crawler";
import { HomePage } from "../../pages/home/HomePage";

import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerRunner, AmazonCrawlerSyncRetrier } from "../../modules/amazon-crawler";
import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";

interface AppRoutesProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier;
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({ clearAmazonCrawlerCache, loadAmazonCrawlerClients, retryAmazonCrawlerSyncs, runAmazonCrawler, runWorkflow }: AppRoutesProps): React.JSX.Element {
  const router = useMemo(
    () =>
      createBrowserRouter([
        {
          element: <AppLayout />,
          children: [
            {
              index: true,
              element: <HomePage runWorkflow={runWorkflow} />,
            },
            ...amazonCrawlerRoutes(runAmazonCrawler, clearAmazonCrawlerCache, loadAmazonCrawlerClients, retryAmazonCrawlerSyncs),
            {
              path: "*",
              element: <p className="mt-8 text-lg text-slate-300">Không tìm thấy trang.</p>,
            },
          ],
        },
      ]),
    [clearAmazonCrawlerCache, loadAmazonCrawlerClients, retryAmazonCrawlerSyncs, runAmazonCrawler, runWorkflow],
  );

  return <RouterProvider router={router} />;
}
