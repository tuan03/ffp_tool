import type { AppEnvironment } from "../../shared/types";

import { runMockModuleApi } from "./mocks/runner";
import { runModuleApi } from "./service";
import type { ModuleApiRunner } from "./types";

export function getModuleApiRunner(environment: AppEnvironment): ModuleApiRunner {
  return environment === "mock" ? runMockModuleApi : runModuleApi;
}
