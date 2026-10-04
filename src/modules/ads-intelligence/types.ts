export interface AdsStoreSummary {
  readonly storeId: string;
  readonly accountId: string;
  readonly accountName: string;
  readonly currency: string;
  readonly timezone: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly maturity: "PROVISIONAL" | "FINALIZED";
  readonly spend: string;
  readonly impressions: string;
  readonly clicks: string;
  readonly linkClicks: string;
  readonly linkCtr: string;
  readonly cpc: string;
  readonly cpm: string;
  readonly lpv: string;
  readonly atc: string;
  readonly checkout: string;
  readonly purchases: string;
  readonly purchaseValue: string;
  readonly cpa: string | null;
  readonly roas: string | null;
  readonly warnings: readonly string[];
}

export interface AdsHierarchyAd {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly effectiveStatus: string;
  readonly spend: string;
  readonly impressions: string;
  readonly linkClicks: string;
  readonly linkCtr: string;
  readonly purchases: string;
  readonly purchaseValue: string;
  readonly cpa: string | null;
  readonly roas: string | null;
}

export interface AdsHierarchyAdSet {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly effectiveStatus: string;
  readonly dailyBudget: string | null;
  readonly optimizationGoal: string;
  readonly spend: string;
  readonly purchases: string;
  readonly cpa: string | null;
  readonly roas: string | null;
  readonly ads: readonly AdsHierarchyAd[];
}

export interface AdsHierarchyCampaign {
  readonly id: string;
  readonly name: string;
  readonly status: string;
  readonly effectiveStatus: string;
  readonly objective: string;
  readonly budgetType: "CAMPAIGN" | "ADSET";
  readonly dailyBudget: string | null;
  readonly spend: string;
  readonly purchases: string;
  readonly purchaseValue: string;
  readonly cpa: string | null;
  readonly roas: string | null;
  readonly adsets: readonly AdsHierarchyAdSet[];
}

export interface CompetitorAdCard {
  readonly pageName: string;
  readonly archiveId: string;
  readonly caption: string;
  readonly headline: string;
  readonly cta: string;
  readonly mediaType: "IMAGE" | "VIDEO" | "CAROUSEL";
  readonly thumbnailUrl: string;
  readonly inspectionLevel: "THUMBNAIL_ONLY" | "IMAGE_REVIEWED" | "VIDEO_AND_AUDIO_REVIEWED";
  readonly firstSeen: string;
  readonly status: "ACTIVE" | "INACTIVE";
}

export interface AdsDataHealth {
  readonly metaConnection: {
    readonly status: "CONNECTED" | "ERROR";
    readonly accountId: string;
    readonly accountName: string;
    readonly proxyProfile: string;
    readonly apiVersion: string;
  };
  readonly ga4Connection: {
    readonly status: "CONNECTED" | "PENDING";
    readonly propertyId: string;
    readonly serviceAccount: string;
  };
  readonly competitorProvider: {
    readonly provider: string;
    readonly status: "ACTIVE";
    readonly remainingCredits: number;
  };
  readonly maturity: {
    readonly status: "PROVISIONAL" | "FINALIZED";
    readonly reason: string;
    readonly blockedDecisions: readonly string[];
  };
}

export interface AdsIntelligenceClient {
  getStoreSummary(storeId?: string): Promise<AdsStoreSummary>;
  getCampaignHierarchy(storeId?: string): Promise<readonly AdsHierarchyCampaign[]>;
  getDataHealth(storeId?: string): Promise<AdsDataHealth>;
  getCompetitorAds(storeId?: string): Promise<readonly CompetitorAdCard[]>;
}
