import { createSeoPerformanceClient } from "./service";
import { createMockSeoPerformanceClient } from "./mocks/runner";
import type { SeoPerformanceClient } from "./types";

export function getSeoPerformanceClient(environment: "mock" | "development" | "production"): SeoPerformanceClient {
  return environment === "mock" ? createMockSeoPerformanceClient() : createSeoPerformanceClient();
}
