import type { AdsIntelligenceClient } from "../types";
import { mockCampaignHierarchy, mockChillgenSummary, mockCompetitorAds, mockDataHealth } from "./data";

export function createMockAdsIntelligenceClient(): AdsIntelligenceClient {
  return {
    dataMode: "mock",
    async getStores() { return [{ storeId: "chillgen", shopDomain: "demo.myshopify.com", hasProxy: false }]; },
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
    async syncNow() {
      return {
        success: true,
        refreshedAt: new Date().toISOString(),
        message: "Mock data refreshed successfully",
      };
    },
  };
}
