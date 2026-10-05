export const GSC_ROW_LIMIT = 25_000;
export const GSC_DAILY_ROW_LIMIT = 50_000;
export const GSC_COUNTRY_MAPPING_VERSION = "iso-3166-alpha3-v1";
export const GSC_DEVICE_MAPPING_VERSION = "gsc-device-v1";

export type GscContractId = "G01" | "G02" | "G03" | "G04" | "G05";
export type GscDataset = "property" | "page" | "query" | "country" | "device";
export type GscDimension = "date" | "page" | "query" | "country" | "device";
export type GscAggregationType = "auto" | "byPage" | "byProperty";
export type GscFilterOperator = "equals" | "contains";
export type CanonicalDevice = "DESKTOP" | "MOBILE" | "TABLET" | "UNKNOWN";

export interface GscDateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface GscDimensionFilter {
  readonly dimension: Exclude<GscDimension, "date">;
  readonly operator: GscFilterOperator;
  readonly expression: string;
}

export interface GscSearchAnalyticsRequest extends GscDateRange {
  readonly dimensions: readonly GscDimension[];
  readonly type: "web";
  readonly dataState: "final";
  readonly aggregationType: GscAggregationType;
  readonly dimensionFilterGroups: readonly [{
    readonly groupType: "and";
    readonly filters: readonly GscDimensionFilter[];
  }];
  readonly rowLimit: typeof GSC_ROW_LIMIT;
  readonly startRow: number;
}

export interface GscQueryContract {
  readonly contractId: GscContractId;
  readonly dataset: GscDataset;
  /** The exact provider identity. It is encoded only when building the URL. */
  readonly rawProperty: string;
  readonly request: GscSearchAnalyticsRequest;
}

export interface GscCommonFilters {
  readonly country?: string;
  readonly device?: CanonicalDevice;
  readonly query?: string;
}

export interface GscRawSearchRow {
  readonly keys?: readonly string[];
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number;
  readonly position: number;
}

interface GscNormalizedRowBase {
  readonly identity: string;
  readonly clicks: number;
  readonly impressions: number;
  /** Ratio in the provider's 0-1 representation. */
  readonly ctr: number;
  readonly position: number;
}

export interface GscPropertyRow extends GscNormalizedRowBase {
  readonly dataset: "property";
  readonly date: string | null;
}

export interface GscPageRow extends GscNormalizedRowBase {
  readonly dataset: "page";
  readonly page: string;
}

export interface GscQueryRow extends GscNormalizedRowBase {
  readonly dataset: "query";
  readonly page: string;
  readonly query: string;
}

export interface GscCountryRow extends GscNormalizedRowBase {
  readonly dataset: "country";
  readonly country: string;
  readonly countryMappingVersion: typeof GSC_COUNTRY_MAPPING_VERSION;
}

export interface GscDeviceRow extends GscNormalizedRowBase {
  readonly dataset: "device";
  readonly device: CanonicalDevice;
  readonly deviceMappingVersion: typeof GSC_DEVICE_MAPPING_VERSION;
}

export type GscNormalizedRow = GscPropertyRow | GscPageRow | GscQueryRow | GscCountryRow | GscDeviceRow;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SEARCH_ANALYTICS_BASE = "https://www.googleapis.com/webmasters/v3/sites";

function requireText(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0")) throw new Error(code);
  return normalized;
}

function requireDate(value: string): string {
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  if (!DATE_PATTERN.test(value) || Number.isNaN(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error("GSC_DATE_INVALID");
  }
  return value;
}

function requireRange(range: GscDateRange): GscDateRange {
  const startDate = requireDate(range.startDate);
  const endDate = requireDate(range.endDate);
  if (startDate > endDate) throw new Error("GSC_DATE_RANGE_INVALID");
  return { startDate, endDate };
}

function commonFilters(filters: GscCommonFilters = {}): readonly GscDimensionFilter[] {
  const values: GscDimensionFilter[] = [];
  if (filters.country !== undefined) {
    values.push({ dimension: "country", operator: "equals", expression: normalizeGscCountry(filters.country).toLowerCase() });
  }
  if (filters.device !== undefined) {
    if (filters.device === "UNKNOWN") throw new Error("GSC_DEVICE_FILTER_INVALID");
    values.push({ dimension: "device", operator: "equals", expression: filters.device });
  }
  if (filters.query !== undefined) {
    values.push({ dimension: "query", operator: "contains", expression: requireText(filters.query, "GSC_QUERY_FILTER_INVALID") });
  }
  return values;
}

function request(input: {
  readonly range: GscDateRange;
  readonly dimensions: readonly GscDimension[];
  readonly aggregationType: GscAggregationType;
  readonly filters?: readonly GscDimensionFilter[];
}): GscSearchAnalyticsRequest {
  const range = requireRange(input.range);
  return {
    ...range,
    dimensions: [...input.dimensions],
    type: "web",
    dataState: "final",
    aggregationType: input.aggregationType,
    dimensionFilterGroups: [{ groupType: "and", filters: [...(input.filters ?? [])] }],
    rowLimit: GSC_ROW_LIMIT,
    startRow: 0,
  };
}

function contract(input: Omit<GscQueryContract, "rawProperty"> & { readonly rawProperty: string }): GscQueryContract {
  return { ...input, rawProperty: requireText(input.rawProperty, "GSC_PROPERTY_REQUIRED") };
}

export function buildGscSearchAnalyticsUrl(rawProperty: string): string {
  const property = requireText(rawProperty, "GSC_PROPERTY_REQUIRED");
  return `${SEARCH_ANALYTICS_BASE}/${encodeURIComponent(property)}/searchAnalytics/query`;
}

export function buildG01PropertyRequest(input: {
  readonly rawProperty: string;
  readonly range: GscDateRange;
  readonly groupByDate?: boolean;
  readonly filters?: GscCommonFilters;
}): GscQueryContract {
  return contract({
    contractId: "G01",
    dataset: "property",
    rawProperty: input.rawProperty,
    request: request({
      range: input.range,
      dimensions: input.groupByDate ? ["date"] : [],
      aggregationType: "byProperty",
      filters: commonFilters(input.filters),
    }),
  });
}

export function buildG02PageRequest(input: {
  readonly rawProperty: string;
  readonly range: GscDateRange;
  readonly page?: string;
  readonly filters?: GscCommonFilters;
}): GscQueryContract {
  const page = input.page === undefined ? null : requireText(input.page, "GSC_PAGE_FILTER_INVALID");
  return contract({
    contractId: "G02",
    dataset: "page",
    rawProperty: input.rawProperty,
    request: request({
      range: input.range,
      dimensions: page === null ? ["page"] : [],
      aggregationType: "auto",
      filters: [...commonFilters(input.filters), ...(page === null ? [] : [{ dimension: "page" as const, operator: "equals" as const, expression: page }])],
    }),
  });
}

export function buildG03ObservedQueryRequest(input: {
  readonly rawProperty: string;
  readonly range: GscDateRange;
  readonly page: string;
  readonly filters?: GscCommonFilters;
}): GscQueryContract {
  const page = requireText(input.page, "GSC_PAGE_FILTER_REQUIRED");
  return contract({
    contractId: "G03",
    dataset: "query",
    rawProperty: input.rawProperty,
    request: request({
      range: input.range,
      dimensions: ["query"],
      aggregationType: "auto",
      filters: [{ dimension: "page", operator: "equals", expression: page }, ...commonFilters(input.filters)],
    }),
  });
}

export function buildG04SliceRequest(input: {
  readonly rawProperty: string;
  readonly range: GscDateRange;
  readonly dimension: "country" | "device";
  readonly page?: string;
  readonly filters?: GscCommonFilters;
}): GscQueryContract {
  const pageFilters: readonly GscDimensionFilter[] = input.page === undefined ? [] : [{
    dimension: "page",
    operator: "equals",
    expression: requireText(input.page, "GSC_PAGE_FILTER_INVALID"),
  }];
  return contract({
    contractId: "G04",
    dataset: input.dimension,
    rawProperty: input.rawProperty,
    request: request({
      range: input.range,
      dimensions: [input.dimension],
      aggregationType: input.page === undefined ? "byProperty" : "auto",
      filters: [...pageFilters, ...commonFilters(input.filters)],
    }),
  });
}

export function buildG05ComparisonRequests(input: {
  readonly base: GscQueryContract;
  readonly before: GscDateRange;
  readonly after: GscDateRange;
}): readonly [GscQueryContract, GscQueryContract] {
  const clone = (range: GscDateRange): GscQueryContract => ({
    ...input.base,
    contractId: "G05",
    request: { ...input.base.request, ...requireRange(range), startRow: 0 },
  });
  return [clone(input.before), clone(input.after)];
}

export function withGscStartRow(value: GscQueryContract, startRow: number): GscQueryContract {
  if (!Number.isSafeInteger(startRow) || startRow < 0 || startRow % GSC_ROW_LIMIT !== 0) throw new Error("GSC_START_ROW_INVALID");
  return { ...value, request: { ...value.request, startRow } };
}

export function normalizeGscCountry(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) throw new Error("GSC_COUNTRY_INVALID");
  return normalized;
}

export function normalizeGscDevice(value: string): CanonicalDevice {
  const normalized = value.trim().toUpperCase();
  return normalized === "DESKTOP" || normalized === "MOBILE" || normalized === "TABLET" ? normalized : "UNKNOWN";
}

function metrics(row: GscRawSearchRow): Omit<GscNormalizedRowBase, "identity"> {
  const values = [row.clicks, row.impressions, row.ctr, row.position];
  if (values.some(value => !Number.isFinite(value) || value < 0) || row.ctr > 1) throw new Error("GSC_ROW_METRICS_INVALID");
  return { clicks: row.clicks, impressions: row.impressions, ctr: row.ctr, position: row.position };
}

function pageFilter(value: GscQueryContract): string | null {
  return value.request.dimensionFilterGroups[0].filters.find(filter => filter.dimension === "page" && filter.operator === "equals")?.expression ?? null;
}

export function normalizeGscRow(value: GscQueryContract, row: GscRawSearchRow): GscNormalizedRow {
  const keys = row.keys ?? [];
  if (keys.length !== value.request.dimensions.length) throw new Error("GSC_ROW_DIMENSIONS_INVALID");
  const rowMetrics = metrics(row);
  if (value.dataset === "property") {
    const date = value.request.dimensions[0] === "date" ? requireDate(keys[0] ?? "") : null;
    return { dataset: "property", identity: `property:${date ?? "total"}`, date, ...rowMetrics };
  }
  if (value.dataset === "page") {
    const page = value.request.dimensions[0] === "page" ? requireText(keys[0] ?? "", "GSC_PAGE_ROW_INVALID") : pageFilter(value);
    if (page === null) throw new Error("GSC_PAGE_ROW_INVALID");
    return { dataset: "page", identity: `page:${page}`, page, ...rowMetrics };
  }
  if (value.dataset === "query") {
    const page = pageFilter(value);
    if (page === null) throw new Error("GSC_PAGE_FILTER_REQUIRED");
    const query = requireText(keys[0] ?? "", "GSC_QUERY_ROW_INVALID");
    return { dataset: "query", identity: `query:${page}\0${query}`, page, query, ...rowMetrics };
  }
  if (value.dataset === "country") {
    const country = normalizeGscCountry(keys[0] ?? "");
    return { dataset: "country", identity: `country:${country}`, country, countryMappingVersion: GSC_COUNTRY_MAPPING_VERSION, ...rowMetrics };
  }
  const device = normalizeGscDevice(keys[0] ?? "");
  return { dataset: "device", identity: `device:${device}`, device, deviceMappingVersion: GSC_DEVICE_MAPPING_VERSION, ...rowMetrics };
}
