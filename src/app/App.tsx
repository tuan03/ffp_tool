import { AppRoutes } from "./routes/AppRoutes";
import { clearAmazonCrawlerCache, loadAmazonCrawlerClients, runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes clearAmazonCrawlerCache={clearAmazonCrawlerCache} loadAmazonCrawlerClients={loadAmazonCrawlerClients} runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
