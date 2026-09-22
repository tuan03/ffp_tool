import { useMemo } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppLayout } from "../../layouts/AppLayout";
import { amazonCrawlerRoutes } from "../../modules/amazon-crawler";
import { HomePage } from "../../pages/home/HomePage";

import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerRunner } from "../../modules/amazon-crawler";
import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";

interface AppRoutesProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({ clearAmazonCrawlerCache, loadAmazonCrawlerClients, runAmazonCrawler, runWorkflow }: AppRoutesProps): React.JSX.Element {
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
            ...amazonCrawlerRoutes(runAmazonCrawler, clearAmazonCrawlerCache, loadAmazonCrawlerClients),
            {
              path: "*",
              element: <p className="mt-8 text-lg text-slate-300">Không tìm thấy trang.</p>,
            },
          ],
        },
      ]),
    [clearAmazonCrawlerCache, loadAmazonCrawlerClients, runAmazonCrawler, runWorkflow],
  );

  return <RouterProvider router={router} />;
}
