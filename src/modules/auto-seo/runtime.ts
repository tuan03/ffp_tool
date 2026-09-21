import type { AppEnvironment } from "../../shared/types";
import { MockAutoSeoClient, runMockAutoSeo } from "./mocks/runner";
import { RealAutoSeoClient, runAutoSeo } from "./service";
import type { AutoSeoClient } from "./types";

export function getAutoSeoRunner(
  environment: AppEnvironment,
): typeof runAutoSeo {
  return environment === "mock" ? runMockAutoSeo : runAutoSeo;
}

export function getAutoSeoClient(environment: AppEnvironment): AutoSeoClient {
  if (environment === "mock") {
    return new MockAutoSeoClient();
  }

  return new RealAutoSeoClient();
}
