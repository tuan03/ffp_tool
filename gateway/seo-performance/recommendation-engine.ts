import { createHash } from "node:crypto";

export const PERFORMANCE_RECOMMENDATION_RULES_V1 = Object.freeze({
  version: "rules_v1",
  mainWindowDays: 28,
  minimumImpressionsSignal: 300,
  minimumClicksForClickRule: 20,
  clickChangeThresholdRatio: 0.2,
  clickChangeThresholdAbsolute: 10,
  cooldownDays: 28,
} as const);

export type RecommendationDataStatus = "FRESH" | "PARTIAL" | "STALE" | "ERROR" | "DISCONNECTED";
export type RecommendationMeasurementStatus = "BASELINE" | "WAITING_FOR_CRAWL" | "COLLECTING" | "ELIGIBLE" | "INSUFFICIENT_DATA" | "CONTENT_CHANGED";
export type RecommendationPerformanceStatus = "NOT_EVALUATED" | "IMPROVING" | "STABLE" | "MIXED" | "DECLINING";
export type RecommendationAction = "MONITOR" | "REVIEW" | "REQUEST_REWRITE" | "DATA_REVIEW" | "TECHNICAL_REVIEW" | "CRO_REVIEW" | "STORE_WIDE_REVIEW";
export type RecommendationDiagnostic =
  | "CTR_QUERY_MIX"
  | "MATCHED_QUERY_DECLINE"
  | "DATA_INDEXABILITY"
  | "CONVERSION_TRACKING_CRO"
  | "STORE_WIDE_CONTEXT";

export type RecommendationReason =
  | "DATA_DISCONNECTED"
  | "DATA_ERROR"
  | "DATA_STALE"
  | "DATA_PARTIAL"
  | "MAPPING_AMBIGUOUS"
  | "CONTENT_CHANGED"
  | "TECHNICAL_REVIEW_REQUIRED"
  | "BASELINE_ONLY"
  | "WAITING_FOR_CRAWL"
  | "COLLECTING_DATA"
  | "MEASUREMENT_INSUFFICIENT"
  | "WINDOW_NOT_READY"
  | "LOW_IMPRESSIONS"
  | "LOW_CLICK_VOLUME"
  | "NEW_ACTIVITY"
  | "CLICK_IMPROVING"
  | "MIXED_SIGNALS"
  | "DECLINING_CTR_QUERY_MIX"
  | "DECLINING_MATCHED_QUERIES"
  | "DECLINING_DATA_INDEXABILITY"
  | "DECLINING_CONVERSION_CRO"
  | "DECLINING_STORE_WIDE"
  | "QUERY_COUNT_ONLY_REVIEW"
  | "CLICK_DECLINE_REVIEW"
  | "STABLE";

export interface RecommendationMetricPeriod {
  readonly clicks: number;
  readonly impressions: number;
  readonly ctr: number | null;
}

export interface RecommendationSignals {
  readonly ctrOrQueryMixConcern?: boolean;
  readonly matchedQueryPositionAndClickDecline?: boolean;
  readonly dataOrIndexabilityConcern?: boolean;
  readonly conversionTrackingOrCroConcern?: boolean;
  readonly storeWideConcern?: boolean;
  readonly queryCountChangeOnly?: boolean;
  readonly hasMixedSignals?: boolean;
}

export interface RecommendationEvaluationInput {
  readonly storeId: string;
  readonly productId: string;
  readonly versionId: string;
  readonly basedOnContentHash: string;
  readonly windowDays: number;
  readonly dataStatus: RecommendationDataStatus;
  readonly measurementStatus: RecommendationMeasurementStatus;
  readonly technicalFlags: readonly string[];
  readonly hasAmbiguousMapping: boolean;
  readonly before: RecommendationMetricPeriod;
  readonly after: RecommendationMetricPeriod;
  readonly signals?: RecommendationSignals;
}

export interface RecommendationMetricEvidence {
  readonly beforeClicks: number;
  readonly afterClicks: number;
  readonly absoluteClickChange: number;
  readonly clickChangeRatio: number | null;
  readonly beforeImpressions: number;
  readonly afterImpressions: number;
}

export interface RecommendationDecision {
  readonly rulesetVersion: typeof PERFORMANCE_RECOMMENDATION_RULES_V1.version;
  readonly reason: RecommendationReason;
  readonly diagnostic: RecommendationDiagnostic | null;
  readonly performanceStatus: RecommendationPerformanceStatus;
  readonly action: RecommendationAction;
  readonly canRequestRewrite: boolean;
  readonly dedupeKey: string;
  readonly evidence: RecommendationMetricEvidence;
}

export type RecommendationLifecycleState =
  | "PROPOSED"
  | "DRAFT_QUEUED"
  | "DRAFT_READY"
  | "APPLIED_CLOSED"
  | "DISMISSED"
  | "SNOOZED"
  | "STALE"
  | "DRAFT_FAILED"
  | "DRAFT_CANCELLED"
  | "NO_CHANGE_CLOSED";

export type RecommendationLifecycleEvent =
  | "QUEUE_DRAFT"
  | "DRAFT_BECAME_READY"
  | "VERIFIED_APPLY"
  | "VERIFIED_NO_CHANGE"
  | "DISMISS"
  | "SNOOZE"
  | "MARK_STALE"
  | "DRAFT_FAILURE"
  | "DRAFT_CANCELLATION"
  | "REOPEN"
  | "RETRY_DRAFT";

export type RecommendationSendBlockReason =
  | "STORE_ACCESS_REQUIRED"
  | "STORE_MISMATCH"
  | "PRODUCT_MISMATCH"
  | "RECOMMENDATION_NOT_PROPOSED"
  | "RECOMMENDATION_INVALID"
  | "REWRITE_NOT_ALLOWED"
  | "CURRENT_VERSION_CHANGED"
  | "CONTENT_HASH_CHANGED"
  | "COOLDOWN_ACTIVE"
  | "OPEN_DRAFT_EXISTS"
  | "OPEN_PUBLISH_EXISTS";

export interface RecommendationSendInput {
  readonly recommendation: {
    readonly storeId: string;
    readonly productId: string;
    readonly basedOnVersionId: string;
    readonly basedOnContentHash: string;
    readonly state: RecommendationLifecycleState;
    readonly canRequestRewrite: boolean;
    readonly isValid: boolean;
  };
  readonly context: {
    readonly requestedStoreId: string;
    readonly requestedProductId: string;
    readonly hasStoreAccess: boolean;
    readonly currentVersionId: string;
    readonly currentContentHash: string;
    readonly nowUtc: number;
    readonly lastDraftQueuedAtUtc: number | null;
    readonly hasOpenDraft: boolean;
    readonly hasOpenPublish: boolean;
  };
}

export type RecommendationSendEligibility =
  | { readonly eligible: true; readonly reason: null }
  | { readonly eligible: false; readonly reason: RecommendationSendBlockReason };

function requireIdentifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.includes("\0")) throw new Error(code);
  return normalized;
}

function validatePeriod(period: RecommendationMetricPeriod): void {
  if (!Number.isFinite(period.clicks) || period.clicks < 0 || !Number.isFinite(period.impressions) || period.impressions < 0) {
    throw new Error("RECOMMENDATION_METRICS_INVALID");
  }
  if (period.ctr !== null && (!Number.isFinite(period.ctr) || period.ctr < 0 || period.ctr > 1)) {
    throw new Error("RECOMMENDATION_CTR_INVALID");
  }
}

export function selectRecommendationDiagnostic(signals: RecommendationSignals = {}): RecommendationDiagnostic | null {
  if (signals.ctrOrQueryMixConcern) return "CTR_QUERY_MIX";
  if (signals.matchedQueryPositionAndClickDecline) return "MATCHED_QUERY_DECLINE";
  if (signals.dataOrIndexabilityConcern) return "DATA_INDEXABILITY";
  if (signals.conversionTrackingOrCroConcern) return "CONVERSION_TRACKING_CRO";
  if (signals.storeWideConcern) return "STORE_WIDE_CONTEXT";
  return null;
}

export function createRecommendationDedupeKey(input: {
  readonly storeId: string;
  readonly productId: string;
  readonly versionId: string;
  readonly reason: RecommendationReason;
  readonly rulesetVersion?: string;
}): string {
  const parts = [
    requireIdentifier(input.storeId, "RECOMMENDATION_STORE_REQUIRED"),
    requireIdentifier(input.productId, "RECOMMENDATION_PRODUCT_REQUIRED"),
    requireIdentifier(input.versionId, "RECOMMENDATION_VERSION_REQUIRED"),
    input.reason,
    input.rulesetVersion ?? PERFORMANCE_RECOMMENDATION_RULES_V1.version,
  ];
  return `performance:${createHash("sha256").update(JSON.stringify(parts)).digest("hex")}`;
}

function decision(input: RecommendationEvaluationInput, values: Omit<RecommendationDecision, "rulesetVersion" | "dedupeKey" | "evidence">,
  evidence: RecommendationMetricEvidence): RecommendationDecision {
  return {
    ...values,
    rulesetVersion: PERFORMANCE_RECOMMENDATION_RULES_V1.version,
    dedupeKey: createRecommendationDedupeKey({
      storeId: input.storeId,
      productId: input.productId,
      versionId: input.versionId,
      reason: values.reason,
    }),
    evidence,
  };
}

function blockedDecision(input: RecommendationEvaluationInput, reason: RecommendationReason, action: RecommendationAction,
  evidence: RecommendationMetricEvidence, diagnostic: RecommendationDiagnostic | null = null): RecommendationDecision {
  return decision(input, { reason, diagnostic, performanceStatus: "NOT_EVALUATED", action, canRequestRewrite: false }, evidence);
}

export function evaluatePerformanceRecommendation(input: RecommendationEvaluationInput): RecommendationDecision {
  requireIdentifier(input.basedOnContentHash, "RECOMMENDATION_CONTENT_HASH_REQUIRED");
  validatePeriod(input.before);
  validatePeriod(input.after);
  const absoluteClickChange = input.after.clicks - input.before.clicks;
  const clickChangeRatio = input.before.clicks === 0 ? null : absoluteClickChange / input.before.clicks;
  const evidence: RecommendationMetricEvidence = {
    beforeClicks: input.before.clicks,
    afterClicks: input.after.clicks,
    absoluteClickChange,
    clickChangeRatio,
    beforeImpressions: input.before.impressions,
    afterImpressions: input.after.impressions,
  };
  const diagnostic = selectRecommendationDiagnostic(input.signals);

  if (input.dataStatus === "DISCONNECTED") return blockedDecision(input, "DATA_DISCONNECTED", "DATA_REVIEW", evidence, diagnostic);
  if (input.dataStatus === "ERROR") return blockedDecision(input, "DATA_ERROR", "DATA_REVIEW", evidence, diagnostic);
  if (input.dataStatus === "STALE") return blockedDecision(input, "DATA_STALE", "DATA_REVIEW", evidence, diagnostic);
  if (input.dataStatus === "PARTIAL") return blockedDecision(input, "DATA_PARTIAL", "DATA_REVIEW", evidence, diagnostic);
  if (input.hasAmbiguousMapping) return blockedDecision(input, "MAPPING_AMBIGUOUS", "DATA_REVIEW", evidence, diagnostic);
  if (input.measurementStatus === "CONTENT_CHANGED") return blockedDecision(input, "CONTENT_CHANGED", "REVIEW", evidence, diagnostic);
  if (input.technicalFlags.length > 0 || input.signals?.dataOrIndexabilityConcern) {
    return blockedDecision(input, "TECHNICAL_REVIEW_REQUIRED", "TECHNICAL_REVIEW", evidence, "DATA_INDEXABILITY");
  }
  if (input.measurementStatus === "BASELINE") return blockedDecision(input, "BASELINE_ONLY", "MONITOR", evidence, diagnostic);
  if (input.measurementStatus === "WAITING_FOR_CRAWL") return blockedDecision(input, "WAITING_FOR_CRAWL", "REVIEW", evidence, diagnostic);
  if (input.measurementStatus === "COLLECTING") return blockedDecision(input, "COLLECTING_DATA", "MONITOR", evidence, diagnostic);
  if (input.measurementStatus === "INSUFFICIENT_DATA") return blockedDecision(input, "MEASUREMENT_INSUFFICIENT", "MONITOR", evidence, diagnostic);
  if (input.windowDays !== PERFORMANCE_RECOMMENDATION_RULES_V1.mainWindowDays) {
    return blockedDecision(input, "WINDOW_NOT_READY", "MONITOR", evidence, diagnostic);
  }
  if (Math.max(input.before.impressions, input.after.impressions) < PERFORMANCE_RECOMMENDATION_RULES_V1.minimumImpressionsSignal) {
    return blockedDecision(input, "LOW_IMPRESSIONS", "MONITOR", evidence, diagnostic);
  }
  if (input.before.clicks === 0 && input.after.clicks > 0) {
    return decision(input, { reason: "NEW_ACTIVITY", diagnostic, performanceStatus: "MIXED", action: "REVIEW", canRequestRewrite: false }, evidence);
  }
  if (Math.max(input.before.clicks, input.after.clicks) < PERFORMANCE_RECOMMENDATION_RULES_V1.minimumClicksForClickRule) {
    return blockedDecision(input, "LOW_CLICK_VOLUME", "MONITOR", evidence, diagnostic);
  }
  if (input.signals?.hasMixedSignals) {
    return decision(input, { reason: "MIXED_SIGNALS", diagnostic, performanceStatus: "MIXED", action: "REVIEW", canRequestRewrite: false }, evidence);
  }

  const isImproving = clickChangeRatio !== null
    && clickChangeRatio >= PERFORMANCE_RECOMMENDATION_RULES_V1.clickChangeThresholdRatio
    && absoluteClickChange >= PERFORMANCE_RECOMMENDATION_RULES_V1.clickChangeThresholdAbsolute;
  if (isImproving) {
    return decision(input, { reason: "CLICK_IMPROVING", diagnostic, performanceStatus: "IMPROVING", action: "MONITOR", canRequestRewrite: false }, evidence);
  }
  const isDeclining = clickChangeRatio !== null
    && clickChangeRatio <= -PERFORMANCE_RECOMMENDATION_RULES_V1.clickChangeThresholdRatio
    && absoluteClickChange <= -PERFORMANCE_RECOMMENDATION_RULES_V1.clickChangeThresholdAbsolute;
  if (!isDeclining) {
    return decision(input, { reason: "STABLE", diagnostic, performanceStatus: "STABLE", action: "MONITOR", canRequestRewrite: false }, evidence);
  }

  if (input.signals?.queryCountChangeOnly) {
    return decision(input, { reason: "QUERY_COUNT_ONLY_REVIEW", diagnostic, performanceStatus: "DECLINING", action: "REVIEW", canRequestRewrite: false }, evidence);
  }
  if (diagnostic === "CTR_QUERY_MIX") {
    return decision(input, { reason: "DECLINING_CTR_QUERY_MIX", diagnostic, performanceStatus: "DECLINING", action: "REQUEST_REWRITE", canRequestRewrite: true }, evidence);
  }
  if (diagnostic === "MATCHED_QUERY_DECLINE") {
    return decision(input, { reason: "DECLINING_MATCHED_QUERIES", diagnostic, performanceStatus: "DECLINING", action: "REQUEST_REWRITE", canRequestRewrite: true }, evidence);
  }
  if (diagnostic === "CONVERSION_TRACKING_CRO") {
    return decision(input, { reason: "DECLINING_CONVERSION_CRO", diagnostic, performanceStatus: "DECLINING", action: "CRO_REVIEW", canRequestRewrite: false }, evidence);
  }
  if (diagnostic === "STORE_WIDE_CONTEXT") {
    return decision(input, { reason: "DECLINING_STORE_WIDE", diagnostic, performanceStatus: "DECLINING", action: "STORE_WIDE_REVIEW", canRequestRewrite: false }, evidence);
  }
  if (diagnostic === "DATA_INDEXABILITY") {
    return decision(input, { reason: "DECLINING_DATA_INDEXABILITY", diagnostic, performanceStatus: "DECLINING", action: "TECHNICAL_REVIEW", canRequestRewrite: false }, evidence);
  }
  return decision(input, { reason: "CLICK_DECLINE_REVIEW", diagnostic: null, performanceStatus: "DECLINING", action: "REVIEW", canRequestRewrite: false }, evidence);
}

const LIFECYCLE_TRANSITIONS: Readonly<Record<RecommendationLifecycleState, Partial<Record<RecommendationLifecycleEvent, RecommendationLifecycleState>>>> = {
  PROPOSED: { QUEUE_DRAFT: "DRAFT_QUEUED", DISMISS: "DISMISSED", SNOOZE: "SNOOZED", MARK_STALE: "STALE" },
  DRAFT_QUEUED: { DRAFT_BECAME_READY: "DRAFT_READY", DRAFT_FAILURE: "DRAFT_FAILED", DRAFT_CANCELLATION: "DRAFT_CANCELLED", MARK_STALE: "STALE" },
  DRAFT_READY: { VERIFIED_APPLY: "APPLIED_CLOSED", VERIFIED_NO_CHANGE: "NO_CHANGE_CLOSED", DRAFT_FAILURE: "DRAFT_FAILED", DRAFT_CANCELLATION: "DRAFT_CANCELLED", MARK_STALE: "STALE" },
  SNOOZED: { REOPEN: "PROPOSED", DISMISS: "DISMISSED", MARK_STALE: "STALE" },
  DRAFT_FAILED: { RETRY_DRAFT: "DRAFT_QUEUED", DISMISS: "DISMISSED", MARK_STALE: "STALE" },
  DRAFT_CANCELLED: { REOPEN: "PROPOSED", DISMISS: "DISMISSED", MARK_STALE: "STALE" },
  APPLIED_CLOSED: {},
  DISMISSED: {},
  STALE: {},
  NO_CHANGE_CLOSED: {},
};

export function transitionRecommendationLifecycle(state: RecommendationLifecycleState,
  event: RecommendationLifecycleEvent): RecommendationLifecycleState {
  const next = LIFECYCLE_TRANSITIONS[state][event];
  if (!next) throw new Error("RECOMMENDATION_TRANSITION_INVALID");
  return next;
}

export function recommendationCooldownUntil(lastDraftQueuedAtUtc: number): number {
  if (!Number.isFinite(lastDraftQueuedAtUtc) || lastDraftQueuedAtUtc < 0) throw new Error("RECOMMENDATION_TIME_INVALID");
  return lastDraftQueuedAtUtc + PERFORMANCE_RECOMMENDATION_RULES_V1.cooldownDays * 24 * 60 * 60 * 1000;
}

function blocked(reason: RecommendationSendBlockReason): RecommendationSendEligibility {
  return { eligible: false, reason };
}

export function evaluateRecommendationSend(input: RecommendationSendInput): RecommendationSendEligibility {
  const { recommendation, context } = input;
  requireIdentifier(recommendation.storeId, "RECOMMENDATION_STORE_REQUIRED");
  requireIdentifier(recommendation.productId, "RECOMMENDATION_PRODUCT_REQUIRED");
  requireIdentifier(recommendation.basedOnVersionId, "RECOMMENDATION_VERSION_REQUIRED");
  requireIdentifier(recommendation.basedOnContentHash, "RECOMMENDATION_CONTENT_HASH_REQUIRED");
  requireIdentifier(context.requestedStoreId, "RECOMMENDATION_STORE_REQUIRED");
  requireIdentifier(context.requestedProductId, "RECOMMENDATION_PRODUCT_REQUIRED");
  requireIdentifier(context.currentVersionId, "RECOMMENDATION_VERSION_REQUIRED");
  requireIdentifier(context.currentContentHash, "RECOMMENDATION_CONTENT_HASH_REQUIRED");
  if (!Number.isFinite(context.nowUtc) || context.nowUtc < 0) throw new Error("RECOMMENDATION_TIME_INVALID");
  if (!context.hasStoreAccess) return blocked("STORE_ACCESS_REQUIRED");
  if (recommendation.storeId !== context.requestedStoreId) return blocked("STORE_MISMATCH");
  if (recommendation.productId !== context.requestedProductId) return blocked("PRODUCT_MISMATCH");
  if (recommendation.state !== "PROPOSED") return blocked("RECOMMENDATION_NOT_PROPOSED");
  if (!recommendation.isValid) return blocked("RECOMMENDATION_INVALID");
  if (!recommendation.canRequestRewrite) return blocked("REWRITE_NOT_ALLOWED");
  if (recommendation.basedOnVersionId !== context.currentVersionId) return blocked("CURRENT_VERSION_CHANGED");
  if (recommendation.basedOnContentHash !== context.currentContentHash) return blocked("CONTENT_HASH_CHANGED");
  if (context.lastDraftQueuedAtUtc !== null && context.nowUtc < recommendationCooldownUntil(context.lastDraftQueuedAtUtc)) {
    return blocked("COOLDOWN_ACTIVE");
  }
  if (context.hasOpenDraft) return blocked("OPEN_DRAFT_EXISTS");
  if (context.hasOpenPublish) return blocked("OPEN_PUBLISH_EXISTS");
  return { eligible: true, reason: null };
}
