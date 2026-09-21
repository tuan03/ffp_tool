import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerRunner } from "./types";

export function amazonCrawlerRoutes(runAmazonCrawler: AmazonCrawlerRunner, clearAmazonCrawlerCache: AmazonCrawlerCacheClearer): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: <AmazonCrawlerPage clearAmazonCrawlerCache={clearAmazonCrawlerCache} runAmazonCrawler={runAmazonCrawler} />,
    },
  ];
}
