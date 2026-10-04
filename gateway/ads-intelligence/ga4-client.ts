/**
 * FFP Ads Intelligence — Google Analytics 4 (GA4) Data API Client
 * Read-only adapter for e-commerce traffic and reconciliation reporting.
 */
import fs from "node:fs";
import path from "node:path";
import { BetaAnalyticsDataClient } from "@google-analytics/data";

export interface Ga4OverviewResult {
  readonly sessions: number;
  readonly ecommercePurchases: number;
  readonly purchaseRevenue: number;
  readonly currency: string;
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
}
