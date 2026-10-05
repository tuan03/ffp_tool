import assert from "node:assert/strict";
import test from "node:test";

import {
  PERFORMANCE_RECOMMENDATION_RULES_V1,
  createRecommendationDedupeKey,
  evaluatePerformanceRecommendation,
  evaluateRecommendationSend,
  recommendationCooldownUntil,
  selectRecommendationDiagnostic,
  transitionRecommendationLifecycle,
  type RecommendationEvaluationInput,
  type RecommendationSendInput,
} from "../seo-performance/recommendation-engine";

function evaluation(overrides: Partial<RecommendationEvaluationInput> = {}): RecommendationEvaluationInput {
  return {
    storeId: "jeminise",
    productId: "gid://shopify/Product/123",
    versionId: "version-2",
    basedOnContentHash: "a".repeat(64),
    windowDays: 28,
    dataStatus: "FRESH",
    measurementStatus: "ELIGIBLE",
    technicalFlags: [],
    hasAmbiguousMapping: false,
    before: { clicks: 100, impressions: 1_000, ctr: 0.1 },
    after: { clicks: 70, impressions: 900, ctr: 0.0777777778 },
    signals: { matchedQueryPositionAndClickDecline: true },
    ...overrides,
  };
}

test("rules_v1 freezes the approved 28-day thresholds and cooldown", () => {
  assert.deepEqual(PERFORMANCE_RECOMMENDATION_RULES_V1, {
    version: "rules_v1",
    mainWindowDays: 28,
    minimumImpressionsSignal: 300,
    minimumClicksForClickRule: 20,
    clickChangeThresholdRatio: 0.2,
    clickChangeThresholdAbsolute: 10,
    cooldownDays: 28,
  });
});

test("click rules require both percentage and absolute thresholds", () => {
  const decline = evaluatePerformanceRecommendation(evaluation());
  assert.equal(decline.performanceStatus, "DECLINING");
  assert.equal(decline.reason, "DECLINING_MATCHED_QUERIES");
  assert.equal(decline.canRequestRewrite, true);
  assert.equal(decline.action, "REQUEST_REWRITE");

  const missesAbsolute = evaluatePerformanceRecommendation(evaluation({
    before: { clicks: 20, impressions: 500, ctr: 0.04 },
    after: { clicks: 14, impressions: 500, ctr: 0.028 },
  }));
  assert.equal(missesAbsolute.reason, "STABLE");
  const missesPercent = evaluatePerformanceRecommendation(evaluation({
    before: { clicks: 100, impressions: 1_000, ctr: 0.1 },
    after: { clicks: 85, impressions: 1_000, ctr: 0.085 },
  }));
  assert.equal(missesPercent.reason, "STABLE");
});

test("Before zero is NEW_ACTIVITY and never an infinite percentage rewrite rule", () => {
  const result = evaluatePerformanceRecommendation(evaluation({
    before: { clicks: 0, impressions: 300, ctr: 0 },
    after: { clicks: 30, impressions: 500, ctr: 0.06 },
  }));
  assert.equal(result.reason, "NEW_ACTIVITY");
  assert.equal(result.performanceStatus, "MIXED");
  assert.equal(result.evidence.clickChangeRatio, null);
  assert.equal(result.canRequestRewrite, false);
});

test("insufficient impressions and clicks cannot request a rewrite", () => {
  const lowImpressions = evaluatePerformanceRecommendation(evaluation({
    before: { clicks: 20, impressions: 299, ctr: 0.066 },
    after: { clicks: 5, impressions: 250, ctr: 0.02 },
  }));
  assert.equal(lowImpressions.reason, "LOW_IMPRESSIONS");
  assert.equal(lowImpressions.canRequestRewrite, false);

  const lowClicks = evaluatePerformanceRecommendation(evaluation({
    before: { clicks: 19, impressions: 500, ctr: 0.038 },
    after: { clicks: 1, impressions: 500, ctr: 0.002 },
  }));
  assert.equal(lowClicks.reason, "LOW_CLICK_VOLUME");
  assert.equal(lowClicks.canRequestRewrite, false);
});

test("stale, partial, disconnected, technical, ambiguous and changed content fail closed", () => {
  const cases: readonly [Partial<RecommendationEvaluationInput>, string][] = [
    [{ dataStatus: "STALE" }, "DATA_STALE"],
    [{ dataStatus: "PARTIAL" }, "DATA_PARTIAL"],
    [{ dataStatus: "DISCONNECTED" }, "DATA_DISCONNECTED"],
    [{ hasAmbiguousMapping: true }, "MAPPING_AMBIGUOUS"],
    [{ technicalFlags: ["CANONICAL_REVIEW"] }, "TECHNICAL_REVIEW_REQUIRED"],
    [{ measurementStatus: "CONTENT_CHANGED" }, "CONTENT_CHANGED"],
  ];
  for (const [overrides, reason] of cases) {
    const result = evaluatePerformanceRecommendation(evaluation(overrides));
    assert.equal(result.reason, reason);
    assert.equal(result.canRequestRewrite, false);
    assert.equal(result.performanceStatus, "NOT_EVALUATED");
  }
});

test("diagnostic precedence is deterministic", () => {
  const all = {
    ctrOrQueryMixConcern: true,
    matchedQueryPositionAndClickDecline: true,
    dataOrIndexabilityConcern: true,
    conversionTrackingOrCroConcern: true,
    storeWideConcern: true,
  } as const;
  assert.equal(selectRecommendationDiagnostic(all), "CTR_QUERY_MIX");
  assert.equal(selectRecommendationDiagnostic({ ...all, ctrOrQueryMixConcern: false }), "MATCHED_QUERY_DECLINE");
  assert.equal(selectRecommendationDiagnostic({ ...all, ctrOrQueryMixConcern: false, matchedQueryPositionAndClickDecline: false }), "DATA_INDEXABILITY");
  assert.equal(selectRecommendationDiagnostic({ conversionTrackingOrCroConcern: true, storeWideConcern: true }), "CONVERSION_TRACKING_CRO");
  assert.equal(selectRecommendationDiagnostic({ storeWideConcern: true }), "STORE_WIDE_CONTEXT");
});

test("purchase-only, query-count-only and store-wide declines never request content rewrite", () => {
  const conversion = evaluatePerformanceRecommendation(evaluation({ signals: { conversionTrackingOrCroConcern: true } }));
  assert.equal(conversion.action, "CRO_REVIEW");
  assert.equal(conversion.canRequestRewrite, false);
  const queryCount = evaluatePerformanceRecommendation(evaluation({ signals: { queryCountChangeOnly: true } }));
  assert.equal(queryCount.reason, "QUERY_COUNT_ONLY_REVIEW");
  assert.equal(queryCount.canRequestRewrite, false);
  const storeWide = evaluatePerformanceRecommendation(evaluation({ signals: { storeWideConcern: true } }));
  assert.equal(storeWide.action, "STORE_WIDE_REVIEW");
  assert.equal(storeWide.canRequestRewrite, false);
});

test("dedupe key is stable by store, product, version, reason and ruleset", () => {
  const input = { storeId: "jeminise", productId: "p1", versionId: "v2", reason: "DECLINING_MATCHED_QUERIES" as const };
  const first = createRecommendationDedupeKey(input);
  assert.equal(first, createRecommendationDedupeKey(input));
  assert.notEqual(first, createRecommendationDedupeKey({ ...input, versionId: "v3" }));
  assert.notEqual(first, createRecommendationDedupeKey({ ...input, reason: "DECLINING_CTR_QUERY_MIX" }));
  assert.match(first, /^performance:[0-9a-f]{64}$/);
});

test("lifecycle stays open after enqueue and closes only on verified outcomes", () => {
  const queued = transitionRecommendationLifecycle("PROPOSED", "QUEUE_DRAFT");
  assert.equal(queued, "DRAFT_QUEUED");
  const ready = transitionRecommendationLifecycle(queued, "DRAFT_BECAME_READY");
  assert.equal(ready, "DRAFT_READY");
  assert.equal(transitionRecommendationLifecycle(ready, "VERIFIED_APPLY"), "APPLIED_CLOSED");
  assert.equal(transitionRecommendationLifecycle(ready, "VERIFIED_NO_CHANGE"), "NO_CHANGE_CLOSED");
  assert.equal(transitionRecommendationLifecycle("DRAFT_FAILED", "RETRY_DRAFT"), "DRAFT_QUEUED");
  assert.equal(transitionRecommendationLifecycle("SNOOZED", "REOPEN"), "PROPOSED");
  assert.equal(transitionRecommendationLifecycle("DRAFT_CANCELLED", "REOPEN"), "PROPOSED");
  assert.throws(() => transitionRecommendationLifecycle("APPLIED_CLOSED", "REOPEN"), /RECOMMENDATION_TRANSITION_INVALID/);
  assert.throws(() => transitionRecommendationLifecycle("DISMISSED", "QUEUE_DRAFT"), /RECOMMENDATION_TRANSITION_INVALID/);
});

function sendInput(): RecommendationSendInput {
  return {
    recommendation: {
      storeId: "jeminise",
      productId: "p1",
      basedOnVersionId: "v2",
      basedOnContentHash: "a".repeat(64),
      state: "PROPOSED",
      canRequestRewrite: true,
      isValid: true,
    },
    context: {
      requestedStoreId: "jeminise",
      requestedProductId: "p1",
      hasStoreAccess: true,
      currentVersionId: "v2",
      currentContentHash: "a".repeat(64),
      nowUtc: Date.UTC(2026, 9, 5),
      lastDraftQueuedAtUtc: null,
      hasOpenDraft: false,
      hasOpenPublish: false,
    },
  };
}

test("send eligibility rechecks access, store, product, version, hash, validity and rewrite permission", () => {
  assert.deepEqual(evaluateRecommendationSend(sendInput()), { eligible: true, reason: null });
  const cases: readonly [(input: RecommendationSendInput) => RecommendationSendInput, string][] = [
    [input => ({ ...input, context: { ...input.context, hasStoreAccess: false } }), "STORE_ACCESS_REQUIRED"],
    [input => ({ ...input, context: { ...input.context, requestedStoreId: "other" } }), "STORE_MISMATCH"],
    [input => ({ ...input, context: { ...input.context, requestedProductId: "p2" } }), "PRODUCT_MISMATCH"],
    [input => ({ ...input, recommendation: { ...input.recommendation, state: "DRAFT_QUEUED" } }), "RECOMMENDATION_NOT_PROPOSED"],
    [input => ({ ...input, recommendation: { ...input.recommendation, isValid: false } }), "RECOMMENDATION_INVALID"],
    [input => ({ ...input, recommendation: { ...input.recommendation, canRequestRewrite: false } }), "REWRITE_NOT_ALLOWED"],
    [input => ({ ...input, context: { ...input.context, currentVersionId: "v3" } }), "CURRENT_VERSION_CHANGED"],
    [input => ({ ...input, context: { ...input.context, currentContentHash: "b".repeat(64) } }), "CONTENT_HASH_CHANGED"],
  ];
  for (const [mutate, reason] of cases) assert.deepEqual(evaluateRecommendationSend(mutate(sendInput())), { eligible: false, reason });
});

test("send eligibility enforces 28-day cooldown and open-work gates", () => {
  const base = sendInput();
  const lastQueued = base.context.nowUtc - 27 * 24 * 60 * 60 * 1000;
  assert.equal(recommendationCooldownUntil(lastQueued), lastQueued + 28 * 24 * 60 * 60 * 1000);
  assert.deepEqual(evaluateRecommendationSend({ ...base, context: { ...base.context, lastDraftQueuedAtUtc: lastQueued } }), {
    eligible: false, reason: "COOLDOWN_ACTIVE",
  });
  assert.deepEqual(evaluateRecommendationSend({ ...base, context: { ...base.context, hasOpenDraft: true } }), {
    eligible: false, reason: "OPEN_DRAFT_EXISTS",
  });
  assert.deepEqual(evaluateRecommendationSend({ ...base, context: { ...base.context, hasOpenPublish: true } }), {
    eligible: false, reason: "OPEN_PUBLISH_EXISTS",
  });
  assert.throws(() => evaluateRecommendationSend({ ...base, context: { ...base.context, nowUtc: Number.NaN } }),
    /RECOMMENDATION_TIME_INVALID/);
});
