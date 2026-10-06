import { z } from "zod";

const nullableText = z.string().trim().min(1).nullable().optional();
const nullableUrl = z.string().url().nullable().optional();
const nullableTimestamp = z.string().datetime({ offset: true }).nullable().optional();

const indexStatusSchema = z.object({
  verdict: nullableText,
  coverageState: nullableText,
  lastCrawlTime: nullableTimestamp,
  pageFetchState: nullableText,
  robotsTxtState: nullableText,
  indexingState: nullableText,
  googleCanonical: nullableUrl,
  userCanonical: nullableUrl,
}).passthrough();

export const urlInspectionResponseSchema = z.object({
  inspectionResult: z.object({
    indexStatusResult: indexStatusSchema.nullable().optional(),
    inspectionResultLink: nullableUrl,
  }).passthrough().nullable().optional(),
}).passthrough();

export type UrlInspectionResponse = z.infer<typeof urlInspectionResponseSchema>;

export interface UrlInspectionEvidence {
  readonly verdict: string | null;
  readonly coverage: string | null;
  readonly lastCrawl: string | null;
  readonly fetch: string | null;
  readonly robots: string | null;
  readonly indexing: string | null;
  readonly googleCanonical: string | null;
  readonly userCanonical: string | null;
  readonly resultLink: string | null;
  readonly inspectedAt: string;
}

export type InspectionState =
  | "UNKNOWN"
  | "WAITING_FOR_OBSERVED_RECRAWL"
  | "POST_PUBLISH_CRAWL_OBSERVED"
  | "TECHNICAL_REVIEW_REQUIRED";

export type InspectionTechnicalFlag =
  | "CANONICAL_MISMATCH"
  | "COVERAGE_REVIEW_REQUIRED"
  | "FETCH_FAILED"
  | "INDEXING_BLOCKED"
  | "ROBOTS_BLOCKED"
  | "VERDICT_FAILED";

export interface InspectionAssessment {
  readonly state: InspectionState;
  readonly technicalFlags: readonly InspectionTechnicalFlag[];
  readonly requestsContentRewrite: false;
}

export interface InspectionQuotaAvailability {
  readonly dailyLimit: number;
  readonly used: number;
  readonly headroom: number;
  readonly usableLimit: number;
  readonly remaining: number;
  readonly canReserve: boolean;
}

export type InspectionPriority = "HIGH" | "NORMAL" | "LOW";

function nullable(value: string | null | undefined): string | null {
  return value ?? null;
}

function timestamp(value: string, code: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(code);
  return parsed;
}

function normalizedProviderState(value: string | null): string | null {
  return value?.trim().toUpperCase().replaceAll(/[^A-Z0-9]+/g, "_") ?? null;
}

function normalizeCanonical(value: string): string {
  const url = new URL(value);
  url.hash = "";
  url.hostname = url.hostname.toLowerCase();
  if ((url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80")) {
    url.port = "";
  }
  if (url.pathname !== "/") url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString();
}

function hasCanonicalMismatch(evidence: UrlInspectionEvidence): boolean {
  if (!evidence.googleCanonical || !evidence.userCanonical) return false;
  return normalizeCanonical(evidence.googleCanonical) !==
    normalizeCanonical(evidence.userCanonical);
}

function technicalFlags(
  evidence: UrlInspectionEvidence,
): readonly InspectionTechnicalFlag[] {
  const flags: InspectionTechnicalFlag[] = [];
  const verdict = normalizedProviderState(evidence.verdict);
  const fetch = normalizedProviderState(evidence.fetch);
  const robots = normalizedProviderState(evidence.robots);
  const indexing = normalizedProviderState(evidence.indexing);

  if (verdict === "FAIL") flags.push("VERDICT_FAILED");
  if (fetch && !["SUCCESSFUL", "PAGE_FETCH_STATE_UNSPECIFIED"].includes(fetch)) {
    flags.push("FETCH_FAILED");
  }
  if (robots && !["ALLOWED", "ROBOTS_TXT_STATE_UNSPECIFIED"].includes(robots)) {
    flags.push("ROBOTS_BLOCKED");
  }
  if (indexing && !["INDEXING_ALLOWED", "INDEXING_STATE_UNSPECIFIED"].includes(indexing)) {
    flags.push("INDEXING_BLOCKED");
  }
  if (evidence.coverage &&
      /(?:blocked|error|excluded|not indexed|not found|soft 404)/i.test(evidence.coverage)) {
    flags.push("COVERAGE_REVIEW_REQUIRED");
  }
  if (hasCanonicalMismatch(evidence)) flags.push("CANONICAL_MISMATCH");
  return flags;
}

export function normalizeUrlInspection(input: {
  readonly response: unknown;
  readonly inspectedAt: string;
}): UrlInspectionEvidence {
  timestamp(input.inspectedAt, "INVALID_INSPECTION_TIMESTAMP");
  const response = urlInspectionResponseSchema.parse(input.response);
  const inspection = response.inspectionResult;
  const status = inspection?.indexStatusResult;
  return {
    verdict: nullable(status?.verdict),
    coverage: nullable(status?.coverageState),
    lastCrawl: nullable(status?.lastCrawlTime),
    fetch: nullable(status?.pageFetchState),
    robots: nullable(status?.robotsTxtState),
    indexing: nullable(status?.indexingState),
    googleCanonical: nullable(status?.googleCanonical),
    userCanonical: nullable(status?.userCanonical),
    resultLink: nullable(inspection?.inspectionResultLink),
    inspectedAt: input.inspectedAt,
  };
}

export function deriveInspectionState(input: {
  readonly evidence: UrlInspectionEvidence;
  readonly publicEffectiveAt: string | null;
}): InspectionAssessment {
  const flags = technicalFlags(input.evidence);
  if (flags.length > 0) {
    return {
      state: "TECHNICAL_REVIEW_REQUIRED",
      technicalFlags: flags,
      requestsContentRewrite: false,
    };
  }
  const hasProviderEvidence = [
    input.evidence.verdict,
    input.evidence.coverage,
    input.evidence.lastCrawl,
    input.evidence.fetch,
    input.evidence.robots,
    input.evidence.indexing,
    input.evidence.googleCanonical,
    input.evidence.userCanonical,
    input.evidence.resultLink,
  ].some(value => value !== null);
  if (!hasProviderEvidence) {
    return { state: "UNKNOWN", technicalFlags: [], requestsContentRewrite: false };
  }
  if (!input.publicEffectiveAt) {
    return { state: "UNKNOWN", technicalFlags: [], requestsContentRewrite: false };
  }
  const publicEffectiveTime = timestamp(
    input.publicEffectiveAt,
    "INVALID_PUBLIC_EFFECTIVE_TIMESTAMP",
  );
  if (!input.evidence.lastCrawl) {
    return {
      state: "WAITING_FOR_OBSERVED_RECRAWL",
      technicalFlags: [],
      requestsContentRewrite: false,
    };
  }
  const lastCrawlTime = timestamp(
    input.evidence.lastCrawl,
    "INVALID_LAST_CRAWL_TIMESTAMP",
  );
  return {
    state: lastCrawlTime > publicEffectiveTime
      ? "POST_PUBLISH_CRAWL_OBSERVED"
      : "WAITING_FOR_OBSERVED_RECRAWL",
    technicalFlags: [],
    requestsContentRewrite: false,
  };
}

export function calculateInspectionQuota(input: {
  readonly dailyLimit: number;
  readonly used: number;
  readonly headroom: number;
  readonly requested?: number;
}): InspectionQuotaAvailability {
  const requested = input.requested ?? 1;
  for (const value of [input.dailyLimit, input.used, input.headroom, requested]) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error("INVALID_INSPECTION_QUOTA");
    }
  }
  if (requested < 1) throw new Error("INVALID_INSPECTION_QUOTA");
  const usableLimit = Math.max(0, input.dailyLimit - input.headroom);
  const remaining = Math.max(0, usableLimit - input.used);
  return {
    dailyLimit: input.dailyLimit,
    used: input.used,
    headroom: input.headroom,
    usableLimit,
    remaining,
    canReserve: remaining >= requested,
  };
}

export function inspectionPriority(input: {
  readonly state: InspectionState;
  readonly publicEffectiveAt: string | null;
  readonly lastInspectedAt: string | null;
}): InspectionPriority {
  if (input.state === "TECHNICAL_REVIEW_REQUIRED" ||
      input.state === "WAITING_FOR_OBSERVED_RECRAWL") return "HIGH";
  if (!input.lastInspectedAt) return "HIGH";
  const lastInspectedTime = timestamp(
    input.lastInspectedAt,
    "INVALID_INSPECTION_TIMESTAMP",
  );
  if (input.publicEffectiveAt &&
      timestamp(input.publicEffectiveAt, "INVALID_PUBLIC_EFFECTIVE_TIMESTAMP") >
        lastInspectedTime) return "HIGH";
  return input.state === "POST_PUBLISH_CRAWL_OBSERVED" ? "LOW" : "NORMAL";
}
