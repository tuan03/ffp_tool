/**
 * FFP Ads Intelligence — Google Analytics 4 (GA4) Data API Client
 * Read-only adapter for e-commerce traffic, UTM acquisition, landing pages, and reconciliation reporting.
 */
import fs from "node:fs";
import path from "node:path";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

import type {
  GA4AcquisitionRow,
  GA4EventVolumeRow,
  GA4LandingPageRow,
  GA4ProductRow,
  GA4ReconciliationRow,
  GA4ReportRecipe,
} from "./types";

export interface Ga4OverviewResult {
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
  readonly credentialsPath?: string;
}

export class Ga4Client {
  private client: BetaAnalyticsDataClient | null = null;
  private readonly credentialsPath: string;

  constructor(options: Ga4ClientOptions = {}) {
    this.credentialsPath =
      options.credentialsPath ??
      process.env.GA4_CREDENTIALS_PATH ??
      path.resolve(process.cwd(), "credentials/ga4-service-account.json");

    if (fs.existsSync(this.credentialsPath)) {
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
    };
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
