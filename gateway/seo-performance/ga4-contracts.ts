export type Ga4PanelKind = "landing_engagement" | "event_activity" | "landing_revenue" | "item_performance";

export interface Ga4DateRange {
  readonly startDate: string;
  readonly endDate: string;
}

export interface Ga4PanelInput extends Ga4DateRange {
  readonly propertyId: string;
  readonly hostnameScope: string;
  readonly streamId?: string | null;
  readonly queryFilter?: string;
  readonly pageSize?: number;
  readonly offset?: number;
  readonly maxRows?: number;
}

export interface Ga4DimensionFilterExpression {
  readonly filter?: {
    readonly fieldName: string;
    readonly stringFilter?: { readonly matchType: "EXACT"; readonly value: string; readonly caseSensitive?: boolean };
    readonly inListFilter?: { readonly values: readonly string[]; readonly caseSensitive?: boolean };
  };
  readonly andGroup?: { readonly expressions: readonly Ga4DimensionFilterExpression[] };
}

export interface Ga4RunReportRequest {
  readonly dateRanges: readonly Ga4DateRange[];
  readonly dimensions: readonly { readonly name: string }[];
  readonly metrics: readonly { readonly name: string }[];
  readonly dimensionFilter: Ga4DimensionFilterExpression;
  readonly orderBys: readonly { readonly dimension: { readonly dimensionName: string }; readonly desc: false }[];
  readonly limit: string;
  readonly offset: string;
  readonly returnPropertyQuota: true;
}

export interface Ga4PanelContract {
  readonly kind: Ga4PanelKind;
  readonly dimensions: readonly string[];
  readonly metrics: readonly string[];
  readonly request: Ga4RunReportRequest;
}

export interface Ga4MetadataField {
  readonly apiName: string;
  readonly uiName: string | null;
  readonly description: string | null;
}

export interface Ga4Metadata {
  readonly dimensions: readonly Ga4MetadataField[];
  readonly metrics: readonly Ga4MetadataField[];
}

export interface Ga4CompatibilityField {
  readonly apiName: string;
  readonly compatible: boolean;
  readonly compatibility: string;
}

export interface Ga4Compatibility {
  readonly dimensions: readonly Ga4CompatibilityField[];
  readonly metrics: readonly Ga4CompatibilityField[];
  readonly compatible: boolean;
}

export interface Ga4ReportRow {
  readonly dimensions: Readonly<Record<string, string>>;
  /** GA4 transports metric values as decimal strings; consumers must aggregate according to each metric's contract. */
  readonly metrics: Readonly<Record<string, string>>;
}

export interface Ga4SamplingMetadata {
  readonly samplesReadCount: string | null;
  readonly samplingSpaceSize: string | null;
}

export type Ga4QualityFlag = "THRESHOLDING" | "SAMPLING" | "OTHER_ROW" | "DATA_LOSS" | "TRUNCATED";

export interface Ga4QualityMetadata {
  readonly flags: readonly Ga4QualityFlag[];
  readonly thresholding: boolean;
  readonly sampling: readonly Ga4SamplingMetadata[];
  readonly hasOtherRow: boolean;
  readonly dataLossFromOtherRow: boolean;
  readonly truncated: boolean;
  readonly timeZone: string | null;
  readonly currencyCode: string | null;
  readonly propertyQuota: Readonly<Record<string, unknown>> | null;
  readonly providerRowCount: number;
  readonly fetchedRowCount: number;
}

export interface Ga4AvailablePanel {
  readonly status: "available";
  readonly kind: Ga4PanelKind;
  readonly rows: readonly Ga4ReportRow[];
  readonly quality: Ga4QualityMetadata;
  readonly semantics: string;
}

export interface Ga4UnsupportedPanel {
  readonly status: "unsupported";
  readonly reason: "GSC_QUERY_FILTER_UNSUPPORTED";
  readonly message: "GSC query filter is not supported by this GA4 report";
}

export interface Ga4UnavailablePanel {
  readonly status: "unavailable";
  readonly reason: "GA4_METADATA_FIELD_UNAVAILABLE" | "GA4_REPORT_INCOMPATIBLE";
  readonly fields: readonly string[];
}

export type Ga4PanelResult = Ga4AvailablePanel | Ga4UnsupportedPanel | Ga4UnavailablePanel;

export interface Ga4ItemMappingEvidence {
  readonly evidenceId: string;
  readonly itemId: string;
  readonly productId: string;
  readonly source: "shopify_variant" | "merchant_feed" | "manual_verified";
  readonly observedAt: string;
  readonly validFrom: string;
  readonly validTo: string | null;
}

export interface Ga4MappedItem {
  readonly status: "mapped";
  readonly productId: string;
  readonly evidence: readonly Ga4ItemMappingEvidence[];
}

export interface Ga4UnmappedItem {
  readonly status: "unavailable";
  readonly reason: "ITEM_MAPPING_NOT_FOUND" | "ITEM_MAPPING_AMBIGUOUS";
  readonly candidateProductIds: readonly string[];
}

export type Ga4ItemMappingResult = Ga4MappedItem | Ga4UnmappedItem;
