import { AppRoutes } from "./routes/AppRoutes";
import { clearAmazonCrawlerCache, imageProcessingProfiles, loadAmazonCrawlerClients, loadAmazonCrawlerJob, retryAmazonCrawlerSyncs, runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes clearAmazonCrawlerCache={clearAmazonCrawlerCache} imageProcessingProfiles={imageProcessingProfiles} loadAmazonCrawlerClients={loadAmazonCrawlerClients} loadAmazonCrawlerJob={loadAmazonCrawlerJob} retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs} runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
