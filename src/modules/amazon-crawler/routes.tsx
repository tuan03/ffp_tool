import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerRunner } from "./types";

export function amazonCrawlerRoutes(runAmazonCrawler: AmazonCrawlerRunner, clearAmazonCrawlerCache: AmazonCrawlerCacheClearer, loadAmazonCrawlerClients: AmazonCrawlerClientsLoader): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: <AmazonCrawlerPage clearAmazonCrawlerCache={clearAmazonCrawlerCache} loadAmazonCrawlerClients={loadAmazonCrawlerClients} runAmazonCrawler={runAmazonCrawler} />,
    },
  ];
}
