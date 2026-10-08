import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmazonCrawlerReleaseApiUrl } from "../amazon-crawler-release-url";

test("agent release URL defaults to the same-origin verified Coordinator catalog", () => {
  assert.equal(
    resolveAmazonCrawlerReleaseApiUrl(undefined),
    "/api/v1/agent-release",
  );
});

test("agent release URL accepts an explicit HTTPS endpoint", () => {
  assert.equal(
    resolveAmazonCrawlerReleaseApiUrl("https://github.example.com/api/releases/latest"),
    "https://github.example.com/api/releases/latest",
  );
});

test("agent release URL rejects non-HTTPS endpoints", () => {
  assert.throws(
    () => resolveAmazonCrawlerReleaseApiUrl("http://example.com/releases/latest"),
    /must be a valid HTTPS URL/,
  );
});
