export type PageKind = "product" | "collection" | "blog" | "page" | "home" | "other";
export interface SearchMetrics { readonly clicks: number; readonly impressions: number; readonly ctr: number; readonly position: number }
export type PerformanceDataSource = "gsc" | "ga4";
export type PerformanceIntegrationStatus =
  | "CONNECTED"
  | "MISSING_PERMISSION"
  | "RECONNECT_REQUIRED"
  | "DISCONNECTED"
  | "NOT_CONFIGURED"
  | "ERROR"
  | "PERMISSION_DENIED";
export interface Ga4PropertyMetadata {
  /** Numeric Google Analytics property ID represented as a string to avoid precision loss. */
  readonly propertyId: string;
  readonly streamId: string | null;
  readonly hostnameScope: string;
  readonly timeZone: string;
  readonly currencyCode: string;
}
export interface PerformanceStoreIntegrationMapping {
  readonly storeId: string;
  readonly mappingRevision: number;
  readonly origin: string;
  readonly gscProperty: string | null;
  readonly ga4Property: Ga4PropertyMetadata | null;
  readonly gscConnectionId: string | null;
  readonly ga4ConnectionId: string | null;
}
export interface PerformanceIntegrationFreshness {
  readonly dataThrough: string | null;
  readonly fetchedAt: string | null;
  readonly lastSuccessfulSync: string | null;
  readonly stale: boolean;
  readonly staleReason: string | null;
}
interface PerformanceIntegrationSummaryBase {
  readonly source: PerformanceDataSource;
  readonly status: PerformanceIntegrationStatus;
  readonly connectionId: string | null;
  readonly mappingRevision: number | null;
  readonly origin: string | null;
  readonly freshness: PerformanceIntegrationFreshness;
  readonly quality: readonly string[];
}
export interface GscIntegrationSummary extends PerformanceIntegrationSummaryBase {
  readonly source: "gsc";
  readonly property: string | null;
}
export interface Ga4IntegrationSummary extends PerformanceIntegrationSummaryBase {
  readonly source: "ga4";
  readonly property: Ga4PropertyMetadata | null;
}
export type PerformanceIntegrationSummary = GscIntegrationSummary | Ga4IntegrationSummary;
export interface PerformanceMapping {
  readonly storeId: string;
  readonly property: string;
  readonly origin: string;
  readonly lastSync: string | null;
  /** Additive fields used by the versioned integration contract. */
  readonly mappingRevision?: number;
  readonly gscConnectionId?: string | null;
  readonly ga4ConnectionId?: string | null;
  readonly ga4PropertyId?: string | null;
  readonly ga4StreamId?: string | null;
  readonly hostnameScope?: string | null;
  readonly timeZone?: string | null;
  readonly currencyCode?: string | null;
}
export interface AuditFinding { readonly code: string; readonly status: "needs_changes" | "unknown"; readonly message: string }
export interface PageAudit {
  readonly url: string; readonly status: number; readonly title: string; readonly description: string;
  readonly h1: readonly string[]; readonly canonical: string | null; readonly noindex: boolean;
  readonly missingAltCount: number; readonly internalLinks: readonly string[]; readonly text: string;
  readonly jsonLd: readonly unknown[]; readonly aeoVisibility: "observed" | "not_observed" | "unknown";
  readonly rendering: "static_only"; readonly findings: readonly AuditFinding[];
}
export interface PerformancePage {
  readonly url: string; readonly kind: PageKind; readonly productId: string | null;
  readonly snapshotId: string | null; readonly checkedAt: string | null;
  readonly audit: PageAudit | null; readonly current: SearchMetrics | null; readonly previous: SearchMetrics | null;
  readonly opportunities: readonly string[];
}
export interface RecommendationInput {
  readonly requestId: string; readonly url: string; readonly snapshotId: string; readonly rulesVersion: string;
  readonly issue: string; readonly evidence: readonly string[]; readonly proposed: string; readonly rationale: string;
  readonly risk: string; readonly priority: "high" | "medium" | "low";
  readonly confidence: "high" | "medium" | "low"; readonly startDate: string; readonly endDate: string;
}
export interface SeoRecommendation extends RecommendationInput {
  readonly id: string; readonly actor: string; readonly createdAt: string;
  readonly status: "proposed" | "queued" | "dismissed" | "applied";
  readonly jobId: string | null;
}
export interface PerformanceJob {
  readonly id: string; readonly kind: "sync" | "gsc_sync" | "ga4_sync" | "crawl" | "inspection" | "report" | "benchmark" | "recommendation" | "health";
  readonly status: "pending" | "running" | "done" | "failed";
  readonly progress: number; readonly error: string | null; readonly updatedAt: string;
}
export interface PerformanceOverview {
  readonly enabled: boolean; readonly configured: boolean; readonly connected: boolean; readonly reconnectRequired: boolean;
  readonly mapping: PerformanceMapping | null; readonly current: SearchMetrics | null; readonly previous: SearchMetrics | null;
  readonly startDate: string; readonly endDate: string; readonly jobs: readonly PerformanceJob[];
  readonly integrations?: readonly PerformanceIntegrationSummary[];
  readonly notice: string;
}
export interface PerformanceFilters { readonly offset?: number; readonly kind?: PageKind; readonly search?: string; readonly startDate?: string; readonly endDate?: string }
export interface PerformanceList<T> { readonly items: readonly T[]; readonly total: number; readonly nextOffset: number | null }
export interface PerformanceEvent { readonly id: string; readonly event: string; readonly createdAt: string; readonly details: Readonly<Record<string, unknown>> }
export interface SeoPerformanceClient {
  report(storeId: string, input: SearchReportFilters, view?: SearchReportView): Promise<SearchReport>;
  stores(): Promise<readonly { readonly storeId: string; readonly shopDomain: string }[]>;
  overview(storeId: string, filters?: PerformanceFilters): Promise<PerformanceOverview>;
  integrations(storeId: string): Promise<readonly PerformanceIntegrationSummary[]>;
  properties(storeId: string): Promise<readonly { readonly siteUrl: string; readonly permissionLevel: string }[]>;
  connect(storeId: string, sources?: readonly PerformanceDataSource[]): Promise<{ readonly url: string }>;
  disconnect(storeId: string): Promise<void>;
  map(storeId: string, property: string, origin: string): Promise<void>;
  start(storeId: string, kind: "sync" | "gsc_sync" | "ga4_sync" | "crawl"): Promise<{ readonly jobId: string }>;
  pages(storeId: string, filters?: PerformanceFilters): Promise<PerformanceList<PerformancePage>>;
  queries(storeId: string, url: string, filters?: PerformanceFilters): Promise<PerformanceList<{ readonly query: string; readonly metrics: SearchMetrics }>>;
  recommendations(storeId: string, offset?: number): Promise<PerformanceList<SeoRecommendation>>;
  history(storeId: string, offset?: number): Promise<PerformanceList<PerformanceEvent>>;
  revise(storeId: string, recommendationId: string): Promise<{ readonly jobId: string }>;
  dismiss(storeId: string, recommendationId: string): Promise<void>;
  benchmark(storeId: string, filters?: BenchmarkFilters): Promise<{ readonly items: readonly BenchmarkProductItem[]; readonly total: number; readonly kpis: BenchmarkSummaryKpis }>;
  productDetail(storeId: string, productId: string, options?: { readonly windowDays?: 7 | 14 | 28; readonly compareVersionId?: string }): Promise<ProductSeoDetailData>;
  batchDetail(storeId: string, batchId: string): Promise<BatchDetailData>;
  connectionsSync(storeId: string): Promise<ConnectionsSyncData>;
  backfill(storeId: string, source: "gsc" | "ga4", days?: number): Promise<{ readonly jobId: string }>;
}

export type SearchReportDimension = "total" | "date" | "query" | "page" | "country" | "device";
export interface SearchReportFilters {
  readonly startDate: string; readonly endDate: string;
  readonly country?: string; readonly device?: "DESKTOP" | "MOBILE" | "TABLET";
  readonly query?: string; readonly page?: string;
}
export interface SearchReportView {
  readonly dimension?: Exclude<SearchReportDimension, "total">;
  readonly order?: "top" | "growing" | "declining";
  readonly metric?: keyof SearchMetrics; readonly offset?: number;
}
export interface SearchReportRow {
  readonly key: string; readonly current: SearchMetrics | null; readonly previous: SearchMetrics | null;
  readonly delta: { readonly [K in keyof SearchMetrics]: number | null };
}
export interface SearchReport {
  readonly jobId: string; readonly status: PerformanceJob["status"]; readonly progress: number;
  readonly error: string | null; readonly fetchedAt: string | null; readonly stale: boolean;
  readonly property: string; readonly filters: SearchReportFilters;
  readonly previousStart: string; readonly previousEnd: string;
  readonly current: SearchMetrics | null; readonly previous: SearchMetrics | null;
  readonly timeline: readonly SearchReportRow[];
  readonly rows: PerformanceList<SearchReportRow>; readonly limited: boolean;
}

export type BenchmarkComparisonMode = "version" | "calendar";
export type BenchmarkDataStatus = "FRESH" | "PARTIAL" | "STALE" | "ERROR" | "DISCONNECTED";
export type BenchmarkMeasurementStatus =
  | "BASELINE"
  | "WAITING_FOR_CRAWL"
  | "COLLECTING"
  | "ELIGIBLE"
  | "INSUFFICIENT_DATA"
  | "CONTENT_CHANGED";
export type BenchmarkPerformanceStatus =
  | "NOT_EVALUATED"
  | "IMPROVING"
  | "STABLE"
  | "MIXED"
  | "DECLINING";

export interface BenchmarkProductItem {
  readonly productId: string;
  readonly shopifyProductGid: string;
  readonly title: string;
  readonly url: string;
  readonly thumbnailUrl: string | null;
  readonly currentVersion: string;
  readonly versionSource: "INITIAL" | "AUTO_SEO" | "ROLLBACK" | "EXTERNAL" | null;
  readonly promptVersion: string | null;
  readonly batchId: string | null;
  readonly publishedAt: string | null;
  readonly hasExternalDrift: boolean;
  readonly seoAge: number | null;
  readonly targetDays: number;
  readonly coverageDays: number;
  readonly clicks: {
    readonly after: number;
    readonly before: number | null;
    readonly deltaAbsolute: number | null;
    readonly deltaPercent: number | null;
    readonly isNewActivity?: boolean;
  };
  readonly impressions: {
    readonly after: number;
    readonly before: number | null;
    readonly deltaAbsolute: number | null;
    readonly deltaPercent: number | null;
  };
  readonly ctr: {
    readonly after: number | null;
    readonly before: number | null;
    readonly deltaPercentagePoints: number | null;
  };
  readonly position: {
    readonly after: number | null;
    readonly before: number | null;
    readonly improvement: number | null;
  };
  readonly queries: {
    readonly afterCount: number;
    readonly beforeCount: number | null;
    readonly delta: number | null;
    readonly newlyObserved: number;
    readonly noLongerObserved: number;
    readonly matchedCount: number;
  };
  readonly organicSessions: {
    readonly after: number | null;
    readonly before: number | null;
    readonly deltaAbsolute: number | null;
    readonly deltaPercent: number | null;
    readonly isGscQueryFilterApplied?: boolean;
  };
  readonly status: {
    readonly dataStatus: BenchmarkDataStatus;
    readonly measurementStatus: BenchmarkMeasurementStatus;
    readonly performanceStatus: BenchmarkPerformanceStatus;
    readonly technicalFlags: readonly string[];
    readonly label: string;
    readonly reason: string;
    readonly rulesetVersion: string;
    readonly lastEvaluatedAt: string | null;
  };
  readonly action: {
    readonly type: "VIEW" | "REVIEW" | "AUTO_SEO" | "SEND_TO_AUTO_SEO";
    readonly label: string;
    readonly enabled: boolean;
    readonly disabledReason?: string;
    readonly recommendationId?: string;
  };
}

export interface BenchmarkSummaryKpis {
  readonly totalManaged: number;
  readonly v0Count: number;
  readonly seoVersionCount: number;
  readonly eligibleCount: number;
  readonly improvingCount: number;
  readonly stableOrMixedCount: number;
  readonly decliningCount: number;
  readonly collectingOrInsufficientCount: number;
  readonly technicalIssuesCount: number;
  readonly cohortTotals: {
    readonly beforeClicks: number;
    readonly afterClicks: number;
    readonly clicksDeltaAbsolute: number;
    readonly clicksDeltaPercent: number | null;
    readonly beforeImpressions: number;
    readonly afterImpressions: number;
    readonly impressionsDeltaAbsolute: number;
    readonly impressionsDeltaPercent: number | null;
    readonly beforeCtr: number | null;
    readonly afterCtr: number | null;
    readonly ctrDeltaPp: number | null;
    readonly beforePosition: number | null;
    readonly afterPosition: number | null;
    readonly positionImprovement: number | null;
    readonly beforeOrganicSessions: number | null;
    readonly afterOrganicSessions: number | null;
    readonly organicSessionsDelta: number | null;
    readonly isGscQueryFilterApplied?: boolean;
  };
}

export interface BenchmarkFilters {
  readonly versionFilter?: "all" | "v0" | "v1+";
  readonly statusFilter?: string;
  readonly windowDays?: 7 | 14 | 28;
  readonly comparisonMode?: BenchmarkComparisonMode;
  readonly search?: string;
  readonly batchId?: string;
  readonly country?: string;
  readonly device?: "DESKTOP" | "MOBILE" | "TABLET" | "";
  readonly query?: string;
  readonly sortBy?: "clicks" | "impressions" | "ctr" | "position" | "queries" | "sessions" | "age" | "title" | "status";
  readonly sortDir?: "asc" | "desc";
  readonly offset?: number;
  readonly limit?: number;
}

export interface ProductVersionHistoryItem {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly source: "INITIAL" | "AUTO_SEO" | "ROLLBACK" | "EXTERNAL";
  readonly actor: string;
  readonly batchId: string | null;
  readonly promptVersion: string | null;
  readonly appliedAt: string;
  readonly publicEffectiveAt: string | null;
  readonly contentHash: string;
  readonly snapshot: {
    readonly title: string;
    readonly descriptionHtml: string;
    readonly seoTitle: string;
    readonly seoDescription: string;
    readonly media: readonly { readonly id: string; readonly alt: string; readonly url: string }[];
  };
}

export interface ProductFieldDiff {
  readonly field: "title" | "descriptionHtml" | "seoTitle" | "seoDescription";
  readonly label: string;
  readonly before: string;
  readonly after: string;
  readonly hasChanged: boolean;
}

export interface ProductMediaAltDiff {
  readonly mediaId: string;
  readonly url: string;
  readonly beforeAlt: string;
  readonly afterAlt: string;
  readonly hasChanged: boolean;
}

export interface ProductQueryItem {
  readonly query: string;
  readonly category: "matched" | "new" | "lost";
  readonly beforeClicks: number | null;
  readonly afterClicks: number | null;
  readonly clicksDelta: number | null;
  readonly beforeImpressions: number | null;
  readonly afterImpressions: number | null;
  readonly beforeCtr: number | null;
  readonly afterCtr: number | null;
  readonly beforePosition: number | null;
  readonly afterPosition: number | null;
  readonly positionImprovement: number | null;
}

export interface ProductGa4Data {
  readonly landingSessions: { readonly current: number; readonly previous: number; readonly delta: number };
  readonly totalUsers: { readonly current: number; readonly previous: number; readonly delta: number };
  readonly engagedSessions: { readonly current: number; readonly previous: number; readonly delta: number };
  readonly engagementRate: { readonly current: number; readonly previous: number };
  readonly eventCounts: {
    readonly viewItem: number;
    readonly addToCart: number;
    readonly beginCheckout: number;
    readonly purchase: number;
  };
  readonly purchaseRevenue: { readonly amount: number; readonly currency: string };
  readonly acquisition: readonly { readonly channel: string; readonly sessions: number; readonly users: number }[];
  readonly isGscQueryFilterNotice: boolean;
}

export interface ProductSeoDetailData {
  readonly product: BenchmarkProductItem;
  readonly versions: readonly ProductVersionHistoryItem[];
  readonly selectedVersionNumber: number;
  readonly comparedVersionNumber: number;
  readonly diffs: readonly ProductFieldDiff[];
  readonly mediaDiffs: readonly ProductMediaAltDiff[];
  readonly windows: {
    readonly beforeStart: string;
    readonly beforeEnd: string;
    readonly settlingDays: number;
    readonly afterStart: string;
    readonly afterEnd: string;
    readonly sourceTimezone: string;
  };
  readonly inspection: {
    readonly verdict: string;
    readonly coverageState: string;
    readonly lastCrawlAt: string | null;
    readonly indexingState: string;
    readonly googleCanonical: string | null;
    readonly userCanonical: string | null;
    readonly robotsState: string;
    readonly derivedState: string;
  };
  readonly timelineAnnotations: readonly { readonly date: string; readonly type: "version" | "external" | "sale" | "theme"; readonly note: string }[];
  readonly queries: readonly ProductQueryItem[];
  readonly ga4: ProductGa4Data;
  readonly recommendations: readonly SeoRecommendation[];
}

export interface BatchDetailData {
  readonly batchId: string;
  readonly storeId: string;
  readonly executedAt: string;
  readonly totalProducts: number;
  readonly succeededCount: number;
  readonly failedCount: number;
  readonly noChangeCount: number;
  readonly eligibleCount: number;
  readonly cohortTotals: {
    readonly beforeClicks: number;
    readonly afterClicks: number;
    readonly clicksDeltaAbsolute: number;
    readonly clicksDeltaPercent: number | null;
    readonly beforeImpressions: number;
    readonly afterImpressions: number;
    readonly impressionsDeltaAbsolute: number;
    readonly impressionsDeltaPercent: number | null;
    readonly beforeCtr: number;
    readonly afterCtr: number;
    readonly ctrDeltaPp: number;
    readonly beforePosition: number;
    readonly afterPosition: number;
    readonly positionImprovement: number;
  };
  readonly statusDistribution: {
    readonly improving: number;
    readonly stable: number;
    readonly mixed: number;
    readonly declining: number;
    readonly collecting: number;
    readonly insufficient: number;
    readonly technical: number;
  };
  readonly promptVersion: string | null;
  readonly modelName: string | null;
  readonly observationalNote: string;
  readonly products: readonly BenchmarkProductItem[];
}

export interface ConnectionsSyncData {
  readonly gsc: {
    readonly connectionId: string | null;
    readonly status: PerformanceIntegrationStatus;
    readonly property: string | null;
    readonly origin: string | null;
    readonly grantedScopes: readonly string[];
    readonly lastAttemptedSync: string | null;
    readonly lastSuccessfulSync: string | null;
    readonly dataThroughDate: string | null;
    readonly stale: boolean;
    readonly staleReason: string | null;
    readonly quality: readonly string[];
    readonly quota: { readonly used: number; readonly limit: number } | null;
  };
  readonly ga4: {
    readonly connectionId: string | null;
    readonly status: PerformanceIntegrationStatus;
    readonly propertyId: string | null;
    readonly hostnameScope: string | null;
    readonly streamId: string | null;
    readonly timezone: string | null;
    readonly currency: string | null;
    readonly grantedScopes: readonly string[];
    readonly lastAttemptedSync: string | null;
    readonly lastSuccessfulSync: string | null;
    readonly dataThroughDate: string | null;
    readonly stale: boolean;
    readonly staleReason: string | null;
    readonly quality: readonly string[];
    readonly quota: { readonly propertyQuotaTokens: number } | null;
  };
  readonly recentJobs: readonly PerformanceJob[];
}
