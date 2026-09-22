import { AppError } from "../../shared/errors/app-error";
import type { AppEnvironment } from "../../shared/types";
import { MockAutoSeoClient, runMockAutoSeo } from "./mocks/runner";
import { runAutoSeo } from "./service";
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

  throw new AppError(
    "Direct AutoSeoClient construction is deprecated in development/production. " +
      "Use createAutoSeoModuleApiClient(getModuleApiRunner(environment)) from orchestrator instead.",
    "AUTO_SEO_LOAD_FAILED",
  );
}
