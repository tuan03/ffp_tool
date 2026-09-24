import { AppRoutes } from "./routes/AppRoutes";
import { amazonCrawlerJobs, clearAmazonCrawlerCache, imageProcessingProfiles, loadAmazonCrawlerClients, loadAmazonCrawlerJob, retryAmazonCrawlerSyncs, runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes amazonCrawlerJobs={amazonCrawlerJobs} clearAmazonCrawlerCache={clearAmazonCrawlerCache} imageProcessingProfiles={imageProcessingProfiles} loadAmazonCrawlerClients={loadAmazonCrawlerClients} loadAmazonCrawlerJob={loadAmazonCrawlerJob} retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs} runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
