import { AppRoutes } from "./routes/AppRoutes";
import { clearAmazonCrawlerCache, loadAmazonCrawlerClients, retryAmazonCrawlerSyncs, runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes clearAmazonCrawlerCache={clearAmazonCrawlerCache} loadAmazonCrawlerClients={loadAmazonCrawlerClients} retryAmazonCrawlerSyncs={retryAmazonCrawlerSyncs} runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
