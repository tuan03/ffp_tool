import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type { AmazonCrawlerRunner } from "./types";

export function amazonCrawlerRoutes(runAmazonCrawler: AmazonCrawlerRunner): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: <AmazonCrawlerPage runAmazonCrawler={runAmazonCrawler} />,
    },
  ];
}
