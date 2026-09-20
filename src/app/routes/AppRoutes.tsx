import { useMemo } from "react";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { AppLayout } from "../../layouts/AppLayout";
import type { WorkflowInput, WorkflowOutput } from "../../modules/orchestrator";
import { HomePage } from "../../pages/home/HomePage";

interface AppRoutesProps {
  runWorkflow(input: WorkflowInput): Promise<WorkflowOutput>;
}

export function AppRoutes({ runWorkflow }: AppRoutesProps): React.JSX.Element {
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
          ],
        },
      ]),
    [runWorkflow],
  );

  return <RouterProvider router={router} />;
}
