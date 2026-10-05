export type PageKind = "product" | "collection" | "blog" | "page" | "home" | "other";
export interface SearchMetrics { readonly clicks: number; readonly impressions: number; readonly ctr: number; readonly position: number }
export type PerformanceDataSource = "gsc" | "ga4";
export type PerformanceIntegrationStatus = "CONNECTED" | "MISSING_PERMISSION" | "RECONNECT_REQUIRED" | "DISCONNECTED" | "NOT_CONFIGURED";
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
  readonly id: string; readonly kind: "sync" | "crawl" | "inspection" | "report";
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
  properties(): Promise<readonly { readonly siteUrl: string; readonly permissionLevel: string }[]>;
  connect(): Promise<{ readonly url: string }>;
  disconnect(): Promise<void>;
  map(storeId: string, property: string, origin: string): Promise<void>;
  start(storeId: string, kind: "sync" | "crawl"): Promise<{ readonly jobId: string }>;
  pages(storeId: string, filters?: PerformanceFilters): Promise<PerformanceList<PerformancePage>>;
  queries(storeId: string, url: string, filters?: PerformanceFilters): Promise<PerformanceList<{ readonly query: string; readonly metrics: SearchMetrics }>>;
  recommendations(storeId: string, offset?: number): Promise<PerformanceList<SeoRecommendation>>;
  history(storeId: string, offset?: number): Promise<PerformanceList<PerformanceEvent>>;
  revise(storeId: string, recommendationId: string): Promise<{ readonly jobId: string }>;
  dismiss(storeId: string, recommendationId: string): Promise<void>;
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
