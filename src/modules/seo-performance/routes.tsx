import type { RouteObject } from "react-router-dom";

import type { SeoPerformanceClient } from "./types";
import { SeoPerformancePage } from "./ui/SeoPerformancePage";

export function createSeoPerformanceRoutes(client: SeoPerformanceClient): readonly RouteObject[] {
  return [{ path: "seo-performance", element: <SeoPerformancePage client={client} /> }];
}
