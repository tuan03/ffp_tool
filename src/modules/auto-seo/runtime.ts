import type { AppEnvironment } from "../../shared/types";
import { runMockAutoSeo } from "./mocks/runner";
import { runAutoSeo } from "./service";

export function getAutoSeoRunner(
  environment: AppEnvironment,
): typeof runAutoSeo {
  return environment === "mock" ? runMockAutoSeo : runAutoSeo;
}
