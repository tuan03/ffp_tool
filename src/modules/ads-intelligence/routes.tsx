import type { RouteObject } from "react-router-dom";
import type { AdsIntelligenceClient } from "./types";
import { AdsIntelligencePage } from "./ui/AdsIntelligencePage";

export function createAdsIntelligenceRoutes(client: AdsIntelligenceClient): readonly RouteObject[] {
  return [
    {
      path: "ads-intelligence",
      element: <AdsIntelligencePage client={client} />,
    },
  ];
}
