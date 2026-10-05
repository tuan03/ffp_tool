import { createAdsIntelligenceClient } from "./service";
import { createMockAdsIntelligenceClient } from "./mocks/runner";
import type { AdsIntelligenceClient } from "./types";

export function getAdsIntelligenceClient(environment: "mock" | "development" | "production"): AdsIntelligenceClient {
  return environment === "mock" ? createMockAdsIntelligenceClient() : createAdsIntelligenceClient();
}
