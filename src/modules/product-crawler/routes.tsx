import type { RouteObject } from "react-router-dom";

import type { ProductCrawlerClient } from "./types";
import { ProductCrawlerPage } from "./ui/ProductCrawlerPage";

export function createProductCrawlerRoutes(
  client?: ProductCrawlerClient,
): readonly RouteObject[] {
  return [
    {
      path: "product-crawler",
      element: <ProductCrawlerPage client={client} />,
    },
  ];
}

export const productCrawlerRoutes: readonly RouteObject[] = createProductCrawlerRoutes();
