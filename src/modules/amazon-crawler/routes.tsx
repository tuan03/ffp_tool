import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type {
  AmazonCrawlerAgentReleaseLoader,
  AmazonCrawlerCacheClearer,
  AmazonCrawlerClientsLoader,
  AmazonCrawlerHandoverHandler,
  AmazonCrawlerJobController,
  AmazonCrawlerJobLoader,
  AmazonCrawlerRunner,
  AmazonCrawlerSyncRetrier,
  ImageProcessingProfileManager,
} from "./types";

export function amazonCrawlerRoutes(
  runAmazonCrawler: AmazonCrawlerRunner,
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer,
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader,
  loadAmazonCrawlerAgentRelease: AmazonCrawlerAgentReleaseLoader,
  onHandoverToSeo?: AmazonCrawlerHandoverHandler,
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier = async () => ({ retried: 0 }),
  imageProcessingProfiles?: ImageProcessingProfileManager,
  amazonCrawlerJobs?: AmazonCrawlerJobController,
  loadAmazonCrawlerJob?: AmazonCrawlerJobLoader,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: (
        <AmazonCrawlerPage
          amazonCrawlerJobs={amazonCrawlerJobs}
          clearAmazonCrawlerCache={clearAmazonCrawlerCache}
          imageProcessingProfiles={imageProcessingProfiles}
          loadAmazonCrawlerClients={loadAmazonCrawlerClients}
          loadAmazonCrawlerAgentRelease={loadAmazonCrawlerAgentRelease}
          loadAmazonCrawlerJob={loadAmazonCrawlerJob}
          onHandoverToSeo={onHandoverToSeo}
          retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs}
          runAmazonCrawler={runAmazonCrawler}
        />
      ),
    },
  ];
}
