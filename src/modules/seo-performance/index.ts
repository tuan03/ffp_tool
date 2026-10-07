export type { PageKind, SearchMetrics, PerformanceDataSource, PerformanceIntegrationStatus, Ga4PropertyMetadata,
  PerformanceStoreIntegrationMapping, PerformanceIntegrationFreshness, GscIntegrationSummary, Ga4IntegrationSummary,
  PerformanceIntegrationSummary, PerformanceMapping, PageAudit, AuditFinding, PerformancePage, RecommendationInput,
  SeoRecommendation, PerformanceJob, PerformanceOverview, PerformanceFilters, PerformanceList, PerformanceEvent,
  SeoPerformanceClient, SearchReport, SearchReportFilters, SearchReportView, SearchReportRow, SearchReportDimension,
  BenchmarkProductItem, BenchmarkSummaryKpis, BenchmarkFilters, ProductSeoDetailData, BatchDetailData, ConnectionsSyncData,
  ProductVersionHistoryItem, ProductFieldDiff, ProductMediaAltDiff, ProductQueryItem, ProductGa4Data,
  BenchmarkComparisonMode, BenchmarkDataStatus, BenchmarkMeasurementStatus, BenchmarkPerformanceStatus,
  AutoSeoResult,
} from "./types";
export { createSeoPerformanceClient } from "./service";
export { getSeoPerformanceClient } from "./runtime";
export { createSeoPerformanceRoutes } from "./routes";

