import { amazonCrawlerCoordinatorUrl, environment } from "../../config/environment";
import { getAmazonCrawlerCacheClearer, getAmazonCrawlerClientsLoader, getAmazonCrawlerJobLoader, getAmazonCrawlerRunner, getAmazonCrawlerSyncRetrier, getImageProcessingProfileManager } from "../../modules/amazon-crawler";

export const runAmazonCrawler = getAmazonCrawlerRunner(environment, amazonCrawlerCoordinatorUrl);
export const clearAmazonCrawlerCache = getAmazonCrawlerCacheClearer(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerClients = getAmazonCrawlerClientsLoader(environment, amazonCrawlerCoordinatorUrl);
export const retryAmazonCrawlerSyncs = getAmazonCrawlerSyncRetrier(environment, amazonCrawlerCoordinatorUrl);
export const imageProcessingProfiles = getImageProcessingProfileManager(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerJob = getAmazonCrawlerJobLoader(environment, amazonCrawlerCoordinatorUrl);
