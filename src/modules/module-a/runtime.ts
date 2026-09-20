import type { AppEnvironment } from "../../shared/types";
import { runMockModuleA } from "./mocks/runner";
import { runModuleA } from "./service";

export function getModuleARunner(environment: AppEnvironment): typeof runModuleA {
  return environment === "mock" ? runMockModuleA : runModuleA;
}
