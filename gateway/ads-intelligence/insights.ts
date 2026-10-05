/**
 * Delivery Insights Normalization and Quality Checks.
 * Ported from meta_demo/insights.py:
 * - Direct period totals at each level; never roll up reach.
 * - Zero denominator handling for frequency, cpm, ctr, and cpc.
 * - Strict date validation relative to account timezone.
 * - Structural and spend quality notes.
 */

import {
  ACTION_TYPES,
  AdsIntelligenceError,
  CONVERSION_FIELDS,
  CONVERSION_METRICS,
  parseDecimalString,
  websiteMetrics,
} from "./conversions";
import type {
  AdsEntityLevel,
  MetaAccountInfo,
  NormalizedMetaInsightRow,
  RawMetaInsightRow,
} from "./types";

export const LEVELS: readonly AdsEntityLevel[] = ["campaign", "adset", "ad"] as const;

export const METRICS = [
  "spend",
  "impressions",
  "reach",
  "frequency",
  "cpm",
  "ctr",
  "inline_link_click_ctr",
  "cpc",
  "clicks",
  "inline_link_clicks",
] as const;

export const COMMON = [
  "account_id",
  "account_currency",
  "date_start",
  "date_stop",
] as const;

export const IDS = [
  "campaign_id",
  "campaign_name",
  "adset_id",
  "adset_name",
  "ad_id",
  "ad_name",
] as const;

export const DENOMINATORS: Readonly<Record<string, string>> = {
  frequency: "reach",
  cpm: "impressions",
  ctr: "impressions",
  inline_link_click_ctr: "impressions",
  cpc: "clicks",
} as const;

/**
 * Generates audit notes for data discrepancies in Meta insights:
 * 1. inline_link_clicks > clicks.
 * 2. Sum of child ad spend != parent campaign spend.
 */
export function qualityNotes(
  rows: Readonly<Record<string, readonly NormalizedMetaInsightRow[]>>,
): string[] {
  const notes: string[] = [];

  for (const [level, items] of Object.entries(rows)) {
    for (const item of items) {
      if (
        item.clicks !== null &&
        item.inline_link_clicks !== null &&
        Number(item.inline_link_clicks) > Number(item.clicks)
      ) {
        notes.push(
          `${level} ${item.object_id}: Link clicks lớn hơn Clicks tổng trong response Meta; cần đối chiếu Ads Manager.`,
        );
      }
    }
  }

  if (rows.campaign && rows.ad) {
    for (const parent of rows.campaign) {
      const children = rows.ad.filter((r) => r.campaign_id === parent.campaign_id);
      if (
        parent.spend !== null &&
        children.length > 0 &&
        children.every((r) => r.spend !== null)
      ) {
        const total = children.reduce((acc, r) => acc + Number(r.spend), 0);
        if (Math.abs(total - Number(parent.spend)) > 0.0001) {
          notes.push(
            `Campaign ${parent.campaign_id}: Spend cấp campaign khác tổng các dòng ad trả về; kiểm tra phạm vi/đối tượng trong Ads Manager. Không thay thế số liệu Meta.`,
          );
        }
      }
    }
  }

  return notes;
}

/**
 * Parses YYYY-MM-DD strictly into a Date (UTC midnight) checking for real calendar days.
 */
function parseStrictIsoDate(str: unknown): Date | null {
  if (typeof str !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return null;
  }
  const parts = str.split("-").map(Number);
  const year = parts[0];
  const month = parts[1];
  const day = parts[2];
  if (!year || !month || !day) return null;

  const dt = new Date(Date.UTC(year, month - 1, day));
  if (
    dt.getUTCFullYear() !== year ||
    dt.getUTCMonth() !== month - 1 ||
    dt.getUTCDate() !== day
  ) {
    return null;
  }
  return dt;
}

/**
 * Returns formatted ISO YYYY-MM-DD date in a specified IANA timezone.
 */
function getIsoDateInTimezone(date: Date, tz: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(date);
}

/**
 * Computes since and until dates according to account timezone.
 * Defaults to the last 7 completed days (yesterday - 6 days to yesterday).
 */
export function datesForAccount(
  tz: string,
  since?: string | null,
  until?: string | null,
  now?: Date,
  maxDays = 31,
): { since: string; until: string } {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
  } catch {
    throw new AdsIntelligenceError("Timezone tài khoản không hợp lệ hoặc thiếu tzdata.");
  }

  const referenceDate = now ?? new Date();
  const todayIso = getIsoDateInTimezone(referenceDate, tz);
  const todayDate = parseStrictIsoDate(todayIso)!;

  // Default: last 7 completed days
  const isSinceEmpty = since === undefined || since === null;
  const isUntilEmpty = until === undefined || until === null;

  if (isSinceEmpty && isUntilEmpty) {
    const yesterday = new Date(todayDate.getTime() - 86400000);
    const sevenDaysAgo = new Date(todayDate.getTime() - 7 * 86400000);
    return {
      since: sevenDaysAgo.toISOString().slice(0, 10),
      until: yesterday.toISOString().slice(0, 10),
    };
  }

  const startDate = parseStrictIsoDate(since);
  const endDate = parseStrictIsoDate(until);

  if (!startDate || !endDate || typeof since !== "string" || typeof until !== "string") {
    throw new AdsIntelligenceError("Cần cả since/until theo định dạng YYYY-MM-DD.");
  }

  if (startDate > endDate || endDate >= todayDate) {
    throw new AdsIntelligenceError(
      "Khoảng ngày phải tăng dần và kết thúc trước hôm nay theo timezone tài khoản.",
    );
  }

  const diffDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000);
  if (diffDays >= maxDays) {
    throw new AdsIntelligenceError(
      `Chế độ này giới hạn ${maxDays} ngày mỗi truy vấn; hãy thu hẹp khoảng ngày.`,
    );
  }

  return { since, until };
}

/**
 * Normalizes a single raw insight row from Meta Graph API.
 * Validates IDs, account currency, date ranges, and zeroes out invalid ratio denominators.
 */
export function normalize(
  row: Readonly<RawMetaInsightRow>,
  level: AdsEntityLevel,
  account: Readonly<MetaAccountInfo>,
  since: string,
  until: string,
): NormalizedMetaInsightRow {
  const requiredIds: string[] = [];
  if (level === "account") {
    requiredIds.push("account_id");
  } else {
    requiredIds.push("campaign_id");
    if (level === "adset" || level === "ad") {
      requiredIds.push("adset_id");
    }
    if (level === "ad") {
      requiredIds.push("ad_id");
    }
  }

  for (const idKey of requiredIds) {
    const val = row[idKey];
    if (typeof val !== "string" || !/^\d+$/.test(val)) {
      throw new AdsIntelligenceError("Insights thiếu ID hoặc ID không hợp lệ.");
    }
  }

  const expectedAccountId = account.id.replace(/^act_/, "");
  const rowAccountId = String(row.account_id ?? "").replace(/^act_/, "");
  if (rowAccountId !== expectedAccountId || row.account_currency !== account.currency) {
    throw new AdsIntelligenceError("Insights không khớp account/currency yêu cầu.");
  }

  const startDate = parseStrictIsoDate(row.date_start);
  const stopDate = parseStrictIsoDate(row.date_stop);
  const reqSince = parseStrictIsoDate(since);
  const reqUntil = parseStrictIsoDate(until);

  if (!startDate || !stopDate || !reqSince || !reqUntil) {
    throw new AdsIntelligenceError("Insights trả khoảng ngày ngoài yêu cầu hoặc không hợp lệ.");
  }

  if (startDate < reqSince || stopDate > reqUntil || startDate > stopDate) {
    throw new AdsIntelligenceError("Insights trả khoảng ngày ngoài yêu cầu hoặc không hợp lệ.");
  }

  const objectId = level === "account"
    ? String(row.account_id ?? "")
    : String(row[`${level}_id`] ?? "");
  const normalizedMetrics: Record<string, string | null> = {};

  for (const key of METRICS) {
    const rawVal = row[key];
    if (rawVal === null || rawVal === undefined) {
      normalizedMetrics[key] = null;
      continue;
    }

    try {
      normalizedMetrics[key] = parseDecimalString(rawVal);
    } catch {
      throw new AdsIntelligenceError(`Metric ${key} không phải số hợp lệ.`);
    }
  }

  // Handle zero denominators
  for (const [key, denominator] of Object.entries(DENOMINATORS)) {
    const denomVal = normalizedMetrics[denominator];
    if (denomVal !== null && denomVal !== undefined && Number(denomVal) === 0) {
      normalizedMetrics[key] = null;
    }
  }

  const { metrics: conversions, warnings: conversionWarnings } = websiteMetrics(
    row as Record<string, unknown>,
    normalizedMetrics.spend,
  );

  return {
    level,
    object_id: objectId,
    data_status: "reported",
    account_id: String(row.account_id),
    account_currency: String(row.account_currency),
    date_start: String(row.date_start),
    date_stop: String(row.date_stop),
    campaign_id: row.campaign_id ? String(row.campaign_id) : undefined,
    campaign_name: row.campaign_name ? String(row.campaign_name) : undefined,
    adset_id: row.adset_id ? String(row.adset_id) : undefined,
    adset_name: row.adset_name ? String(row.adset_name) : undefined,
    ad_id: row.ad_id ? String(row.ad_id) : undefined,
    ad_name: row.ad_name ? String(row.ad_name) : undefined,
    spend: normalizedMetrics.spend ?? null,
    impressions: normalizedMetrics.impressions ?? null,
    reach: normalizedMetrics.reach ?? null,
    frequency: normalizedMetrics.frequency ?? null,
    cpm: normalizedMetrics.cpm ?? null,
    ctr: normalizedMetrics.ctr ?? null,
    inline_link_click_ctr: normalizedMetrics.inline_link_click_ctr ?? null,
    cpc: normalizedMetrics.cpc ?? null,
    clicks: normalizedMetrics.clicks ?? null,
    inline_link_clicks: normalizedMetrics.inline_link_clicks ?? null,
    landing_page_views: conversions.landing_page_views,
    add_to_cart: conversions.add_to_cart,
    checkout: conversions.checkout,
    purchase: conversions.purchase,
    purchase_value: conversions.purchase_value,
    cpa: conversions.cpa,
    roas: conversions.roas,
    website_roas_api: conversions.website_roas_api,
    conversion_states: conversions.conversion_states,
    conversion_warnings: conversionWarnings,
  };
}
