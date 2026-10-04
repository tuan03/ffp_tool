import type { RouteObject } from "react-router-dom";

import { AmazonReviewsPage } from "./ui/AmazonReviewsPage";
import type { ReviewClient, ReviewShopifyAccess } from "./types";

export function createAmazonReviewsRoutes(client: ReviewClient, shopify: ReviewShopifyAccess): RouteObject[] {
  return [{ path: "amazon-reviews", element: <AmazonReviewsPage client={client} shopify={shopify} /> }];
}
