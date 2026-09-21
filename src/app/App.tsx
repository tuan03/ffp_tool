import { AppRoutes } from "./routes/AppRoutes";
import { clearAmazonCrawlerCache, runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes clearAmazonCrawlerCache={clearAmazonCrawlerCache} runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
