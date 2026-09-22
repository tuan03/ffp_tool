import { useMemo } from "react";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";

import { environment } from "../../config/environment";
import { AppLayout } from "../../layouts/AppLayout";
import { createAutoSeoRoutes } from "../../modules/auto-seo";
import { getModuleApiRunner } from "../../modules/module-api";
import { createAutoSeoModuleApiClient } from "../../modules/orchestrator";
import { createPinterestPodRoutes, getPinterestPodClient } from "../../modules/pinterest-pod";
import { createProductCrawlerRoutes, getProductCrawlerClient } from "../../modules/product-crawler";
import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";
import { HomePage } from "../../pages/home/HomePage";
import { NotFoundPage } from "../../pages/not-found/NotFoundPage";

interface AppRoutesProps {
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({ runWorkflow }: AppRoutesProps): React.JSX.Element {
  const router = useMemo(() => {
    const podClient = getPinterestPodClient(environment);
    const podRoutes = createPinterestPodRoutes(podClient);
    const crawlerClient = getProductCrawlerClient(environment);
    const crawlerRoutes = createProductCrawlerRoutes(crawlerClient);
    const moduleApiRunner = getModuleApiRunner(environment);
    const autoSeoClient = createAutoSeoModuleApiClient(moduleApiRunner);
    const autoSeoRoutes = createAutoSeoRoutes(autoSeoClient);

    return createBrowserRouter([
      {
        element: <AppLayout />,
        children: [
          {
            index: true,
            element: <Navigate to="/product-crawler" replace />,
          },
          ...crawlerRoutes,
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
  }, [runWorkflow]);

  return <RouterProvider router={router} />;
}
