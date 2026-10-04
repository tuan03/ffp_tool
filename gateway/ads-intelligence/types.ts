/**
 * Core Types & Contracts for FFP Ads Intelligence
 * Enforces strict typing, Decimal string normalization, immutable snapshots, and source isolation.
 */

export type AdsEntityLevel = "account" | "campaign" | "adset" | "ad";

export type ConversionState =
  | "reported"
  | "not_reported"
  | "value_missing"
  | "field_not_returned"
  | "website_scope_unresolved"
  | "inferred_no_reported_purchases"
  | "derived"
  | "zero_purchases"
  | "zero_spend"
  | "input_missing"
  | "not_returned";

export type DataMaturity = "PROVISIONAL" | "FINALIZED";
export type DataFreshness = "FRESH" | "STALE" | "OUTDATED";
export type DataCompleteness = "COMPLETE" | "PARTIAL" | "FAILED";

export interface RawActionItem {
  readonly action_type: string;
  readonly value?: string | number | null;
}

export interface RawMetaInsightRow {
  readonly account_id?: string;
  readonly account_currency?: string;
  readonly date_start?: string;
  readonly date_stop?: string;
  readonly campaign_id?: string;
  readonly campaign_name?: string;
  readonly adset_id?: string;
  readonly adset_name?: string;
  readonly ad_id?: string;
  readonly ad_name?: string;
  readonly spend?: string | number | null;
  readonly impressions?: string | number | null;
  readonly reach?: string | number | null;
  readonly frequency?: string | number | null;
  readonly cpm?: string | number | null;
  readonly ctr?: string | number | null;
  readonly inline_link_click_ctr?: string | number | null;
  readonly cpc?: string | number | null;
  readonly clicks?: string | number | null;
  readonly inline_link_clicks?: string | number | null;
  readonly actions?: readonly RawActionItem[] | null;
  readonly action_values?: readonly RawActionItem[] | null;
  readonly website_purchase_roas?: readonly RawActionItem[] | null;
  readonly [key: string]: unknown;
}

export interface MetaAccountInfo {
  readonly id: string;
  readonly currency: string;
  readonly timezone_name: string;
  readonly name?: string;
}

export interface NormalizedMetaConversions {
  readonly landing_page_views: string | null;
  readonly add_to_cart: string | null;
  readonly checkout: string | null;
  readonly purchase: string | null;
  readonly purchase_value: string | null;
  readonly cpa: string | null;
  readonly roas: string | null;
  readonly website_roas_api: string | null;
  readonly conversion_states: Readonly<Record<string, ConversionState>>;
}

export interface NormalizedMetaInsightRow extends NormalizedMetaConversions {
  readonly level: AdsEntityLevel;
  readonly object_id: string;
  readonly data_status: "reported";
  readonly account_id: string;
  readonly account_currency: string;
  readonly date_start: string;
  readonly date_stop: string;
  readonly campaign_id?: string;
  readonly campaign_name?: string;
  readonly adset_id?: string;
  readonly adset_name?: string;
  readonly ad_id?: string;
  readonly ad_name?: string;
  readonly spend: string | null;
  readonly impressions: string | null;
  readonly reach: string | null;
  readonly frequency: string | null;
  readonly cpm: string | null;
  readonly ctr: string | null;
  readonly inline_link_click_ctr: string | null;
  readonly cpc: string | null;
  readonly clicks: string | null;
  readonly inline_link_clicks: string | null;
  readonly conversion_warnings: readonly string[];
}

export interface MetaInsightsReport {
  readonly metadata: {
    readonly status: "complete" | "partial" | "failed";
    readonly schema_version: number;
    readonly website_conversions: boolean;
    readonly conversion_mapping: Record<string, string>;
    readonly started_at: string;
    readonly completed_at: string;
    readonly account: MetaAccountInfo;
    readonly api_version_requested: string;
    readonly campaign_filter?: string | null;
    readonly since: string;
    readonly until: string;
    readonly levels: readonly AdsEntityLevel[];
    readonly time_increment: string;
    readonly pages: Readonly<Record<string, number>>;
    readonly counts: Readonly<Record<string, number>>;
    readonly queries: Readonly<Record<string, Record<string, unknown>>>;
    readonly ads_manager_verified: boolean;
    readonly transport?: Record<string, unknown>;
    readonly api_diagnostics?: Record<string, unknown>;
    readonly warnings: readonly string[];
    readonly notes: readonly string[];
  };
  readonly raw: Readonly<Record<string, readonly RawMetaInsightRow[]>>;
  readonly rows: Readonly<Record<string, readonly NormalizedMetaInsightRow[]>>;
}

export interface GA4DateRange {
  readonly startDate: string; // YYYY-MM-DD or relative like '7daysAgo', 'yesterday'
  readonly endDate: string;   // YYYY-MM-DD or relative like 'yesterday', 'today'
}

export type GA4ReportRecipe =
  | "acquisition"
  | "event_volume"
  | "landing_page"
  | "product"
  | "reconciliation";

export interface GA4AcquisitionRow {
  readonly date: string;
  readonly sessionSourceMedium: string;
  readonly sessionCampaignName?: string;
  readonly sessionManualCampaignId?: string;
  readonly sessionManualAdContent?: string;
  readonly sessions: number;
  readonly totalUsers: number;
  readonly activeUsers: number;
}

export interface GA4EventVolumeRow {
  readonly date: string;
  readonly sessionSourceMedium: string;
  readonly sessionManualCampaignId?: string;
  readonly sessionManualAdContent?: string;
  readonly eventName: string;
  readonly eventCount: number;
}

export interface GA4LandingPageRow {
  readonly date: string;
  readonly landingPagePlusQueryString: string;
  readonly sessionSourceMedium: string;
  readonly sessions: number;
  readonly engagedSessions: number;
  readonly ecommercePurchases: number;
  readonly purchaseRevenue: number;
}

export interface GA4ProductRow {
  readonly date: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly itemsViewed: number;
  readonly itemsAddedToCart: number;
  readonly itemsCheckedOut: number;
  readonly itemsPurchased: number;
  readonly itemRevenue: number;
}

export interface GA4ReconciliationRow {
  readonly date: string;
  readonly transactionId: string;
  readonly sessionManualCampaignId?: string;
  readonly sessionManualAdContent?: string;
  readonly ecommercePurchases: number;
  readonly purchaseRevenue: number;
}

export interface GA4ReportResult<T> {
  readonly recipe: GA4ReportRecipe;
  readonly propertyId: string;
  readonly dateRange: GA4DateRange;
  readonly rows: readonly T[];
  readonly rowCount: number;
  readonly subjectToThresholding?: boolean;
  readonly samplingMetadata?: unknown;
  readonly quotaConsumed?: {
    readonly tokensConsumed?: number;
    readonly tokensRemaining?: number;
  };
}

export interface DataQualityReport {
  readonly freshness: DataFreshness;
  readonly completeness: DataCompleteness;
  readonly maturity: DataMaturity;
  readonly mappingStatus?: "COMPLETE" | "PARTIAL" | "UNMATCHED";
  readonly economicsStatus?: "VERIFIED" | "ESTIMATED" | "MISSING_COSTS";
  readonly warnings: readonly string[];
  readonly blockedDecisions: readonly string[];
  readonly snapshotRefs: readonly string[];
}

export interface NormalizedAdFact {
  readonly factId: string;
  readonly storeId: string;
  readonly source: "meta" | "ga4" | "shopify" | "competitor";
  readonly accountId: string;
  readonly entityLevel: AdsEntityLevel;
  readonly entityId: string;
  readonly entityName?: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly currency: string;
  readonly timezone: string;
  readonly spend: string | null;
  readonly impressions: string | null;
  readonly reach: string | null;
  readonly frequency: string | null;
  readonly cpm: string | null;
  readonly ctr: string | null;
  readonly inlineLinkClickCtr: string | null;
  readonly cpc: string | null;
  readonly clicks: string | null;
  readonly inlineLinkClicks: string | null;
  readonly conversions: NormalizedMetaConversions;
  readonly dataQuality: DataQualityReport;
  readonly snapshotSha256: string;
  readonly fetchedAt: string;
}

export interface StoreAdsProfile {
  readonly storeId: string;
  readonly mode: "read_only" | "test" | "live";
  readonly marketCountries: readonly string[];
  readonly reportingCurrency: string;
  readonly meta: {
    readonly accountIds: readonly string[];
    readonly accountTimezone: string | null;
    readonly apiVersion: string;
    readonly purchaseActionType: string;
    readonly secretRef?: string | null;
    readonly proxyRef?: string | null;
    readonly attributionPolicyRef?: string | null;
  };
  readonly ga4: {
    readonly propertyId: string | null;
    readonly propertyTimezone: string | null;
    readonly credentialRef?: string | null;
  };
  readonly shopify: {
    readonly shopDomain: string;
    readonly apiVersion: string;
    readonly connectionRef?: string | null;
  };
  readonly competitors: {
    readonly primaryProvider: "scrapecreators" | "searchapi" | "apify";
    readonly backupProvider?: "scrapecreators" | "searchapi" | "apify";
    readonly monthlyCostCapUsd: number;
    readonly watchlist: readonly string[];
  };
  readonly business: {
    readonly costProfileRef?: string | null;
    readonly targetCpa: number | null;
    readonly targetContributionPerOrder: number | null;
    readonly breakEvenRoas: number | null;
    readonly breakEvenCpa: number | null;
  };
  readonly rules: {
    readonly policyVersion: string;
    readonly maturityDays: number;
    readonly allowFinancialRecommendations: boolean;
  };
  readonly budgets: {
    readonly totalDailyAuthorizedCap: number | null;
    readonly experimentAuthorizedCap: number | null;
    readonly maxChangePer24hPct?: number | null;
    readonly cooldownHours?: number | null;
  };
  readonly actions: {
    readonly externalWritesEnabled: boolean;
    readonly approvalRequired: boolean;
  };
}
