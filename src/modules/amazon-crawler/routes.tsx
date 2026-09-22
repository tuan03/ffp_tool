import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type {
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerHandoverHandler,
  AmazonCrawlerRunner,
} from "./types";

export function amazonCrawlerRoutes(
  runAmazonCrawler: AmazonCrawlerRunner,
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer,
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader,
  onHandoverToSeo?: AmazonCrawlerHandoverHandler,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: (
        <AmazonCrawlerPage
          clearAmazonCrawlerCache={clearAmazonCrawlerCache}
          loadAmazonCrawlerClients={loadAmazonCrawlerClients}
          onHandoverToSeo={onHandoverToSeo}
          runAmazonCrawler={runAmazonCrawler}
        />
      ),
    },
  ];
}
