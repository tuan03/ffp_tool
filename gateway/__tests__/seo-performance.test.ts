import assert from "node:assert/strict";
import test from "node:test";

import { assertPropertyMapping, isPublicAddress, normalizePageUrl } from "../seo-performance/url-policy";
import { encryptSecret, decryptSecret } from "../seo-performance/credentials";
import { inspectHtml } from "../seo-performance/page-audit";
import { aggregateMetrics, opportunityReasons } from "../seo-performance/analytics";
import { recommendationSchema } from "../seo-performance/service";
import { isCrawlAllowed, crawlDelay } from "../seo-performance/public-fetch";

test("Search Console mapping respects domain boundaries and URL prefixes", () => {
  assert.equal(assertPropertyMapping("sc-domain:example.com", "https://shop.example.com").origin, "https://shop.example.com");
  assert.throws(() => assertPropertyMapping("sc-domain:example.com", "https://notexample.com"));
  assert.throws(() => assertPropertyMapping("https://example.com/shop/", "https://example.com/"));
  assert.throws(() => assertPropertyMapping("sc-domain:example.com", "http://example.com"));
  assert.equal(normalizePageUrl("https://example.com/products/a?utm_source=x#top"), "https://example.com/products/a");
  assert.notEqual(normalizePageUrl("https://example.com/products/a?variant=123"), normalizePageUrl("https://example.com/products/a"));
});

test("Crawler blocks non-public addresses including IPv4-mapped IPv6", () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "::ffff:127.0.0.1", "fc00::1", "fe80::1"]) assert.equal(isPublicAddress(address), false, address);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
});

test("Credentials are authenticated encrypted and context-bound", () => {
  const key = Buffer.alloc(32, 7);
  const encrypted = encryptSecret("private-refresh-token", key);
  assert.equal(encrypted.includes("private-refresh-token"), false);
  assert.equal(decryptSecret(encrypted, key), "private-refresh-token");
  assert.throws(() => decryptSecret(encrypted, Buffer.alloc(32, 8)));
});

test("Audit distinguishes source AEO from publicly visible AEO and records unknown JS content", () => {
  const audit = inspectHtml({ url: "https://example.com/products/a", status: 200, html: '<title>Blanket</title><meta name="robots" content="noindex"><h1>Blanket</h1><img src="a"><script>app()</script>', expectedSummary: "A grounded summary only stored in a metafield." });
  assert.equal(audit.title, "Blanket");
  assert.equal(audit.noindex, true);
  assert.equal(audit.missingAltCount, 1);
  assert.equal(audit.aeoVisibility, "not_observed");
  assert.equal(audit.rendering, "static_only");
  assert.equal(audit.findings.some(finding => finding.code === "AEO_NOT_OBSERVED"), true);
});

test("Metrics weight position by impressions and never average CTR percentages", () => {
  assert.deepEqual(aggregateMetrics([{ clicks: 10, impressions: 100, position: 2 }, { clicks: 0, impressions: 900, position: 12 }]), { clicks: 10, impressions: 1000, ctr: 0.01, position: 11 });
  assert.equal(aggregateMetrics([]), null);
  assert.deepEqual(opportunityReasons({ clicks: 1, impressions: 20, position: 8, ctr: 0.05 }, null, null), ["INSUFFICIENT_DATA"]);
});

test("Crawler honors robots wildcard rules and crawl delays", () => {
  const robots = "User-agent: *\nDisallow: /private\nCrawl-delay: 5\nAllow: /private/public";
  assert.equal(isCrawlAllowed("https://example.com", robots, "https://example.com/private/file"), false);
  assert.equal(isCrawlAllowed("https://example.com", robots, "https://example.com/private/public"), true);
  assert.equal(crawlDelay("https://example.com", robots), 5);
});
test("Recommendations require evidence and reject forbidden fields and null bytes", () => {
  const proposal = { requestId: "r1", url: "https://example.com/products/a", snapshotId: "hash", rulesVersion: "rules-v1", issue: "Issue", evidence: ["source"], proposed: "Proposal", rationale: "Reason", risk: "Risk", priority: "low", confidence: "low", startDate: "2026-01-01", endDate: "2026-01-28" };
  assert.equal(recommendationSchema.safeParse(proposal).success, true);
  for (const override of [{ evidence: [] }, { proposed: "bad\0text" }, { storeId: "other" }, { publish: true }, { startDate: "2026-02-01" }]) assert.equal(recommendationSchema.safeParse({ ...proposal, ...override }).success, false);
});
