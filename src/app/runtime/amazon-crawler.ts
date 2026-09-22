import { amazonCrawlerCoordinatorUrl, environment } from "../../config/environment";
import { getAmazonCrawlerCacheClearer, getAmazonCrawlerClientsLoader, getAmazonCrawlerRunner } from "../../modules/amazon-crawler";

export const runAmazonCrawler = getAmazonCrawlerRunner(environment, amazonCrawlerCoordinatorUrl);
export const clearAmazonCrawlerCache = getAmazonCrawlerCacheClearer(environment, amazonCrawlerCoordinatorUrl);
export const loadAmazonCrawlerClients = getAmazonCrawlerClientsLoader(environment, amazonCrawlerCoordinatorUrl);
