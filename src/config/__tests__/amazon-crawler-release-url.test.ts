import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmazonCrawlerReleaseApiUrl } from "../amazon-crawler-release-url";

test("agent release URL defaults to the public FFP Tool GitHub repository", () => {
  assert.equal(
    resolveAmazonCrawlerReleaseApiUrl(undefined),
    "https://api.github.com/repos/tuan03/ffp_tool/releases/latest",
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
