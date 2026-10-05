import assert from "node:assert/strict";
import test from "node:test";

import { z } from "zod";

import {
  calculateInspectionQuota,
  deriveInspectionState,
  inspectionPriority,
  normalizeUrlInspection,
} from "../seo-performance/url-inspection";
import type { UrlInspectionEvidence } from "../seo-performance/url-inspection";

const INSPECTED_AT = "2026-10-05T08:00:00.000Z";

function evidence(
  overrides: Partial<UrlInspectionEvidence> = {},
): UrlInspectionEvidence {
  return {
    verdict: "PASS",
    coverage: "Submitted and indexed",
    lastCrawl: "2026-10-04T08:00:00.000Z",
    fetch: "SUCCESSFUL",
    robots: "ALLOWED",
    indexing: "INDEXING_ALLOWED",
    googleCanonical: "https://jeminise.com/products/duvet",
    userCanonical: "https://jeminise.com/products/duvet",
    resultLink: "https://search.google.com/search-console/inspect/example",
    inspectedAt: INSPECTED_AT,
    ...overrides,
  };
}

test("URL Inspection normalization keeps missing provider fields nullable", () => {
  assert.deepEqual(
    normalizeUrlInspection({ response: {}, inspectedAt: INSPECTED_AT }),
    {
      verdict: null,
      coverage: null,
      lastCrawl: null,
      fetch: null,
      robots: null,
      indexing: null,
      googleCanonical: null,
      userCanonical: null,
      resultLink: null,
      inspectedAt: INSPECTED_AT,
    },
  );
});

test("URL Inspection normalization validates and retains provider evidence", () => {
  const normalized = normalizeUrlInspection({
    inspectedAt: INSPECTED_AT,
    response: {
      inspectionResult: {
        inspectionResultLink: "https://search.google.com/search-console/inspect/example",
        indexStatusResult: {
          verdict: "PASS",
          coverageState: "Submitted and indexed",
          lastCrawlTime: "2026-10-04T08:00:00.000Z",
          pageFetchState: "SUCCESSFUL",
          robotsTxtState: "ALLOWED",
          indexingState: "INDEXING_ALLOWED",
          googleCanonical: "https://jeminise.com/products/duvet",
          userCanonical: "https://jeminise.com/products/duvet",
          providerMayAddFields: true,
        },
      },
    },
  });
  assert.deepEqual(normalized, evidence());
  assert.throws(
    () => normalizeUrlInspection({
      inspectedAt: INSPECTED_AT,
      response: { inspectionResult: { indexStatusResult: { lastCrawlTime: "not-a-date" } } },
    }),
    z.ZodError,
  );
});

test("missing publish or crawl evidence remains unknown or waiting", () => {
  const emptyEvidence = normalizeUrlInspection({
    response: {},
    inspectedAt: INSPECTED_AT,
  });
  assert.equal(
    deriveInspectionState({
      evidence: emptyEvidence,
      publicEffectiveAt: "2026-10-01T08:00:00.000Z",
    }).state,
    "UNKNOWN",
  );
  assert.deepEqual(
    deriveInspectionState({ evidence: evidence({ lastCrawl: null }), publicEffectiveAt: null }),
    { state: "UNKNOWN", technicalFlags: [], requestsContentRewrite: false },
  );
  assert.deepEqual(
    deriveInspectionState({
      evidence: evidence({ lastCrawl: null }),
      publicEffectiveAt: "2026-10-01T08:00:00.000Z",
    }),
    {
      state: "WAITING_FOR_OBSERVED_RECRAWL",
      technicalFlags: [],
      requestsContentRewrite: false,
    },
  );
});

test("crawl must be strictly after public effectiveness to count as observed", () => {
  const publicEffectiveAt = "2026-10-04T08:00:00.000Z";
  assert.equal(
    deriveInspectionState({ evidence: evidence(), publicEffectiveAt }).state,
    "WAITING_FOR_OBSERVED_RECRAWL",
  );
  assert.equal(
    deriveInspectionState({
      evidence: evidence({ lastCrawl: "2026-10-04T08:00:00.001Z" }),
      publicEffectiveAt,
    }).state,
    "POST_PUBLISH_CRAWL_OBSERVED",
  );
});

test("explicit fetch, robots and indexing failures require technical review only", () => {
  const assessment = deriveInspectionState({
    evidence: evidence({
      verdict: "FAIL",
      coverage: "Blocked by robots.txt",
      fetch: "SERVER_ERROR",
      robots: "DISALLOWED",
      indexing: "BLOCKED_BY_META_TAG",
    }),
    publicEffectiveAt: "2026-10-01T08:00:00.000Z",
  });
  assert.equal(assessment.state, "TECHNICAL_REVIEW_REQUIRED");
  assert.deepEqual(assessment.technicalFlags, [
    "VERDICT_FAILED",
    "FETCH_FAILED",
    "ROBOTS_BLOCKED",
    "INDEXING_BLOCKED",
    "COVERAGE_REVIEW_REQUIRED",
  ]);
  assert.equal(assessment.requestsContentRewrite, false);
});

test("canonical comparison ignores fragments, default ports and trailing slashes", () => {
  assert.equal(
    deriveInspectionState({
      evidence: evidence({
        googleCanonical: "https://JEMINISE.com:443/products/duvet/#section",
        userCanonical: "https://jeminise.com/products/duvet",
      }),
      publicEffectiveAt: "2026-10-01T08:00:00.000Z",
    }).state,
    "POST_PUBLISH_CRAWL_OBSERVED",
  );
  const mismatch = deriveInspectionState({
    evidence: evidence({
      googleCanonical: "https://jeminise.com/collections/bedding",
      userCanonical: "https://jeminise.com/products/duvet",
    }),
    publicEffectiveAt: "2026-10-01T08:00:00.000Z",
  });
  assert.equal(mismatch.state, "TECHNICAL_REVIEW_REQUIRED");
  assert.deepEqual(mismatch.technicalFlags, ["CANONICAL_MISMATCH"]);
  assert.equal(mismatch.requestsContentRewrite, false);
});

test("quota reserves configurable headroom and never reports negative remaining", () => {
  assert.deepEqual(
    calculateInspectionQuota({ dailyLimit: 100, used: 89, headroom: 10 }),
    {
      dailyLimit: 100,
      used: 89,
      headroom: 10,
      usableLimit: 90,
      remaining: 1,
      canReserve: true,
    },
  );
  assert.equal(
    calculateInspectionQuota({ dailyLimit: 100, used: 90, headroom: 10 }).canReserve,
    false,
  );
  assert.equal(
    calculateInspectionQuota({ dailyLimit: 5, used: 9, headroom: 10 }).remaining,
    0,
  );
  assert.throws(
    () => calculateInspectionQuota({ dailyLimit: 100, used: -1, headroom: 10 }),
    /INVALID_INSPECTION_QUOTA/,
  );
});

test("priority favors unseen, newly published, waiting and technical URLs", () => {
  assert.equal(
    inspectionPriority({ state: "UNKNOWN", publicEffectiveAt: null, lastInspectedAt: null }),
    "HIGH",
  );
  assert.equal(
    inspectionPriority({
      state: "UNKNOWN",
      publicEffectiveAt: "2026-10-05T07:00:00.000Z",
      lastInspectedAt: "2026-10-04T07:00:00.000Z",
    }),
    "HIGH",
  );
  assert.equal(
    inspectionPriority({
      state: "TECHNICAL_REVIEW_REQUIRED",
      publicEffectiveAt: null,
      lastInspectedAt: INSPECTED_AT,
    }),
    "HIGH",
  );
  assert.equal(
    inspectionPriority({
      state: "POST_PUBLISH_CRAWL_OBSERVED",
      publicEffectiveAt: "2026-10-01T08:00:00.000Z",
      lastInspectedAt: INSPECTED_AT,
    }),
    "LOW",
  );
  assert.equal(
    inspectionPriority({
      state: "UNKNOWN",
      publicEffectiveAt: null,
      lastInspectedAt: INSPECTED_AT,
    }),
    "NORMAL",
  );
});
