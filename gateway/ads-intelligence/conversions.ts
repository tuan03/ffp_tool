/**
 * Website-only conversion action mapping and financial ratio calculation.
 * Ported from meta_demo/conversions.py with strict decimal handling and alias isolation.
 * Never sums overlapping Meta action aliases (e.g. omni_purchase vs fb_pixel_purchase).
 */

import type { ConversionState, NormalizedMetaConversions, RawActionItem } from "./types";

export class AdsIntelligenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdsIntelligenceError";
  }
}

export const ACTION_TYPES = {
  landing_page_views: "landing_page_view",
  add_to_cart: "offsite_conversion.fb_pixel_add_to_cart",
  checkout: "offsite_conversion.fb_pixel_initiate_checkout",
  purchase: "offsite_conversion.fb_pixel_purchase",
} as const;

export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  add_to_cart: ["add_to_cart", "omni_add_to_cart"],
  checkout: ["initiate_checkout", "omni_initiated_checkout"],
  purchase: ["purchase", "omni_purchase"],
} as const;

export const CONVERSION_FIELDS = ["actions", "action_values", "website_purchase_roas"] as const;

export const CONVERSION_METRICS = [
  "landing_page_views",
  "add_to_cart",
  "checkout",
  "purchase",
  "purchase_value",
  "cpa",
  "roas",
  "website_roas_api",
] as const;

export type ActionMetricName = keyof typeof ACTION_TYPES;

/**
 * Validates a number string and returns normalized format or throws error.
 * Supports standard decimals, scientific notation (e.g. 1e3 -> 1000), and leading plus (+150 -> 150).
 * Rejects negative numbers, empty strings, NaN, Infinity, and malformed strings.
 */
export function parseDecimalString(raw: unknown): string {
  if (typeof raw === "number") {
    if (!Number.isFinite(raw) || isNaN(raw) || raw < 0) {
      throw new Error("Invalid number");
    }
    if (Number.isInteger(raw)) {
      return raw.toString();
    }
    return raw.toFixed(10).replace(/\.?0+$/, "");
  }

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === "NaN" || trimmed === "Infinity" || trimmed === "-Infinity") {
      throw new Error("Invalid number");
    }
    // Verify valid numeric format: non-negative decimal with optional scientific exponent
    if (!/^[+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
      throw new Error("Invalid decimal format");
    }
    const num = Number(trimmed);
    if (!Number.isFinite(num) || isNaN(num) || num < 0) {
      throw new Error("Invalid number");
    }
    if (/[eE]/.test(trimmed)) {
      return Number.isInteger(num) ? num.toString() : num.toFixed(10).replace(/\.?0+$/, "");
    }
    return trimmed.replace(/^\+/, "");
  }

  throw new Error("Invalid value type");
}

/**
 * Extracts and validates an action field array into a Map<action_type, string | null>.
 * Prevents duplicate action types to avoid double-counting.
 */
export function actionMap(
  row: Readonly<Record<string, unknown>>,
  field: string,
): Map<string, string | null> | null {
  const values = row[field];
  if (values === undefined || values === null) {
    return null;
  }

  if (!Array.isArray(values)) {
    throw new AdsIntelligenceError(`${field} không phải danh sách action.`);
  }

  const result = new Map<string, string | null>();

  for (const item of values) {
    if (!item || typeof item !== "object" || typeof (item as RawActionItem).action_type !== "string") {
      throw new AdsIntelligenceError(`${field} thiếu action_type.`);
    }

    const typedItem = item as RawActionItem;
    const key = typedItem.action_type;

    if (result.has(key)) {
      throw new AdsIntelligenceError(
        `${field} có action_type trùng; không tự cộng để tránh đếm trùng.`,
      );
    }

    const rawVal = typedItem.value;
    if (rawVal === undefined || rawVal === null) {
      result.set(key, null);
      continue;
    }

    try {
      const normalizedStr = parseDecimalString(rawVal);
      result.set(key, normalizedStr);
    } catch {
      throw new AdsIntelligenceError(`${field} có giá trị action không hợp lệ.`);
    }
  }

  return result;
}

/**
 * Computes high-precision ratio (numerator / denominator) as a decimal string.
 * Returns null if numerator or denominator is null/undefined or denominator is 0.
 */
export function ratio(
  numerator: string | number | null | undefined,
  denominator: string | number | null | undefined,
): string | null {
  if (numerator === null || numerator === undefined || denominator === null || denominator === undefined) {
    return null;
  }

  const num = typeof numerator === "number" ? numerator : Number(numerator);
  const den = typeof denominator === "number" ? denominator : Number(denominator);

  if (!Number.isFinite(num) || !Number.isFinite(den) || isNaN(num) || isNaN(den) || den === 0) {
    return null;
  }

  const result = num / den;
  if (!Number.isFinite(result) || isNaN(result)) {
    return null;
  }

  // Format to clean decimal string without scientific notation
  if (Number.isInteger(result)) {
    return result.toString();
  }

  // Preserve precision up to 10 decimal places, trim trailing zeroes
  const fixed = result.toFixed(10).replace(/\.?0+$/, "");
  return fixed;
}

export interface WebsiteMetricsResult {
  readonly metrics: NormalizedMetaConversions;
  readonly warnings: readonly string[];
}

/**
 * Normalizes website conversion actions and calculates CPA, ROAS, and state markers.
 * Guarantees that generic or omni aliases are NEVER counted as website pixel purchases.
 */
export function websiteMetrics(
  raw: Readonly<Record<string, unknown>>,
  spend: string | number | null | undefined,
): WebsiteMetricsResult {
  const actions = actionMap(raw, "actions");
  const values = actionMap(raw, "action_values");
  const roasValues = actionMap(raw, "website_purchase_roas");

  const metricsObj: Record<string, string | null> = {};
  const statesObj: Record<string, ConversionState> = {};

  // 1. Process Core Website Actions
  for (const [name, actionType] of Object.entries(ACTION_TYPES)) {
    let val: string | null = null;
    let state: ConversionState;

    if (actions === null) {
      val = null;
      state = "field_not_returned";
    } else if (actions.has(actionType)) {
      val = actions.get(actionType) ?? null;
      state = val !== null ? "reported" : "value_missing";
    } else {
      const aliases = ALIASES[name] ?? [];
      const hasPositiveAlias = aliases.some((alias: string) => {
        const aliasVal = actions.get(alias);
        return aliasVal !== null && aliasVal !== undefined && Number(aliasVal) > 0;
      });

      if (hasPositiveAlias) {
        val = null;
        state = "website_scope_unresolved";
      } else {
        val = "0";
        state = "not_reported";
      }
    }

    metricsObj[name] = val;
    statesObj[name] = state;
  }

  // 2. Process Website Purchase Value
  const purchaseType = ACTION_TYPES.purchase;
  const purchasesStr = metricsObj.purchase;
  const purchases = purchasesStr !== null ? Number(purchasesStr) : null;
  let purchaseValueStr: string | null = null;

  if (values !== null && values.has(purchaseType)) {
    const reportedAmount = values.get(purchaseType) ?? null;
    purchaseValueStr = reportedAmount;
    statesObj.purchase_value = reportedAmount !== null ? "reported" : "value_missing";
  } else if (purchases === 0) {
    purchaseValueStr = "0";
    statesObj.purchase_value = "inferred_no_reported_purchases";
  } else {
    purchaseValueStr = null;
    statesObj.purchase_value = purchases !== null ? "value_missing" : "website_scope_unresolved";
  }
  metricsObj.purchase_value = purchaseValueStr;

  // 3. Normalized Spend
  let spendStr: string | null = null;
  if (spend !== null && spend !== undefined) {
    try {
      spendStr = parseDecimalString(spend);
    } catch {
      spendStr = null;
    }
  }

  // 4. CPA and ROAS Calculation
  metricsObj.cpa = ratio(spendStr, purchasesStr);
  metricsObj.roas = ratio(purchaseValueStr, spendStr);

  const numSpend = spendStr !== null ? Number(spendStr) : null;
  statesObj.cpa =
    metricsObj.cpa !== null
      ? "derived"
      : purchases === 0
        ? "zero_purchases"
        : "input_missing";

  statesObj.roas =
    metricsObj.roas !== null
      ? "derived"
      : numSpend === 0
        ? "zero_spend"
        : "input_missing";

  // 5. Direct Meta API Website ROAS
  const apiRoas = roasValues ? (roasValues.get(purchaseType) ?? null) : null;
  metricsObj.website_roas_api = apiRoas;
  statesObj.website_roas_api = apiRoas !== null ? "reported" : "not_returned";

  // 6. Quality Warnings Check
  const warnings: string[] = [];

  if (apiRoas !== null && metricsObj.roas !== null) {
    const diff = Math.abs(Number(apiRoas) - Number(metricsObj.roas));
    if (diff > 0.000001) {
      warnings.push(
        "ROAS tính từ website purchase value khác website_purchase_roas API; giữ cả hai để đối chiếu.",
      );
    }
  }

  if (purchases === 0 && purchaseValueStr !== null && Number(purchaseValueStr) > 0) {
    warnings.push(
      "API trả website purchase value dương nhưng không có website purchase; cần đối chiếu.",
    );
  }

  if (Object.values(statesObj).includes("website_scope_unresolved")) {
    warnings.push(
      "Chưa xác định được chuyển đổi website; không dùng purchase/omni thay thế.",
    );
  }

  const normalizedConversions: NormalizedMetaConversions = {
    landing_page_views: metricsObj.landing_page_views,
    add_to_cart: metricsObj.add_to_cart,
    checkout: metricsObj.checkout,
    purchase: metricsObj.purchase,
    purchase_value: metricsObj.purchase_value,
    cpa: metricsObj.cpa,
    roas: metricsObj.roas,
    website_roas_api: metricsObj.website_roas_api,
    conversion_states: statesObj,
  };

  return {
    metrics: normalizedConversions,
    warnings,
  };
}
