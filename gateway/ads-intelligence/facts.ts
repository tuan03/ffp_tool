/**
 * Normalized Ad Facts and Immutable Snapshot Hashing.
 * Creates unified NormalizedAdFact records from Meta Insights and computes deterministic SHA-256 snapshot hashes.
 */

import { createHash } from "node:crypto";
import { datesForAccount } from "./insights";
import type {
  DataQualityReport,
  NormalizedAdFact,
  NormalizedMetaInsightRow,
} from "./types";

/**
 * Computes a deterministic SHA-256 hash of any JSON-serializable object by sorting object keys.
 */
export function computeSnapshotSha256(payload: unknown): string {
  const canonicalJson = canonicalizeJson(payload);
  return createHash("sha256").update(canonicalJson).digest("hex");
}

function canonicalizeJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalizeJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([_, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalizeJson(v)}`).join(",")}}`;
}

export interface CreateMetaFactParams {
  readonly storeId: string;
  readonly row: NormalizedMetaInsightRow;
  readonly timezone: string;
  readonly fetchedAt?: string;
  readonly rawSnapshotPayload?: unknown;
  readonly now?: Date;
}

/**
 * Transforms a NormalizedMetaInsightRow into a NormalizedAdFact with data quality & maturity evaluation.
 */
export function createNormalizedMetaFact(params: CreateMetaFactParams): NormalizedAdFact {
  const { storeId, row, timezone, fetchedAt, rawSnapshotPayload, now } = params;

  const currentFetchedAt = fetchedAt ?? new Date().toISOString();
  const snapshotSha256 = computeSnapshotSha256(rawSnapshotPayload ?? row);

  // Evaluate conversion maturity:
  // If periodEnd is within 7 days of today in the account timezone, flag as PROVISIONAL.
  const referenceDate = now ?? new Date();
  const recentDays = datesForAccount(timezone, undefined, undefined, referenceDate, 31);
  const isProvisional = row.date_stop >= recentDays.since;

  const blockedDecisions: string[] = [];
  const qualityWarnings: string[] = [...row.conversion_warnings];

  if (isProvisional) {
    qualityWarnings.push(
      "Khoảng thời gian kết thúc trong vòng 7 ngày gần nhất; số liệu chuyển đổi đang trong giai đoạn tích lũy (PROVISIONAL).",
    );
    blockedDecisions.push("SCALE_ON_PROFIT", "KILL_ON_CPA");
  }

  const dataQuality: DataQualityReport = {
    freshness: "FRESH",
    completeness: "COMPLETE",
    maturity: isProvisional ? "PROVISIONAL" : "FINALIZED",
    mappingStatus: "COMPLETE",
    economicsStatus: "ESTIMATED",
    warnings: qualityWarnings,
    blockedDecisions,
    snapshotRefs: [snapshotSha256],
  };

  const factId = `fact:${storeId}:meta:${row.level}:${row.object_id}:${row.date_start}:${row.date_stop}`;

  return {
    factId,
    storeId,
    source: "meta",
    accountId: row.account_id,
    entityLevel: row.level,
    entityId: row.object_id,
    entityName: (row[`${row.level}_name` as keyof NormalizedMetaInsightRow] as string | undefined) ?? undefined,
    periodStart: row.date_start,
    periodEnd: row.date_stop,
    currency: row.account_currency,
    timezone,
    spend: row.spend,
    impressions: row.impressions,
    reach: row.reach,
    frequency: row.frequency,
    cpm: row.cpm,
    ctr: row.ctr,
    inlineLinkClickCtr: row.inline_link_click_ctr,
    cpc: row.cpc,
    clicks: row.clicks,
    inlineLinkClicks: row.inline_link_clicks,
    conversions: {
      landing_page_views: row.landing_page_views,
      add_to_cart: row.add_to_cart,
      checkout: row.checkout,
      purchase: row.purchase,
      purchase_value: row.purchase_value,
      cpa: row.cpa,
      roas: row.roas,
      website_roas_api: row.website_roas_api,
      conversion_states: row.conversion_states,
    },
    dataQuality,
    snapshotSha256,
    fetchedAt: currentFetchedAt,
  };
}
