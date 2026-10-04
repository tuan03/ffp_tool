import type { RouteObject } from "react-router-dom";

import { AuthenticatedCrawlerPage } from "./ui/AuthenticatedCrawlerPage";
import { AgentKeysPage } from "./ui/AgentKeysPage";
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
  operatorEngineUrl?: string,
): RouteObject[] {
  return [
    {
      path: "amazon-crawler",
      element: (
        <AuthenticatedCrawlerPage
          engineUrl={operatorEngineUrl}
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
    { path: "amazon-crawler/agent-keys", element: <AgentKeysPage /> },
  ];
}
