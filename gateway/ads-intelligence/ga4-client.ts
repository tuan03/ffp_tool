/**
 * FFP Ads Intelligence — Google Analytics 4 (GA4) Data API Client
 * Read-only adapter for e-commerce traffic, UTM acquisition, landing pages, and reconciliation reporting.
 */
import fs from "node:fs";
import path from "node:path";
import { BetaAnalyticsDataClient, protos } from "@google-analytics/data";

import type {
  Ga4MetaPaidSummary,
  GA4AcquisitionRow,
  GA4EventVolumeRow,
  GA4LandingPageRow,
  GA4ProductRow,
  GA4ReconciliationRow,
  GA4ReportRecipe,
} from "./types";

type ReportRequest = protos.google.analytics.data.v1beta.IRunReportRequest;
type ReportResponse = protos.google.analytics.data.v1beta.IRunReportResponse;
interface ReportClient {
  runReport(request: ReportRequest): Promise<readonly [ReportResponse, ...unknown[]]>;
}

export interface Ga4OverviewResult {
  readonly metaPaid?: Ga4MetaPaidSummary;
  readonly sessions: number;
  readonly ecommercePurchases: number;
  readonly purchaseRevenue: number;
  readonly currency: string;
}

export interface Ga4ReportQueryOptions {
  readonly startDate?: string;
  readonly endDate?: string;
  readonly limit?: number;
}

export interface Ga4ReportResult {
  readonly recipe: GA4ReportRecipe;
  readonly propertyId: string;
  readonly period: { readonly startDate: string; readonly endDate: string };
  readonly rowCount: number;
  readonly rows: readonly (
    | GA4AcquisitionRow
    | GA4EventVolumeRow
    | GA4LandingPageRow
    | GA4ProductRow
    | GA4ReconciliationRow
  )[];
}

export interface Ga4ClientOptions {
  readonly reportClient?: ReportClient;
  readonly credentialsPath?: string;
}

export class Ga4Client {
  private client: ReportClient | null = null;
  private readonly credentialsPath: string;

  constructor(options: Ga4ClientOptions = {}) {
    this.credentialsPath =
      options.credentialsPath ??
      process.env.GA4_CREDENTIALS_PATH ??
      path.resolve(process.cwd(), "credentials/ga4-service-account.json");

    if (options.reportClient) {
      this.client = options.reportClient;
    } else if (fs.existsSync(this.credentialsPath)) {
      this.client = new BetaAnalyticsDataClient({
        keyFilename: this.credentialsPath,
      });
    }
  }

  isConfigured(): boolean {
    return this.client !== null && fs.existsSync(this.credentialsPath);
  }

  async getOverview(
    propertyId: string,
    startDate = "30daysAgo",
    endDate = "today",
  ): Promise<Ga4OverviewResult> {
    if (!this.client) {
      throw new Error(`GA4 credentials file not found at ${this.credentialsPath}`);
    }

    const cleanPropertyId = propertyId.replace(/^properties\//, "");
    const [response] = await this.client.runReport({
      property: `properties/${cleanPropertyId}`,
      dateRanges: [{ startDate, endDate }],
      metrics: [
        { name: "sessions" },
        { name: "ecommercePurchases" },
        { name: "purchaseRevenue" },
      ],
    });

    const row = response.rows?.[0];
    const sessions = Number(row?.metricValues?.[0]?.value ?? 0);
    const ecommercePurchases = Number(row?.metricValues?.[1]?.value ?? 0);
    const purchaseRevenue = Number(row?.metricValues?.[2]?.value ?? 0);
    const currency = response.metadata?.currencyCode ?? "USD";

    return {
      sessions,
      ecommercePurchases,
      purchaseRevenue,
      currency,
      metaPaid: await this.getMetaPaidOverview(propertyId, startDate, endDate),
    };
  }

  private async getMetaPaidOverview(propertyId: string, startDate: string, endDate: string): Promise<Ga4MetaPaidSummary> {
    const scope = "Meta source + GA4 Paid Social; session acquisition, not ad-level attribution";
    const unavailable: Ga4MetaPaidSummary = { status: "ERROR", sessions: null, ecommercePurchases: null, purchaseRevenue: null, unverifiedMetaSessions: null, timezone: null, currency: null, scope, warnings: ["GA4_META_PAID_REPORT_UNAVAILABLE"] };
    if (!this.client) return unavailable;
    const source = { filter: { fieldName: "sessionSource", inListFilter: { values: ["facebook", "fb", "instagram", "ig", "meta", "facebook.com", "www.facebook.com", "m.facebook.com", "l.facebook.com", "lm.facebook.com", "instagram.com", "l.instagram.com"], caseSensitive: false } } };
    const paid = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT" as const, value: "Paid Social", caseSensitive: false } } };
    const base: ReportRequest = { property: `properties/${propertyId.replace(/^properties\//, "")}`, dateRanges: [{ startDate, endDate }], metrics: [{name:"sessions"}, {name:"ecommercePurchases"}, {name:"purchaseRevenue"}] };
    try {
      const [paidReport] = await this.client.runReport({ ...base, dimensionFilter: { andGroup: { expressions: [source, paid] } } });
      const [unverifiedReport] = await this.client.runReport({ ...base, metrics: [{name:"sessions"}], dimensionFilter: { andGroup: { expressions: [source, { notExpression: paid }] } } });
      const warnings: string[] = [];
      for (const report of [paidReport, unverifiedReport]) {
        if (report.metadata?.subjectToThresholding) warnings.push("GA4_THRESHOLDING");
        if (report.metadata?.dataLossFromOtherRow) warnings.push("GA4_DATA_LOSS_FROM_OTHER_ROW");
        if (report.metadata?.samplingMetadatas?.length) warnings.push("GA4_SAMPLED");
      }
      const metric = (report: ReportResponse, index: number): number => {
        if (!report.rows?.length) return 0;
        const raw = report.rows[0]?.metricValues?.[index]?.value;
        if (raw === undefined || raw === null || raw === "" || !Number.isFinite(Number(raw))) throw new Error("GA4_INVALID_METRIC");
        return Number(raw);
      };
      return { status: "AVAILABLE", sessions: metric(paidReport, 0), ecommercePurchases: metric(paidReport, 1), purchaseRevenue: metric(paidReport, 2), unverifiedMetaSessions: metric(unverifiedReport, 0), timezone: paidReport.metadata?.timeZone ?? null, currency: paidReport.metadata?.currencyCode ?? null, scope, warnings: [...new Set(warnings)] };
    } catch { return unavailable; }
  }

  async getReport(
    propertyId: string,
    recipe: GA4ReportRecipe,
    options: Ga4ReportQueryOptions = {},
  ): Promise<Ga4ReportResult> {
    if (!this.client) {
      throw new Error(`GA4 credentials file not found at ${this.credentialsPath}`);
    }

    const cleanPropertyId = propertyId.replace(/^properties\//, "");
    const startDate = options.startDate ?? "30daysAgo";
    const endDate = options.endDate ?? "today";
    const limit = options.limit ?? 25;

    let dimensions: { name: string }[] = [];
    let metrics: { name: string }[] = [];

    switch (recipe) {
      case "acquisition":
        dimensions = [{ name: "sessionSourceMedium" }, { name: "sessionCampaignName" }];
        metrics = [{ name: "sessions" }, { name: "totalUsers" }, { name: "activeUsers" }];
        break;

      case "landing_page":
        dimensions = [{ name: "landingPagePlusQueryString" }, { name: "sessionSourceMedium" }];
        metrics = [
          { name: "sessions" },
          { name: "engagedSessions" },
          { name: "ecommercePurchases" },
          { name: "purchaseRevenue" },
        ];
        break;

      case "event_volume":
        dimensions = [{ name: "eventName" }];
        metrics = [{ name: "eventCount" }];
        break;

      case "product":
        dimensions = [{ name: "itemName" }];
        metrics = [
          { name: "itemsViewed" },
          { name: "itemsPurchased" },
          { name: "itemRevenue" },
        ];
        break;

      case "reconciliation":
      default:
        dimensions = [{ name: "date" }];
        metrics = [
          { name: "sessions" },
          { name: "ecommercePurchases" },
          { name: "purchaseRevenue" },
        ];
        break;
    }

    const [response] = await this.client.runReport({
      property: `properties/${cleanPropertyId}`,
      dateRanges: [{ startDate, endDate }],
      dimensions,
      metrics,
      limit,
    });

    const rows: (
      | GA4AcquisitionRow
      | GA4EventVolumeRow
      | GA4LandingPageRow
      | GA4ProductRow
      | GA4ReconciliationRow
    )[] = [];

    for (const r of response.rows ?? []) {
      const d0 = r.dimensionValues?.[0]?.value ?? "";
      const d1 = r.dimensionValues?.[1]?.value ?? "";
      const m0 = Number(r.metricValues?.[0]?.value ?? 0);
      const m1 = Number(r.metricValues?.[1]?.value ?? 0);
      const m2 = Number(r.metricValues?.[2]?.value ?? 0);
      const m3 = Number(r.metricValues?.[3]?.value ?? 0);

      if (recipe === "acquisition") {
        rows.push({
          date: endDate,
          sessionSourceMedium: d0,
          sessionCampaignName: d1,
          sessions: m0,
          totalUsers: m1,
          activeUsers: m2,
        });
      } else if (recipe === "landing_page") {
        rows.push({
          date: endDate,
          landingPagePlusQueryString: d0,
          sessionSourceMedium: d1,
          sessions: m0,
          engagedSessions: m1,
          ecommercePurchases: m2,
          purchaseRevenue: m3,
        });
      } else if (recipe === "event_volume") {
        rows.push({
          date: endDate,
          sessionSourceMedium: "all",
          eventName: d0,
          eventCount: m0,
        });
      } else if (recipe === "product") {
        rows.push({
          date: endDate,
          itemId: d0,
          itemName: d0,
          itemsViewed: m0,
          itemsAddedToCart: 0,
          itemsCheckedOut: 0,
          itemsPurchased: m1,
          itemRevenue: m2,
        });
      } else {
        rows.push({
          date: d0,
          transactionId: "agg",
          ecommercePurchases: m1,
          purchaseRevenue: m2,
        });
      }
    }

    return {
      recipe,
      propertyId: cleanPropertyId,
      period: { startDate, endDate },
      rowCount: rows.length,
      rows,
    };
  }
}
