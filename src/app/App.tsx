import { AppRoutes } from "./routes/AppRoutes";
import { runWorkflow } from "./runtime/workflow";

export function App(): React.JSX.Element {
  return <AppRoutes runWorkflow={runWorkflow} />;
}
