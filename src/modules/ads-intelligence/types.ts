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
  readonly fromCache?: boolean;
  readonly cachedAt?: string;
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

export interface AdsReconciliationReport {
  readonly storeId: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly meta: {
    readonly spend: string;
    readonly impressions: string;
    readonly linkClicks: string;
    readonly purchases: string;
    readonly purchaseValue: string;
    readonly cpa: string | null;
    readonly roas: string | null;
  };
  readonly ga4: {
    readonly status: "CONNECTED" | "ERROR" | "PENDING";
    readonly sessions: number;
    readonly ecommercePurchases: number;
    readonly purchaseRevenue: number;
    readonly clickToSessionDropPct: string;
  };
  readonly shopify: {
    readonly status: "CONNECTED" | "NOT_CONFIGURED" | "ESTIMATED";
    readonly totalOrders: number;
    readonly grossSales: string;
    readonly totalRefunds: string;
    readonly netSales: string;
    readonly averageOrderValue: string;
    readonly mer: string | null;
    readonly blendedCpa: string | null;
    readonly source: string;
  };
  readonly gaps: {
    readonly purchaseDiscrepancy: number;
    readonly revenueDiscrepancy: string;
    readonly clickDropPct: string;
    readonly notes: readonly string[];
  };
  readonly fromCache?: boolean;
  readonly cachedAt?: string;
}

export type DecisionType =
  | "WAIT"
  | "KEEP"
  | "SCALE_CANDIDATE"
  | "REDUCE_CANDIDATE"
  | "PAUSE_CANDIDATE"
  | "TEST_CREATIVE"
  | "CHECK_LANDING"
  | "CHECK_OFFER"
  | "CHECK_CHECKOUT"
  | "INVESTIGATE_TRACKING";

export type DecisionPriority = "HIGH" | "MEDIUM" | "LOW";

export type DecisionConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface DecisionObservation {
  readonly metric: string;
  readonly current: string | number;
  readonly benchmark: string | number;
  readonly baseline?: string | number;
  readonly unit: string;
  readonly evidenceId?: string;
}

export interface DecisionCard {
  readonly id: string;
  readonly storeId: string;
  readonly entity: {
    readonly type: "account" | "campaign" | "adset" | "ad" | "store";
    readonly id: string;
    readonly name: string;
  };
  readonly decision: DecisionType;
  readonly priority: DecisionPriority;
  readonly confidence: DecisionConfidence;
  readonly title: string;
  readonly summary: string;
  readonly observations: readonly DecisionObservation[];
  readonly hypotheses: readonly string[];
  readonly missingEvidence?: readonly string[];
  readonly recommendedNextStep: string;
  readonly blockedActions: readonly string[];
  readonly reviewTrigger: string;
  readonly policyVersion?: string;
  readonly createdAt?: string;
}

export interface CreativeBriefIdea {
  readonly targetAdId?: string;
  readonly targetAdName?: string;
  readonly angle: string;
  readonly coreProblem: string;
  readonly hooks: readonly [string, string, string];
  readonly visualDirection: string;
  readonly callToAction: string;
}

export interface AiStrategicReport {
  readonly storeId: string;
  readonly generatedAt: string;
  readonly modelUsed: string;
  readonly fromCache?: boolean;
  readonly executiveSummary: {
    readonly overallHealth: "HEALTHY" | "WATCH" | "CRITICAL";
    readonly merVerdict: string;
    readonly profitLossDiagnosis: string;
    readonly totalDecisionsCount: number;
    readonly highPriorityActionCount: number;
  };
  readonly rootCauseHypotheses: readonly {
    readonly entityId: string;
    readonly entityName: string;
    readonly entityType: string;
    readonly verdict: string;
    readonly primaryHypothesis: string;
    readonly counterHypothesis: string;
    readonly recommendedExperiment: string;
  }[];
  readonly creativeBriefs: readonly CreativeBriefIdea[];
  readonly rawAnalysisText?: string;
}

export interface CompetitorAd {
  readonly archiveAdId: string;
  readonly pageId: string;
  readonly pageName: string;
  readonly status: "ACTIVE" | "INACTIVE";
  readonly startDate: string;
  readonly firstSeen: string;
  readonly lastSeen: string;
  readonly daysActive: number;
  readonly copy: string;
  readonly headline: string;
  readonly cta: string;
  readonly landingUrl: string;
  readonly mediaType: "VIDEO" | "IMAGE" | "CAROUSEL";
  readonly mediaUrls: readonly string[];
  readonly thumbnailUrl: string;
  readonly cards?: readonly { readonly headline?: string; readonly body?: string; readonly mediaUrl?: string; readonly linkUrl?: string }[];
  readonly provider: string;
  readonly retrievedAt: string;
  readonly costEstimatedUsd: number;
  readonly inspectionLevel: "TEXT_ONLY" | "THUMBNAIL_ONLY" | "IMAGE_REVIEWED" | "SAMPLED_FRAMES" | "VIDEO_AND_AUDIO_REVIEWED";
  readonly taxonomy: {
    readonly niche: string;
    readonly format: "VIDEO" | "IMAGE" | "CAROUSEL";
    readonly hookType: "UNBOXING" | "PROBLEM_AGITATION" | "BEFORE_AFTER" | "FOUNDER_STORY" | "SOCIAL_PROOF" | "AESTHETIC_SHOWCASE" | "DISCOUNT_OFFER" | "UNKNOWN";
    readonly angle: string;
    readonly visualStyle: "UGC_LOFI" | "STUDIO_PRO" | "GRAPHIC_OVERLAY" | "3D_RENDER";
    readonly offer: string;
  };
}

export interface CreativeGap {
  readonly id: string;
  readonly patternName: string;
  readonly hookType: string;
  readonly visualStyle: string;
  readonly format: string;
  readonly competitorOccurrences: number;
  readonly competitorNames: readonly string[];
  readonly sampleCompetitorAds: readonly {
    readonly pageName: string;
    readonly archiveAdId: string;
    readonly daysActive: number;
    readonly headline: string;
    readonly mediaUrl?: string;
  }[];
  readonly ownStatus: "UNTESTED" | "TESTING" | "TESTED_FAILED" | "TESTED_WON";
  readonly whyTestNext: string;
  readonly limitation: string;
  readonly suggestedBrief: {
    readonly hookAngle: string;
    readonly storyboardIdea: string;
    readonly recommendedFormat: string;
    readonly callToAction: string;
  };
}

export interface CompetitorIntelligenceReport {
  readonly storeId: string;
  readonly watchlist: readonly {
    readonly pageId: string;
    readonly pageName: string;
    readonly adCount: number;
    readonly activeAdCount: number;
  }[];
  readonly totalAds: number;
  readonly activeAds: number;
  readonly provider: string;
  readonly syncCostEstimatedUsd: number;
  readonly monthlyCostCapUsd: number;
  readonly transparencyDisclaimer: string;
  readonly ads: readonly CompetitorAd[];
  readonly creativeGaps: readonly CreativeGap[];
  readonly topWinningHooks: readonly {
    readonly hookType: string;
    readonly count: number;
    readonly avgDaysActive: number;
    readonly description: string;
  }[];
  readonly formatDistribution: readonly {
    readonly format: string;
    readonly percentage: number;
    readonly count: number;
  }[];
  readonly fromCache?: boolean;
  readonly cachedAt?: string;
}

export interface AdsIntelligenceClient {
  getStoreSummary(storeId?: string): Promise<AdsStoreSummary>;
  getCampaignHierarchy(storeId?: string): Promise<readonly AdsHierarchyCampaign[]>;
  getDataHealth(storeId?: string): Promise<AdsDataHealth>;
  getCompetitorAds(storeId?: string): Promise<readonly CompetitorAdCard[]>;
  getReconciliationReport?(storeId?: string): Promise<AdsReconciliationReport>;
  syncNow?(storeId?: string): Promise<{ success: boolean; refreshedAt: string; message: string }>;
  getDecisionCards?(storeId?: string): Promise<readonly DecisionCard[]>;
  getAiStrategicReport?(storeId?: string, forceRefresh?: boolean): Promise<AiStrategicReport>;
  getCompetitorIntelligence?(storeId?: string, forceRefresh?: boolean, filters?: { pageId?: string; format?: string; hookType?: string }): Promise<CompetitorIntelligenceReport>;
}


