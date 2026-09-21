import { AppRoutes } from "./routes/AppRoutes";
import { runAmazonCrawler } from "./runtime/amazon-crawler";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes runAmazonCrawler={runAmazonCrawler} runWorkflow={runWorkflow} />;
}
