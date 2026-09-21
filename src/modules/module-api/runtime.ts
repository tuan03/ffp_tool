import type { AppEnvironment } from "../../shared/types";

import { runMockModuleApi } from "./mocks/runner";
import { createModuleApiRunner, runModuleApi } from "./service";
import type { ModuleApiConfig, ModuleApiDependencies, ModuleApiRunner } from "./types";

export function getModuleApiRunner(
  environment: AppEnvironment,
  config?: ModuleApiConfig,
  dependencies?: ModuleApiDependencies,
): ModuleApiRunner {
  if (environment === "mock") {
    return runMockModuleApi;
  }

  if (config || dependencies) {
    return createModuleApiRunner(config, dependencies);
  }

  return runModuleApi;
}
