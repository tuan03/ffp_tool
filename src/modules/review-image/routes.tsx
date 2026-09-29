import type { RouteObject } from "react-router-dom";

import type { ReviewImageClient } from "./types";
import { ReviewImagePage } from "./ui/ReviewImagePage";

export function createReviewImageRoutes(client: ReviewImageClient): RouteObject[] {
  return [{ path: "review-images", element: <ReviewImagePage client={client} /> }];
}
