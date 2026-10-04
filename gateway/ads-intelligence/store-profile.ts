/**
 * Store Profile Loader & Validator for FFP Ads Intelligence.
 * Loads and validates store-specific Ads configurations (e.g., config/stores/chillgen.ads.json).
 * Guarantees read-only defaults, isolated secret references, and valid platform accounts.
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AdsIntelligenceError } from "./conversions";
import type { StoreAdsProfile } from "./types";

export interface StoreProfileLoaderOptions {
  readonly configDir?: string;
  readonly env?: Record<string, string>;
}

/**
 * Lightweight YAML parser for store profile configuration files without external dependencies.
 */
export function parseSimpleYaml(yamlContent: string): unknown {
  const trimmed = yamlContent.trim();
  if (!trimmed) return {};
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      // continue to yaml parser
    }
  }

  const rawLines = yamlContent.split(/\r?\n/);
  const lines: { indent: number; text: string }[] = [];

  for (const rawLine of rawLines) {
    const withoutComment = stripYamlComment(rawLine);
    if (!withoutComment.trim()) continue;
    const indent = withoutComment.search(/\S/);
    lines.push({ indent, text: withoutComment.trim() });
  }

  if (lines.length === 0) return {};

  let index = 0;

  function parseBlock(currentIndent: number): unknown {
    if (index >= lines.length) return {};

    const firstLine = lines[index]!;
    if (firstLine.text.startsWith("- ")) {
      // List
      const list: unknown[] = [];
      while (index < lines.length && lines[index]!.indent === currentIndent && lines[index]!.text.startsWith("- ")) {
        const itemText = lines[index]!.text.slice(2).trim();
        index++;
        if (!itemText) {
          if (index < lines.length && lines[index]!.indent > currentIndent) {
            list.push(parseBlock(lines[index]!.indent));
          } else {
            list.push(null);
          }
        } else if (itemText.includes(":") && !itemText.startsWith("{") && !itemText.startsWith("[")) {
          const keyVal = parseKeyValue(itemText);
          const obj: Record<string, unknown> = { [keyVal.key]: keyVal.value };
          if (index < lines.length && lines[index]!.indent > currentIndent) {
            const nested = parseBlock(lines[index]!.indent) as Record<string, unknown>;
            Object.assign(obj, nested);
          }
          list.push(obj);
        } else {
          list.push(parseScalar(itemText));
        }
      }
      return list;
    }

    // Object
    const obj: Record<string, unknown> = {};
    while (index < lines.length && lines[index]!.indent === currentIndent) {
      const lineText = lines[index]!.text;
      const colonIdx = lineText.indexOf(":");
      if (colonIdx === -1) {
        index++;
        continue;
      }
      const key = lineText.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, "");
      const valuePart = lineText.slice(colonIdx + 1).trim();
      index++;

      if (!valuePart) {
        if (index < lines.length && lines[index]!.indent > currentIndent) {
          obj[key] = parseBlock(lines[index]!.indent);
        } else {
          obj[key] = null;
        }
      } else {
        obj[key] = parseScalar(valuePart);
      }
    }
    return obj;
  }

  return parseBlock(lines[0]!.indent);
}

function stripYamlComment(line: string): string {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
    } else if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
    } else if (char === "#" && !inSingleQuote && !inDoubleQuote) {
      return line.slice(0, i);
    }
  }
  return line;
}

function parseKeyValue(str: string): { key: string; value: unknown } {
  const colonIdx = str.indexOf(":");
  const key = str.slice(0, colonIdx).trim().replace(/^['"]|['"]$/g, "");
  const valuePart = str.slice(colonIdx + 1).trim();
  return { key, value: parseScalar(valuePart) };
}

function parseScalar(str: string): unknown {
  const trimmed = str.trim();
  if (trimmed === "" || trimmed === "~" || trimmed.toLowerCase() === "null") {
    return null;
  }
  if (trimmed.toLowerCase() === "true") return true;
  if (trimmed.toLowerCase() === "false") return false;

  if ((trimmed.startsWith("[") && trimmed.endsWith("]")) || (trimmed.startsWith("{") && trimmed.endsWith("}"))) {
    try {
      return JSON.parse(trimmed);
    } catch {
      if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
        return trimmed
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""))
          .filter(Boolean);
      }
    }
  }

  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }

  if (/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) {
    const num = Number(trimmed);
    if (!isNaN(num)) return num;
  }

  return trimmed;
}

/**
 * Validates an arbitrary object against the StoreAdsProfile interface.
 * Supports both camelCase and snake_case property names for JSON/YAML interoperability.
 */
export function validateStoreAdsProfile(raw: unknown): StoreAdsProfile {
  if (!raw || typeof raw !== "object") {
    throw new AdsIntelligenceError("Cấu hình store profile phải là một JSON object.");
  }

  const obj = raw as Record<string, unknown>;

  const rawStoreId = obj.storeId ?? obj.store_id;
  if (typeof rawStoreId !== "string" || !rawStoreId.trim()) {
    throw new AdsIntelligenceError("Store profile thiếu storeId hợp lệ.");
  }
  const storeId = rawStoreId.trim();

  const mode = obj.mode === "live" || obj.mode === "test" ? obj.mode : "read_only";

  const rawMarketCountries = obj.marketCountries ?? obj.market_countries;
  if (!Array.isArray(rawMarketCountries) || rawMarketCountries.length === 0) {
    throw new AdsIntelligenceError("Store profile cần ít nhất một marketCountry (ví dụ: ['US']).");
  }
  const marketCountries = rawMarketCountries.map(String);

  const rawReportingCurrency = obj.reportingCurrency ?? obj.reporting_currency;
  if (typeof rawReportingCurrency !== "string" || rawReportingCurrency.length !== 3) {
    throw new AdsIntelligenceError("Store profile thiếu reportingCurrency (ISO 4217, ví dụ: 'USD').");
  }
  const reportingCurrency = rawReportingCurrency.toUpperCase();

  // Validate Meta Config
  if (!obj.meta || typeof obj.meta !== "object") {
    throw new AdsIntelligenceError("Store profile thiếu cấu hình 'meta'.");
  }
  const rawMeta = obj.meta as Record<string, unknown>;
  const rawMetaAccountIds = rawMeta.accountIds ?? rawMeta.account_ids;
  const metaAccountIds = Array.isArray(rawMetaAccountIds) ? rawMetaAccountIds.map(String) : [];
  const rawMetaApiVersion = rawMeta.apiVersion ?? rawMeta.api_version;
  const metaApiVersion = typeof rawMetaApiVersion === "string" && rawMetaApiVersion.trim()
    ? rawMetaApiVersion.trim()
    : "v26.0";
  const rawPurchaseActionType = rawMeta.purchaseActionType ?? rawMeta.purchase_action_type;
  const purchaseActionType = typeof rawPurchaseActionType === "string" && rawPurchaseActionType.trim()
    ? rawPurchaseActionType.trim()
    : "offsite_conversion.fb_pixel_purchase";
  const rawAccountTimezone = rawMeta.accountTimezone ?? rawMeta.account_timezone;
  const accountTimezone = typeof rawAccountTimezone === "string" ? rawAccountTimezone : null;
  const rawSecretRef = rawMeta.secretRef ?? rawMeta.secret_ref;
  const secretRef = typeof rawSecretRef === "string" ? rawSecretRef : null;
  const rawProxyRef = rawMeta.proxyRef ?? rawMeta.proxy_ref;
  const proxyRef = typeof rawProxyRef === "string" ? rawProxyRef : null;
  const rawAttributionPolicyRef = rawMeta.attributionPolicyRef ?? rawMeta.attribution_policy_ref;
  const attributionPolicyRef = typeof rawAttributionPolicyRef === "string" ? rawAttributionPolicyRef : null;

  // Validate GA4 Config
  if (!obj.ga4 || typeof obj.ga4 !== "object") {
    throw new AdsIntelligenceError("Store profile thiếu cấu hình 'ga4'.");
  }
  const rawGa4 = obj.ga4 as Record<string, unknown>;
  const rawGa4PropertyId = rawGa4.propertyId ?? rawGa4.property_id;
  const ga4PropertyId = rawGa4PropertyId !== undefined && rawGa4PropertyId !== null
    ? String(rawGa4PropertyId).trim()
    : null;
  const rawPropertyTimezone = rawGa4.propertyTimezone ?? rawGa4.property_timezone;
  const propertyTimezone = typeof rawPropertyTimezone === "string" ? rawPropertyTimezone : null;
  const rawCredentialRef = rawGa4.credentialRef ?? rawGa4.credential_ref;
  const credentialRef = typeof rawCredentialRef === "string" ? rawCredentialRef : null;

  // Validate Shopify Config
  if (!obj.shopify || typeof obj.shopify !== "object") {
    throw new AdsIntelligenceError("Store profile thiếu cấu hình 'shopify'.");
  }
  const rawShopify = obj.shopify as Record<string, unknown>;
  const rawShopDomain = rawShopify.shopDomain ?? rawShopify.shop_domain;
  if (typeof rawShopDomain !== "string" || !rawShopDomain.trim()) {
    throw new AdsIntelligenceError("Cấu hình shopify thiếu shopDomain.");
  }
  const shopDomain = rawShopDomain.trim();
  const rawShopifyApiVersion = rawShopify.apiVersion ?? rawShopify.api_version;
  const shopifyApiVersion = typeof rawShopifyApiVersion === "string" && rawShopifyApiVersion.trim()
    ? rawShopifyApiVersion.trim()
    : "2026-07";
  const rawConnectionRef = rawShopify.connectionRef ?? rawShopify.connection_ref;
  const connectionRef = typeof rawConnectionRef === "string" ? rawConnectionRef : null;

  // Validate Competitor Config
  const rawCompetitors = (obj.competitors ?? {}) as Record<string, unknown>;
  const rawPrimary = rawCompetitors.primaryProvider ?? rawCompetitors.primary_provider;
  const primaryProvider =
    rawPrimary === "searchapi" || rawPrimary === "apify"
      ? rawPrimary
      : "scrapecreators";
  const rawBackup = rawCompetitors.backupProvider ?? rawCompetitors.backup_provider;
  const backupProvider = rawBackup === "apify" ? "apify" : "searchapi";
  const rawCostCap = rawCompetitors.monthlyCostCapUsd ?? rawCompetitors.monthly_cost_cap_usd;
  const monthlyCostCapUsd = typeof rawCostCap === "number" ? rawCostCap : 100;
  const watchlist = Array.isArray(rawCompetitors.watchlist) ? rawCompetitors.watchlist.map(String) : [];

  // Validate Business & Economics
  const rawBusiness = (obj.business ?? {}) as Record<string, unknown>;
  const rawTargetCpa = rawBusiness.targetCpa ?? rawBusiness.target_cpa;
  const targetCpa = typeof rawTargetCpa === "number" ? rawTargetCpa : null;
  const rawTargetContribution = rawBusiness.targetContributionPerOrder ?? rawBusiness.target_contribution_per_order;
  const targetContribution = typeof rawTargetContribution === "number" ? rawTargetContribution : null;
  const rawBreakEvenRoas = rawBusiness.breakEvenRoas ?? rawBusiness.break_even_roas;
  const breakEvenRoas = typeof rawBreakEvenRoas === "number" ? rawBreakEvenRoas : null;
  const rawBreakEvenCpa = rawBusiness.breakEvenCpa ?? rawBusiness.break_even_cpa;
  const breakEvenCpa = typeof rawBreakEvenCpa === "number" ? rawBreakEvenCpa : null;
  const rawCostProfileRef = rawBusiness.costProfileRef ?? rawBusiness.cost_profile_ref;
  const costProfileRef = typeof rawCostProfileRef === "string" ? rawCostProfileRef : null;

  // Validate Rules & Policies
  const rawRules = (obj.rules ?? {}) as Record<string, unknown>;
  const rawPolicyVersion = rawRules.policyVersion ?? rawRules.policy_version;
  const policyVersion = typeof rawPolicyVersion === "string" ? rawPolicyVersion : "1.0";
  const rawMaturityDays = rawRules.maturityDays ?? rawRules.maturity_days;
  const maturityDays = typeof rawMaturityDays === "number" ? rawMaturityDays : 7;
  const rawAllowFinancial = rawRules.allowFinancialRecommendations ?? rawRules.allow_financial_recommendations;
  const allowFinancialRecommendations = Boolean(rawAllowFinancial) && targetCpa !== null;

  // Validate Budgets & Guarded Actions
  const rawBudgets = (obj.budgets ?? {}) as Record<string, unknown>;
  const rawDailyCap = rawBudgets.totalDailyAuthorizedCap ?? rawBudgets.total_daily_authorized_cap;
  const totalDailyAuthorizedCap = typeof rawDailyCap === "number" ? rawDailyCap : null;
  const rawExpCap = rawBudgets.experimentAuthorizedCap ?? rawBudgets.experiment_authorized_cap;
  const experimentAuthorizedCap = typeof rawExpCap === "number" ? rawExpCap : null;
  const rawMaxChange = rawBudgets.maxChangePer24hPct ?? rawBudgets.max_change_per_24h_pct;
  const maxChangePer24hPct = typeof rawMaxChange === "number" ? rawMaxChange : 20;
  const rawCooldown = rawBudgets.cooldownHours ?? rawBudgets.cooldown_hours;
  const cooldownHours = typeof rawCooldown === "number" ? rawCooldown : 24;

  const rawActions = (obj.actions ?? {}) as Record<string, unknown>;
  const rawWritesEnabled = rawActions.externalWritesEnabled ?? rawActions.external_writes_enabled;
  const externalWritesEnabled = Boolean(rawWritesEnabled);
  const rawApprovalRequired = rawActions.approvalRequired ?? rawActions.approval_required;
  const approvalRequired = rawApprovalRequired !== false;

  return {
    storeId,
    mode,
    marketCountries,
    reportingCurrency,
    meta: {
      accountIds: metaAccountIds,
      accountTimezone,
      apiVersion: metaApiVersion,
      purchaseActionType,
      secretRef,
      proxyRef,
      attributionPolicyRef,
    },
    ga4: {
      propertyId: ga4PropertyId,
      propertyTimezone,
      credentialRef,
    },
    shopify: {
      shopDomain,
      apiVersion: shopifyApiVersion,
      connectionRef,
    },
    competitors: {
      primaryProvider,
      backupProvider,
      monthlyCostCapUsd,
      watchlist,
    },
    business: {
      costProfileRef,
      targetCpa,
      targetContributionPerOrder: targetContribution,
      breakEvenRoas,
      breakEvenCpa,
    },
    rules: {
      policyVersion,
      maturityDays,
      allowFinancialRecommendations,
    },
    budgets: {
      totalDailyAuthorizedCap,
      experimentAuthorizedCap,
      maxChangePer24hPct,
      cooldownHours,
    },
    actions: {
      externalWritesEnabled,
      approvalRequired,
    },
  };
}

/**
 * Loads a StoreAdsProfile from a JSON or YAML file in config/stores/<storeId>.ads.(json|yaml|yml).
 */
export function loadStoreAdsProfile(
  storeId: string,
  options: StoreProfileLoaderOptions = {},
): StoreAdsProfile {
  const baseDir = options.configDir
    ? resolve(options.configDir)
    : resolve(process.cwd(), "config", "stores");

  const extensions = [".ads.json", ".ads.yaml", ".ads.yml"];
  let filePath: string | null = null;
  for (const ext of extensions) {
    const candidate = resolve(baseDir, `${storeId}${ext}`);
    if (existsSync(candidate)) {
      filePath = candidate;
      break;
    }
  }

  if (!filePath) {
    throw new AdsIntelligenceError(
      `Không tìm thấy file cấu hình Store Ads Profile tại: ${resolve(baseDir, `${storeId}.ads.json`)} (hỗ trợ .json, .yaml, .yml)`,
    );
  }

  let parsed: unknown;
  try {
    const rawContent = readFileSync(filePath, "utf-8");
    if (filePath.endsWith(".json")) {
      parsed = JSON.parse(rawContent);
    } else {
      parsed = parseSimpleYaml(rawContent);
    }
  } catch (err) {
    throw new AdsIntelligenceError(
      `Lỗi cú pháp trong file cấu hình store profile ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return validateStoreAdsProfile(parsed);
}

/**
 * Lists all available store profile IDs in the config directory.
 */
export function listAvailableStoreProfileIds(
  options: StoreProfileLoaderOptions = {},
): readonly string[] {
  const baseDir = options.configDir
    ? resolve(options.configDir)
    : resolve(process.cwd(), "config", "stores");

  if (!existsSync(baseDir)) {
    return [];
  }

  const files = readdirSync(baseDir);
  const ids = new Set<string>();
  for (const file of files) {
    if (file.includes(".example.")) continue;
    const match = file.match(/^(.+)\.ads\.(json|yaml|yml)$/);
    if (match && match[1]) {
      ids.add(match[1]);
    }
  }
  return Array.from(ids);
}

