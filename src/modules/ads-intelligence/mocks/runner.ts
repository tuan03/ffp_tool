import type { AdsIntelligenceClient } from "../types";
import { mockCampaignHierarchy, mockChillgenSummary, mockCompetitorAds, mockDataHealth } from "./data";

export function createMockAdsIntelligenceClient(): AdsIntelligenceClient {
  return {
    async getStoreSummary(storeId = "chillgen") {
      return { ...mockChillgenSummary, storeId };
    },
    async getCampaignHierarchy() {
      return mockCampaignHierarchy;
    },
    async getDataHealth() {
      return mockDataHealth;
    },
    async getCompetitorAds() {
      return mockCompetitorAds;
    },
  };
}
