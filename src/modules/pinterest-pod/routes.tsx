import type { RouteObject } from "react-router-dom";
import type { PinterestPodClient, PinterestPodDeliverables } from "./types";
import { PinterestPodStudio } from "./ui/PinterestPodStudio";

export function createPinterestPodRoutes(
  client?: PinterestPodClient,
  onHandoverToSeo?: (payload: PinterestPodDeliverables, serverViewModels?: readonly unknown[]) => Promise<void>,
  agentInstallServerUrl?: string,
): readonly RouteObject[] {
  return [
    {
      path: "pinterest-pod",
      element: (
        <PinterestPodStudio
          client={client}
          onHandoverToSeo={onHandoverToSeo}
          agentInstallServerUrl={agentInstallServerUrl}
        />
      ),
    },
  ];
}

export const pinterestPodRoutes: readonly RouteObject[] = createPinterestPodRoutes();
