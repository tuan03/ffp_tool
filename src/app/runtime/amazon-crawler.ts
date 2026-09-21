import { amazonCrawlerEngineUrl, environment } from "../../config/environment";
import { getAmazonCrawlerCacheClearer, getAmazonCrawlerRunner } from "../../modules/amazon-crawler";

export const runAmazonCrawler = getAmazonCrawlerRunner(environment, amazonCrawlerEngineUrl);
export const clearAmazonCrawlerCache = getAmazonCrawlerCacheClearer(environment, amazonCrawlerEngineUrl);
