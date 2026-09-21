import type { AppEnvironment } from "../../shared/types";
import { runMockModuleB } from "./mocks/runner";
import { runModuleB } from "./service";

export function getModuleBRunner(environment: AppEnvironment): typeof runModuleB {
  return environment === "mock" ? runMockModuleB : runModuleB;
}
