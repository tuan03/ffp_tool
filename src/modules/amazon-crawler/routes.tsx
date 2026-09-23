import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type {
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerHandoverHandler,
  AmazonCrawlerRunner,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfileManager,
} from "./types";

export function amazonCrawlerRoutes(
  runAmazonCrawler: AmazonCrawlerRunner,
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer,
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader,
  onHandoverToSeo?: AmazonCrawlerHandoverHandler,
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier = async () => ({ retried: 0 }),
  imageProcessingProfiles?: ImageProcessingProfileManager,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: (
        <AmazonCrawlerPage
          clearAmazonCrawlerCache={clearAmazonCrawlerCache}
          imageProcessingProfiles={imageProcessingProfiles}
          loadAmazonCrawlerClients={loadAmazonCrawlerClients}
          onHandoverToSeo={onHandoverToSeo}
          retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs}
          runAmazonCrawler={runAmazonCrawler}
        />
      ),
    },
  ];
}
