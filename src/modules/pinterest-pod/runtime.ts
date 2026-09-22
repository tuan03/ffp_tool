import type { AppEnvironment } from "../../shared/types";
import {
  cancelMockJob,
  getMockAuthStatus,
  getMockJobStatus,
  launchMockLogin,
  mockPinterestPodClient,
  runMockDiscovery,
  runMockProduction,
} from "./mocks/runner";
import {
  cancelJob,
  getAuthStatus,
  getJobStatus,
  launchLogin,
  realPinterestPodClient,
  runDiscovery,
  runProduction,
} from "./service";
import type { PinterestPodClient } from "./types";

export interface PinterestPodModuleRunner {
  readonly runDiscovery: typeof runDiscovery;
  readonly runProduction: typeof runProduction;
  readonly getAuthStatus: typeof getAuthStatus;
  readonly launchLogin: typeof launchLogin;
  readonly cancelJob: typeof cancelJob;
  readonly getJobStatus: typeof getJobStatus;
}

export function getPinterestPodClient(environment: AppEnvironment): PinterestPodClient {
  return environment === "mock" ? mockPinterestPodClient : realPinterestPodClient;
}

export function getDiscoveryRunner(environment: AppEnvironment): typeof runDiscovery {
  return environment === "mock" ? runMockDiscovery : runDiscovery;
}

export function getProductionRunner(environment: AppEnvironment): typeof runProduction {
  return environment === "mock" ? runMockProduction : runProduction;
}

export function getPinterestAuthRunner(environment: AppEnvironment): typeof getAuthStatus {
  return environment === "mock" ? getMockAuthStatus : getAuthStatus;
}

export function getPinterestPodRunner(environment: AppEnvironment): PinterestPodModuleRunner {
  if (environment === "mock") {
    return {
      runDiscovery: runMockDiscovery,
      runProduction: runMockProduction,
      getAuthStatus: getMockAuthStatus,
      launchLogin: launchMockLogin,
      cancelJob: cancelMockJob,
      getJobStatus: getMockJobStatus,
    };
  }

  return {
    runDiscovery,
    runProduction,
    getAuthStatus,
    launchLogin,
    cancelJob,
    getJobStatus,
  };
}
