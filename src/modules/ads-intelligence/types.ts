export interface AdsGatewayStore {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly hasProxy: boolean;
}
export interface AdsShopifySummary {
  readonly status: "CONNECTED" | "NOT_CONFIGURED" | "ESTIMATED";
  readonly totalOrders: number;
  readonly grossSales: string;
  readonly totalRefunds: string;
  readonly netSales: string;
  readonly averageOrderValue: string;
  readonly currency: string;
  readonly source: string;
  readonly periodStart: string;
  readonly periodEnd: string;
}
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
    readonly status: "CONNECTED" | "PENDING" | "ERROR" | "NOT_CONFIGURED";
    readonly propertyId: string | null;
    readonly serviceAccount: string;
    readonly liveSessionsLast30d?: number | null;
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
    readonly status: "CONNECTED" | "ERROR" | "PENDING" | "NOT_CONFIGURED";
    readonly sessions: number | null;
    readonly ecommercePurchases: number;
    readonly purchaseRevenue: number;
    readonly clickToSessionDropPct: string | null;
    readonly metaPaid?: Ga4MetaPaidSummary;
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

export type BriefStatus = "DRAFT" | "APPROVED" | "IN_PRODUCTION" | "READY_FOR_TEST" | "ARCHIVED";

export interface CreativeBriefStoryboardScene {
  readonly timestamp: string;
  readonly scene: string;
  readonly visualAction: string;
  readonly audioVoiceover: string;
  readonly onScreenText: string;
  readonly isNewIdea: boolean;
}

export interface CreativeBriefReference {
  readonly referenceId: string;
  readonly source: string;
  readonly whatWeLearned: string;
  readonly creativeDifference: string;
}

export interface CreativeBrief {
  readonly briefId: string;
  readonly storeId: string;
  readonly title: string;
  readonly assignee: string;
  readonly status: BriefStatus;
  readonly problemOrOpportunity: string;
  readonly product: {
    readonly name: string;
    readonly targetMarket: string;
    readonly offer: string;
    readonly landingPageUrl: string;
    readonly priceUsd?: number;
  };
  readonly targetAudience: string;
  readonly hypothesis: string;
  readonly creativeConcept: {
    readonly hookAngle: string;
    readonly hookType: string;
    readonly visualStyle: string;
    readonly format: string;
    readonly aspectRatio: "9:16" | "1:1" | "4:5";
    readonly conceptSummary: string;
  };
  readonly storyboard: readonly CreativeBriefStoryboardScene[];
  readonly copyAndCta: {
    readonly primaryText: string;
    readonly headline: string;
    readonly ctaButton: string;
    readonly productTruths: readonly string[];
    readonly brandConstraints: readonly string[];
  };
  readonly references: readonly CreativeBriefReference[];
  readonly testVariables: {
    readonly isolatedVariable: string;
    readonly constantVariables: readonly string[];
    readonly controlAdId?: string;
    readonly controlAdName?: string;
  };
  readonly guardrails: {
    readonly primaryMetric: "cpa" | "roas" | "linkCtr" | "purchases";
    readonly metricBasis: "META_PURCHASE" | "GA4_SESSION" | "SHOPIFY_ORDER" | "BLENDED";
    readonly budgetCapUsd: number;
    readonly killCriteria: string;
    readonly reviewWindowDays: number;
  };
  readonly linkedExperimentId?: string;
  readonly reviewerNotes?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ExperimentStatus =
  | "DRAFT"
  | "APPROVED"
  | "RUNNING"
  | "MATURING"
  | "COMPLETED"
  | "INCONCLUSIVE"
  | "ABORTED";

export interface ExperimentControlEntity {
  readonly entityType: "ad" | "adset" | "campaign";
  readonly entityId: string;
  readonly entityName: string;
  readonly baselineSpend: number;
  readonly baselineMetricValue: number;
  readonly baselinePurchases: number;
}

export interface ExperimentVariantEntity {
  readonly entityType: "ad" | "adset";
  readonly entityId?: string;
  readonly entityName: string;
  readonly briefId?: string;
  readonly description: string;
}

export interface ExperimentResults {
  readonly controlSpend: number;
  readonly variantSpend: number;
  readonly controlOutcomes: number;
  readonly variantOutcomes: number;
  readonly controlMetricValue: number;
  readonly variantMetricValue: number;
  readonly deltaPercent: number;
  readonly confidence: "HIGH" | "MEDIUM" | "LOW" | "INCONCLUSIVE";
  readonly confoundersNoted: readonly string[];
  readonly reviewer: string;
}

export interface ExperimentLearning {
  readonly conclusion: string;
  readonly verdict: "WIN" | "LOSS" | "INCONCLUSIVE";
  readonly scope: string;
  readonly nextRecommendedTest: string;
}

export interface AdsExperiment {
  readonly id: string;
  readonly storeId: string;
  readonly title: string;
  readonly hypothesis: string;
  readonly linkedBriefId?: string;
  readonly design: {
    readonly type: "OBSERVATIONAL" | "RANDOMIZED";
    readonly objective: "CONVERSIONS" | "CLICK_THROUGH" | "AWARENESS";
    readonly control: ExperimentControlEntity;
    readonly variants: readonly ExperimentVariantEntity[];
    readonly isolatedVariable: string;
    readonly allocationMechanism: string;
  };
  readonly measurement: {
    readonly primaryMetric: "cpa" | "roas" | "linkCtr" | "purchases";
    readonly metricBasis: "META_PURCHASE" | "GA4_SESSION" | "SHOPIFY_ORDER" | "BLENDED";
    readonly minimumSampleSize: number;
    readonly mde: number;
    readonly maturityRequirement: "PROVISIONAL" | "MATURE";
  };
  readonly limits: {
    readonly budgetCapUsd: number;
    readonly maxLossGuardrailUsd: number;
    readonly reviewWindowDays: number;
  };
  readonly timeline: {
    readonly startDate: string;
    readonly endDate?: string;
    readonly actualReviewDate?: string;
  };
  readonly status: ExperimentStatus;
  readonly statusReason?: string;
  readonly results?: ExperimentResults;
  readonly learning?: ExperimentLearning;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface GuardedWriteProposal {
  readonly proposalId: string;
  readonly action: "PAUSE" | "ADJUST_BUDGET";
  readonly targetType: string;
  readonly targetId: string;
  readonly targetName: string;
  readonly currentBudget?: number;
  readonly proposedBudget?: number;
  readonly reason: string;
  readonly previewHash?: string;
}

export interface GuardedWriteExecutionResult {
  readonly success: boolean;
  readonly message: string;
  readonly auditLogId?: string;
  readonly status?: string;
}

export type ExperimentOutcomeVerdict = "WIN" | "LOSS" | "INCONCLUSIVE";

export interface AdsIntelligenceClient {
  readonly dataMode?: "mock" | "live";
  getStores?(): Promise<readonly AdsGatewayStore[]>;
  getShopifySummary?(storeId: string): Promise<AdsShopifySummary>;
  getStoreSummary(storeId?: string): Promise<AdsStoreSummary>;
  getCampaignHierarchy(storeId?: string): Promise<readonly AdsHierarchyCampaign[]>;
  getDataHealth(storeId?: string): Promise<AdsDataHealth>;
  getSpyCapabilities?(): Promise<SpyCapabilities>;
  getSpyJob?(storeId: string): Promise<{ job: SpyJob | null }>;
  startSpyJob?(input: { storeId: string; runner: "codex" | "agy"; model: string }): Promise<{ job: SpyJob }>;
  cancelSpyJob?(storeId: string, jobId: string): Promise<{ job: SpyJob }>;
  getCompetitorResearch?(storeId: string): Promise<{ research: CompetitorResearch | null }>;
  getCompetitorAds(storeId?: string): Promise<readonly CompetitorAdCard[]>;
  getReconciliationReport?(storeId?: string): Promise<AdsReconciliationReport>;
  syncNow?(storeId?: string): Promise<{ success: boolean; refreshedAt: string; message: string }>;
  getDecisionCards?(storeId?: string): Promise<readonly DecisionCard[]>;
  getAiStrategicReport?(storeId?: string, forceRefresh?: boolean, runner?: "codex" | "agy", model?: string): Promise<AiStrategicReport>;
  getLocalAiRunners?(): Promise<LocalAiDetectionResult>;
  getCompetitorIntelligence?(storeId?: string, forceRefresh?: boolean, filters?: { pageId?: string; format?: string; hookType?: string }): Promise<CompetitorIntelligenceReport>;
  getBriefs?(storeId?: string): Promise<readonly CreativeBrief[]>;
  generateBrief?(storeId: string, payload: { source: "decision" | "gap" | "custom"; sourceId?: string; brief?: CreativeBrief }): Promise<CreativeBrief>;
  getBriefMarkdown?(briefId: string): Promise<string>;
  updateBriefStatus?(briefId: string, status: BriefStatus, notes?: string): Promise<CreativeBrief>;
  getExperiments?(storeId?: string): Promise<readonly AdsExperiment[]>;
  createExperiment?(storeId: string, payload: { briefId?: string; experiment?: AdsExperiment; customOptions?: { title?: string; budgetCapUsd?: number; reviewWindowDays?: number } }): Promise<AdsExperiment>;
  updateExperimentOutcome?(experimentId: string, payload: { results?: ExperimentResults; learning?: ExperimentLearning; status?: ExperimentStatus; statusReason?: string }): Promise<AdsExperiment>;
  getStoreProfile?(storeId?: string): Promise<{ configured: boolean; storeId: string; shopDomain?: string; profile: any | null }>;
  saveStoreProfile?(storeId: string, payload: any): Promise<{ success: boolean; storeId: string; profile: any }>;
  testMetaConnection?(accountId: string): Promise<{ success: boolean; account?: any; error?: string }>;
  proposeGuardedWrite?(storeId: string, decisionIdOrEntityId: string): Promise<GuardedWriteProposal>;
  executeGuardedWrite?(proposalId: string, options?: { operatorConfirmText?: string; forceAllowV3?: boolean }): Promise<GuardedWriteExecutionResult>;
}

export interface LocalAiRunnerInfo {
  readonly id: "codex" | "agy";
  readonly name: string;
  readonly available: boolean;
  readonly executablePath?: string;
  readonly version?: string;
  readonly defaultModel: string;
  readonly models: readonly string[];
}

export interface LocalAiDetectionResult {
  readonly platform: string;
  readonly runners: readonly LocalAiRunnerInfo[];
}




export interface Ga4MetaPaidSummary {
  readonly status: "AVAILABLE" | "ERROR";
  readonly sessions: number | null;
  readonly ecommercePurchases: number | null;
  readonly purchaseRevenue: number | null;
  readonly unverifiedMetaSessions: number | null;
  readonly timezone: string | null;
  readonly currency: string | null;
  readonly warnings: readonly string[];
  readonly scope: string;
}

export interface CompetitorResearch {
  readonly storeId: string;
  readonly shopDomain: string;
  readonly storeDomain: string;
  readonly observedAt: string;
  readonly scope: { readonly products: readonly string[]; readonly market: string; readonly currency: string; readonly excluded: readonly string[] };
  readonly selected: readonly {
    readonly name: string; readonly domain: string; readonly productGroup: string; readonly score: number;
    readonly scoreBreakdown: { readonly product: number; readonly customizationModel: number; readonly audience: number; readonly price: number; readonly themes: number };
    readonly confidence: "high" | "medium";
    readonly evidence: readonly { readonly url: string; readonly note: string }[];
    readonly adStatus: string;
  }[];
  readonly adCollection?: readonly {
    readonly brandDomain: string; readonly pageIds: readonly string[]; readonly identityEvidence: readonly string[];
    readonly status: "identity_unresolved" | "source_error" | "fetched_empty" | "fetched_no_match" | "verified_ads";
    readonly retrievedCount: number; readonly matchedCount: number; readonly note: string;
  }[];
  readonly adInsights?: readonly { readonly title: string; readonly observation: string; readonly sourceAdIds: readonly string[]; readonly originalTest: string }[];
  readonly limitations: readonly string[];
  readonly websiteDerivedHypotheses: readonly { readonly title: string; readonly basis: string; readonly hypothesis: string }[];
}

export interface SpyCapabilities {
  readonly skillAvailable?: boolean;
  readonly runners: readonly { readonly id: "codex" | "agy"; readonly name: string; readonly available: boolean; readonly models: readonly string[]; readonly defaultModel: string }[];
}
export interface SpyLogEvent {
  readonly id: string; readonly at: string; readonly level: "info" | "success" | "error"; readonly message: string;
}
export interface SpyJob {
  readonly events?: readonly SpyLogEvent[];
  readonly id: string; readonly storeId: string; readonly shopDomain: string; readonly runner: "codex" | "agy"; readonly model: string;
  readonly status: "running" | "completed" | "partial" | "failed" | "cancelled" | "interrupted";
  readonly startedAt: string; readonly finishedAt?: string; readonly phase: string; readonly errorCode?: string;
  readonly published?: boolean; readonly selectedCount?: number; readonly adCount?: number; readonly brandsWithAds?: number;
}
