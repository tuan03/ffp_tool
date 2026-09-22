import type { AppEnvironment } from "../../shared/types";

import { runMockSeoContent } from "./mocks/runner";
import { runSeoContent } from "./service";

export function getSeoContentRunner(environment: AppEnvironment): typeof runSeoContent {
  return environment === "mock" ? runMockSeoContent : runSeoContent;
}
