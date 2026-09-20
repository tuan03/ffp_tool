import type { AppEnvironment } from "../../shared/types";
import { runMockModuleC } from "./mocks/runner";
import { runModuleC } from "./service";

export function getModuleCRunner(environment: AppEnvironment): typeof runModuleC {
  return environment === "mock" ? runMockModuleC : runModuleC;
}
