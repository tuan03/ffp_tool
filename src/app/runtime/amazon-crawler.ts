import { amazonCrawlerCoordinatorUrl, amazonCrawlerReleaseApiUrl, environment } from "../../config/environment";
import { getAmazonCrawlerAgentReleaseLoader, getAmazonCrawlerCacheClearer, getAmazonCrawlerClientsLoader, getAmazonCrawlerJobController, getAmazonCrawlerJobLoader, getAmazonCrawlerReviewClient, getAmazonCrawlerRunner, getAmazonCrawlerSyncRetrier, getImageProcessingProfileManager } from "../../modules/amazon-crawler";

export const runAmazonCrawler = getAmazonCrawlerRunner(environment, amazonCrawlerCoordinatorUrl);
export const clearAmazonCrawlerCache = getAmazonCrawlerCacheClearer(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerClients = getAmazonCrawlerClientsLoader(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerAgentRelease = getAmazonCrawlerAgentReleaseLoader(environment, amazonCrawlerReleaseApiUrl);
export const amazonCrawlerJobs = getAmazonCrawlerJobController(environment, amazonCrawlerCoordinatorUrl);
export const retryAmazonCrawlerSyncs = getAmazonCrawlerSyncRetrier(environment, amazonCrawlerCoordinatorUrl);
export const imageProcessingProfiles = getImageProcessingProfileManager(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerJob = getAmazonCrawlerJobLoader(environment, amazonCrawlerCoordinatorUrl);
export const amazonCrawlerReviews = getAmazonCrawlerReviewClient(environment, amazonCrawlerCoordinatorUrl);
