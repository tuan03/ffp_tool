import type { RouteObject } from "react-router-dom";
import type { PinterestPodClient, PinterestPodDeliverables } from "./types";
import { PinterestPodStudio } from "./ui/PinterestPodStudio";
import { PinterestOperatorBoundary } from "./ui/PinterestOperatorBoundary";

export function createPinterestPodRoutes(
  client?: PinterestPodClient,
  onHandoverToSeo?: (payload: PinterestPodDeliverables, serverViewModels?: readonly unknown[]) => Promise<void>,
  agentInstallServerUrl?: string,
  operatorAuthEnabled = true,
): readonly RouteObject[] {
  return [
    {
      path: "pinterest-pod",
      element: (
        <PinterestOperatorBoundary enabled={operatorAuthEnabled}><PinterestPodStudio
          client={client}
          onHandoverToSeo={onHandoverToSeo}
          agentInstallServerUrl={agentInstallServerUrl}
        /></PinterestOperatorBoundary>
      ),
    },
  ];
}

export const pinterestPodRoutes: readonly RouteObject[] = createPinterestPodRoutes();
