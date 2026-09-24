import type { RouteObject } from "react-router-dom";

import { AmazonCrawlerPage } from "./ui/AmazonCrawlerPage";
import type { AmazonCrawlerCacheClearer, AmazonCrawlerClientsLoader, AmazonCrawlerJobController, AmazonCrawlerRunner, AmazonCrawlerSyncRetrier, ImageProcessingProfileManager } from "./types";

export function amazonCrawlerRoutes(
  runAmazonCrawler: AmazonCrawlerRunner,
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer,
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader,
  retryAmazonCrawlerSyncs: AmazonCrawlerSyncRetrier = async () => ({ retried: 0 }),
  imageProcessingProfiles?: ImageProcessingProfileManager,
  amazonCrawlerJobs?: AmazonCrawlerJobController,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: <AmazonCrawlerPage amazonCrawlerJobs={amazonCrawlerJobs} clearAmazonCrawlerCache={clearAmazonCrawlerCache} imageProcessingProfiles={imageProcessingProfiles} loadAmazonCrawlerClients={loadAmazonCrawlerClients} retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs} runAmazonCrawler={runAmazonCrawler} />,
    },
  ];
}
