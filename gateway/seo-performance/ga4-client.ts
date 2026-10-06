import { z } from "zod";

import type {
  Ga4Compatibility,
  Ga4DateRange,
  Ga4DimensionFilterExpression,
  Ga4ItemMappingEvidence,
  Ga4ItemMappingResult,
  Ga4Metadata,
  Ga4PanelContract,
  Ga4PanelInput,
  Ga4PanelKind,
  Ga4PanelResult,
  Ga4QualityFlag,
  Ga4QualityMetadata,
  Ga4ReportRow,
  Ga4RunReportRequest,
  Ga4SamplingMetadata,
} from "./ga4-contracts";

const BASE_URL = "https://analyticsdata.googleapis.com/v1beta";
const DEFAULT_PAGE_SIZE = 10_000;
const MAX_PAGE_SIZE = 250_000;
const DEFAULT_MAX_ROWS = 1_000_000;
const EVENT_NAMES = ["view_item", "add_to_cart", "begin_checkout", "purchase"] as const;

const metadataFieldSchema = z.object({
  apiName: z.string().min(1),
  uiName: z.string().optional(),
  description: z.string().optional(),
}).passthrough();
const metadataSchema = z.object({
  dimensions: z.array(metadataFieldSchema).default([]),
  metrics: z.array(metadataFieldSchema).default([]),
}).passthrough();
const compatibilityFieldSchema = z.object({
  compatibility: z.string(),
  dimensionMetadata: z.object({ apiName: z.string() }).passthrough().optional(),
  metricMetadata: z.object({ apiName: z.string() }).passthrough().optional(),
}).passthrough();
const compatibilitySchema = z.object({
  dimensionCompatibilities: z.array(compatibilityFieldSchema).default([]),
  metricCompatibilities: z.array(compatibilityFieldSchema).default([]),
}).passthrough();
const samplingSchema = z.object({
  samplesReadCount: z.string().optional(),
  samplingSpaceSize: z.string().optional(),
}).passthrough();
const reportSchema = z.object({
  dimensionHeaders: z.array(z.object({ name: z.string() }).passthrough()).default([]),
  metricHeaders: z.array(z.object({ name: z.string() }).passthrough()).default([]),
  rows: z.array(z.object({
    dimensionValues: z.array(z.object({ value: z.string().default("") }).passthrough()).default([]),
    metricValues: z.array(z.object({ value: z.string().default("") }).passthrough()).default([]),
  }).passthrough()).default([]),
  rowCount: z.number().int().nonnegative().optional(),
  metadata: z.object({
    currencyCode: z.string().optional(),
    timeZone: z.string().optional(),
    dataLossFromOtherRow: z.boolean().optional(),
    subjectToThresholding: z.boolean().optional(),
    samplingMetadatas: z.array(samplingSchema).optional(),
  }).passthrough().optional(),
  propertyQuota: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

interface ParsedReportPage {
  readonly rows: readonly Ga4ReportRow[];
  readonly rowCount: number;
  readonly thresholding: boolean;
  readonly sampling: readonly Ga4SamplingMetadata[];
  readonly dataLossFromOtherRow: boolean;
  readonly timeZone: string | null;
  readonly currencyCode: string | null;
  readonly propertyQuota: Readonly<Record<string, unknown>> | null;
}

export type Ga4AccessTokenProvider = () => Promise<string>;

export function assertGa4PropertyId(propertyId: string): string {
  const normalized = propertyId.trim();
  if (!/^[1-9][0-9]*$/.test(normalized)) throw new Error("GA4_PROPERTY_ID_INVALID");
  return normalized;
}

function assertDateRange(input: Ga4DateRange): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate) || input.startDate > input.endDate) {
    throw new Error("GA4_DATE_RANGE_INVALID");
  }
}

function assertHostnameScope(hostnameScope: string): string {
  const normalized = hostnameScope.trim().toLowerCase().replace(/\.$/, "");
  if (!normalized || normalized.includes("://") || normalized.includes("/") || !/^[a-z0-9.-]+$/.test(normalized)) {
    throw new Error("GA4_HOSTNAME_SCOPE_INVALID");
  }
  return normalized;
}

function stringFilter(fieldName: string, value: string): Ga4DimensionFilterExpression {
  return { filter: { fieldName, stringFilter: { matchType: "EXACT", value, caseSensitive: false } } };
}

function baseFilter(hostnameScope: string, streamId?: string | null): Ga4DimensionFilterExpression[] {
  return [
    stringFilter("sessionSource", "google"),
    stringFilter("sessionMedium", "organic"),
    stringFilter("hostName", hostnameScope),
    ...(streamId ? [stringFilter("streamId", streamId)] : []),
  ];
}

const PANEL_DEFINITIONS: Readonly<Record<Ga4PanelKind, {
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly semantics: string;
}>> = {
  landing_engagement: {
    dimensions: ["date", "landingPage"],
    metrics: ["sessions", "totalUsers", "engagedSessions"],
    semantics: "Google Organic landing sessions, total users and engaged sessions; users are non-additive across rows.",
  },
  event_activity: {
    dimensions: ["date", "landingPage", "eventName"],
    metrics: ["eventCount"],
    semantics: "Independent event counts for observed event names; this is not a verified sequential funnel.",
  },
  landing_revenue: {
    dimensions: ["date", "landingPage"],
    metrics: ["purchaseRevenue"],
    semantics: "Revenue attributed to Google Organic landing sessions; this is not item or product revenue.",
  },
  item_performance: {
    dimensions: ["date", "itemId"],
    metrics: ["itemsViewed", "itemsAddedToCart", "itemsCheckedOut", "itemsPurchased", "itemRevenue"],
    semantics: "Item quantities and item revenue; quantities are not event counts and itemId requires evidence-backed product mapping.",
  },
};

export function createGa4PanelContract(kind: Ga4PanelKind, input: Ga4PanelInput, offset = input.offset ?? 0, limit = input.pageSize ?? DEFAULT_PAGE_SIZE): Ga4PanelContract {
  assertGa4PropertyId(input.propertyId);
  assertDateRange(input);
  const hostnameScope = assertHostnameScope(input.hostnameScope);
  if (!Number.isInteger(offset) || offset < 0) throw new Error("GA4_OFFSET_INVALID");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_PAGE_SIZE) throw new Error("GA4_LIMIT_INVALID");
  const definition = PANEL_DEFINITIONS[kind];
  const expressions: Ga4DimensionFilterExpression[] = baseFilter(hostnameScope, input.streamId);
  if (kind === "event_activity") expressions.push({ filter: { fieldName: "eventName", inListFilter: { values: EVENT_NAMES, caseSensitive: true } } });
  const request: Ga4RunReportRequest = {
    dateRanges: [{ startDate: input.startDate, endDate: input.endDate }],
    dimensions: definition.dimensions.map(name => ({ name })),
    metrics: definition.metrics.map(name => ({ name })),
    dimensionFilter: { andGroup: { expressions } },
    orderBys: definition.dimensions.map(dimensionName => ({ dimension: { dimensionName }, desc: false })),
    limit: String(limit),
    offset: String(offset),
    returnPropertyQuota: true,
  };
  return { kind, dimensions: definition.dimensions, metrics: definition.metrics, request };
}

function filterFieldNames(expression: Ga4DimensionFilterExpression): readonly string[] {
  return [
    ...(expression.filter ? [expression.filter.fieldName] : []),
    ...(expression.andGroup?.expressions.flatMap(filterFieldNames) ?? []),
  ];
}

function parseRows(raw: z.infer<typeof reportSchema>, contract: Ga4PanelContract): readonly Ga4ReportRow[] {
  const dimensionHeaders = raw.dimensionHeaders.map(header => header.name);
  const metricHeaders = raw.metricHeaders.map(header => header.name);
  if (dimensionHeaders.join("\0") !== contract.dimensions.join("\0") || metricHeaders.join("\0") !== contract.metrics.join("\0")) {
    throw new Error("GA4_RESPONSE_SCHEMA_MISMATCH");
  }
  return raw.rows.map(row => ({
    dimensions: Object.fromEntries(contract.dimensions.map((name, index) => [name, row.dimensionValues[index]?.value ?? ""])),
    metrics: Object.fromEntries(contract.metrics.map((name, index) => [name, row.metricValues[index]?.value ?? ""])),
  }));
}

function flags(input: Omit<Ga4QualityMetadata, "flags">): readonly Ga4QualityFlag[] {
  return [
    ...(input.thresholding ? ["THRESHOLDING" as const] : []),
    ...(input.sampling.length ? ["SAMPLING" as const] : []),
    ...(input.hasOtherRow ? ["OTHER_ROW" as const] : []),
    ...(input.dataLossFromOtherRow ? ["DATA_LOSS" as const] : []),
    ...(input.truncated ? ["TRUNCATED" as const] : []),
  ];
}

export class Ga4DataClient {
  constructor(private readonly tokenProvider: Ga4AccessTokenProvider, private readonly fetcher: typeof fetch = fetch) {}

  private async request(propertyId: string, operation: "metadata" | "checkCompatibility" | "runReport", body?: unknown): Promise<unknown> {
    const property = assertGa4PropertyId(propertyId);
    const suffix = operation === "metadata" ? "/metadata" : `:${operation}`;
    const response = await this.fetcher(`${BASE_URL}/properties/${property}${suffix}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${await this.tokenProvider()}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(25_000),
    });
    if (!response.ok) {
      throw new Error(response.status === 401 ? "GA4_RECONNECT_REQUIRED"
        : response.status === 403 ? "GA4_PERMISSION_OR_QUOTA"
          : response.status === 429 ? "GA4_QUOTA_EXCEEDED" : "GA4_TEMPORARILY_UNAVAILABLE");
    }
    return response.json();
  }

  async getMetadata(propertyId: string): Promise<Ga4Metadata> {
    const raw = metadataSchema.parse(await this.request(propertyId, "metadata"));
    const mapField = (field: z.infer<typeof metadataFieldSchema>) => ({ apiName: field.apiName, uiName: field.uiName ?? null, description: field.description ?? null });
    return { dimensions: raw.dimensions.map(mapField), metrics: raw.metrics.map(mapField) };
  }

  async checkCompatibility(propertyId: string, contract: Ga4PanelContract): Promise<Ga4Compatibility> {
    const raw = compatibilitySchema.parse(await this.request(propertyId, "checkCompatibility", {
      dimensions: contract.request.dimensions,
      metrics: contract.request.metrics,
      dimensionFilter: contract.request.dimensionFilter,
    }));
    const dimensionCompatibility = new Map(raw.dimensionCompatibilities.map(field => [field.dimensionMetadata?.apiName ?? "", field.compatibility]));
    const metricCompatibility = new Map(raw.metricCompatibilities.map(field => [field.metricMetadata?.apiName ?? "", field.compatibility]));
    const dimensions = contract.dimensions.map(apiName => {
      const compatibility = dimensionCompatibility.get(apiName) ?? "MISSING_COMPATIBILITY";
      return { apiName, compatible: compatibility === "COMPATIBLE", compatibility };
    });
    const metrics = contract.metrics.map(apiName => {
      const compatibility = metricCompatibility.get(apiName) ?? "MISSING_COMPATIBILITY";
      return { apiName, compatible: compatibility === "COMPATIBLE", compatibility };
    });
    return { dimensions, metrics, compatible: [...dimensions, ...metrics].every(field => field.compatible) };
  }

  private async reportPage(propertyId: string, contract: Ga4PanelContract): Promise<ParsedReportPage> {
    const raw = reportSchema.parse(await this.request(propertyId, "runReport", contract.request));
    const rows = parseRows(raw, contract);
    return {
      rows,
      rowCount: raw.rowCount ?? rows.length,
      thresholding: raw.metadata?.subjectToThresholding ?? false,
      sampling: (raw.metadata?.samplingMetadatas ?? []).map(entry => ({ samplesReadCount: entry.samplesReadCount ?? null, samplingSpaceSize: entry.samplingSpaceSize ?? null })),
      dataLossFromOtherRow: raw.metadata?.dataLossFromOtherRow ?? false,
      timeZone: raw.metadata?.timeZone ?? null,
      currencyCode: raw.metadata?.currencyCode ?? null,
      propertyQuota: raw.propertyQuota ?? null,
    };
  }

  async panel(kind: Ga4PanelKind, input: Ga4PanelInput): Promise<Ga4PanelResult> {
    const propertyId = assertGa4PropertyId(input.propertyId);
    if (input.queryFilter?.trim()) return { status: "unsupported", reason: "GSC_QUERY_FILTER_UNSUPPORTED", message: "GSC query filter is not supported by this GA4 report" };
    const initialContract = createGa4PanelContract(kind, input);
    const metadata = await this.getMetadata(propertyId);
    const metadataDimensions = new Set(metadata.dimensions.map(field => field.apiName));
    const metadataMetrics = new Set(metadata.metrics.map(field => field.apiName));
    const requiredDimensions = [...new Set([...initialContract.dimensions, ...filterFieldNames(initialContract.request.dimensionFilter)])];
    const unavailableFields = [
      ...requiredDimensions.filter(name => !metadataDimensions.has(name)),
      ...initialContract.metrics.filter(name => !metadataMetrics.has(name)),
    ];
    if (unavailableFields.length) return { status: "unavailable", reason: "GA4_METADATA_FIELD_UNAVAILABLE", fields: unavailableFields };
    const compatibility = await this.checkCompatibility(propertyId, initialContract);
    if (!compatibility.compatible) {
      const incompatibleFields = [...compatibility.dimensions, ...compatibility.metrics].filter(field => !field.compatible).map(field => field.apiName);
      return { status: "unavailable", reason: "GA4_REPORT_INCOMPATIBLE", fields: incompatibleFields };
    }

    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE;
    const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
    if (!Number.isInteger(maxRows) || maxRows < 1) throw new Error("GA4_MAX_ROWS_INVALID");
    let offset = input.offset ?? 0;
    let providerRowCount = 0;
    let thresholding = false;
    let dataLossFromOtherRow = false;
    let timeZone: string | null = null;
    let currencyCode: string | null = null;
    let propertyQuota: Readonly<Record<string, unknown>> | null = null;
    const sampling: Ga4SamplingMetadata[] = [];
    const rows: Ga4ReportRow[] = [];
    do {
      const limit = Math.min(pageSize, maxRows - rows.length);
      const contract = createGa4PanelContract(kind, input, offset, limit);
      const page = await this.reportPage(propertyId, contract);
      providerRowCount = page.rowCount;
      rows.push(...page.rows);
      thresholding ||= page.thresholding;
      dataLossFromOtherRow ||= page.dataLossFromOtherRow;
      sampling.push(...page.sampling);
      timeZone = page.timeZone ?? timeZone;
      currencyCode = page.currencyCode ?? currencyCode;
      propertyQuota = page.propertyQuota ?? propertyQuota;
      offset += page.rows.length;
      if (!page.rows.length) break;
    } while (offset < providerRowCount && rows.length < maxRows);

    const truncated = offset < providerRowCount;
    const hasOtherRow = rows.some(row => Object.values(row.dimensions).includes("(other)"));
    const qualityWithoutFlags = {
      thresholding, sampling, hasOtherRow, dataLossFromOtherRow, truncated, timeZone, currencyCode,
      propertyQuota, providerRowCount, fetchedRowCount: rows.length,
    };
    const quality: Ga4QualityMetadata = { ...qualityWithoutFlags, flags: flags(qualityWithoutFlags) };
    return { status: "available", kind, rows, quality, semantics: PANEL_DEFINITIONS[kind].semantics };
  }

  landingEngagement(input: Ga4PanelInput): Promise<Ga4PanelResult> { return this.panel("landing_engagement", input); }
  eventActivity(input: Ga4PanelInput): Promise<Ga4PanelResult> { return this.panel("event_activity", input); }
  landingRevenue(input: Ga4PanelInput): Promise<Ga4PanelResult> { return this.panel("landing_revenue", input); }
  itemPerformance(input: Ga4PanelInput): Promise<Ga4PanelResult> { return this.panel("item_performance", input); }
}

export function resolveGa4ItemMapping(itemId: string, at: string, evidence: readonly Ga4ItemMappingEvidence[]): Ga4ItemMappingResult {
  const atTime = Date.parse(at);
  if (!Number.isFinite(atTime)) throw new Error("GA4_MAPPING_TIME_INVALID");
  const applicable = evidence.filter(entry => {
    const observedAt = Date.parse(entry.observedAt);
    const validFrom = Date.parse(entry.validFrom);
    const validTo = entry.validTo === null ? null : Date.parse(entry.validTo);
    return entry.itemId === itemId && entry.evidenceId.trim() !== "" && entry.productId.trim() !== ""
      && Number.isFinite(observedAt) && Number.isFinite(validFrom) && (validTo === null || Number.isFinite(validTo))
      && observedAt <= atTime && validFrom <= atTime && (validTo === null || atTime < validTo);
  });
  const candidateProductIds = [...new Set(applicable.map(entry => entry.productId))].sort();
  if (candidateProductIds.length !== 1) {
    return { status: "unavailable", reason: candidateProductIds.length ? "ITEM_MAPPING_AMBIGUOUS" : "ITEM_MAPPING_NOT_FOUND", candidateProductIds };
  }
  return { status: "mapped", productId: candidateProductIds[0], evidence: applicable };
}
