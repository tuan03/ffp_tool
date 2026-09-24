import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type {
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerHandoverHandler,
  AmazonCrawlerJobLoader,
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
  loadAmazonCrawlerJob?: AmazonCrawlerJobLoader,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: (
        <AmazonCrawlerPage
          clearAmazonCrawlerCache={clearAmazonCrawlerCache}
          imageProcessingProfiles={imageProcessingProfiles}
          loadAmazonCrawlerClients={loadAmazonCrawlerClients}
          loadAmazonCrawlerJob={loadAmazonCrawlerJob}
          onHandoverToSeo={onHandoverToSeo}
          retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs}
          runAmazonCrawler={runAmazonCrawler}
        />
      ),
    },
  ];
}
