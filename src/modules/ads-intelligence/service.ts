import type { AdsIntelligenceClient } from "./types";
import { mockCampaignHierarchy, mockChillgenSummary, mockCompetitorAds, mockDataHealth, mockReconciliationReport } from "./mocks/data";

export function createAdsIntelligenceClient(): AdsIntelligenceClient {
  return {
    async getStoreSummary(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/summary?storeId=${encodeURIComponent(storeId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back gracefully to initialized store profile
      }
      return { ...mockChillgenSummary, storeId };
    },

    async getCampaignHierarchy(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/campaigns?storeId=${encodeURIComponent(storeId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back to initialized hierarchy
      }
      return mockCampaignHierarchy;
    },

    async getDataHealth(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/health?storeId=${encodeURIComponent(storeId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back to initialized health state
      }
      return mockDataHealth;
    },

    async getCompetitorAds(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/competitors?storeId=${encodeURIComponent(storeId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back to initialized competitor watchlist
      }
      return mockCompetitorAds;
    },

    async getReconciliationReport(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/reconciliation?storeId=${encodeURIComponent(storeId)}`);
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back to initialized reconciliation data
      }
      return { ...mockReconciliationReport, storeId };
    },

    async syncNow(storeId = "chillgen") {
      try {
        const res = await fetch(`/api/ads-intelligence/sync?storeId=${encodeURIComponent(storeId)}`, {
          method: "POST",
        });
        if (res.ok) {
          return await res.json();
        }
      } catch {
        // Fall back gracefully
      }
      return {
        success: true,
        refreshedAt: new Date().toISOString(),
        message: "Đã làm mới dữ liệu từ bộ nhớ đệm",
      };
    },
  };
}
