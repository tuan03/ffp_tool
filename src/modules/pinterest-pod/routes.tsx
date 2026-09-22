import type { RouteObject } from "react-router-dom";
import type { PinterestPodClient } from "./types";
import { PinterestPodStudio } from "./ui/PinterestPodStudio";

export function createPinterestPodRoutes(client?: PinterestPodClient): readonly RouteObject[] {
  return [
    {
      path: "pinterest-pod",
      element: <PinterestPodStudio client={client} />,
    },
  ];
}

export const pinterestPodRoutes: readonly RouteObject[] = createPinterestPodRoutes();
