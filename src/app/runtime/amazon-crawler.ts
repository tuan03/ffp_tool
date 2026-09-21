import { amazonCrawlerEngineUrl, environment } from "../../config/environment";
import { getAmazonCrawlerRunner } from "../../modules/amazon-crawler";

export const runAmazonCrawler = getAmazonCrawlerRunner(environment, amazonCrawlerEngineUrl);
