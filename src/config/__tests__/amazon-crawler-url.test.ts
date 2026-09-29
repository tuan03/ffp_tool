import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmazonCoordinatorUrl } from "../amazon-crawler-url";

test("coordinator URL follows the browser same-origin host without hardcoding internal port 8766", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: undefined,
    browserHostname: "192.168.1.231",
    browserProtocol: "http:",
  }), "http://192.168.1.231");
});

test("coordinator URL preserves browser port when present", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: undefined,
    browserHostname: "localhost",
    browserProtocol: "http:",
    browserPort: "5173",
  }), "http://localhost:5173");
});

test("configured coordinator URL overrides the browser host", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "https://crawler.example.com/",
    browserHostname: "192.168.1.231",
    browserProtocol: "http:",
  }), "https://crawler.example.com");
});

test("relative coordinator URL is supported for reverse proxying", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "/api/coordinator",
    browserHostname: "192.168.1.231",
    browserProtocol: "http:",
  }), "/api/coordinator");
});

test("empty or whitespace configured URL falls back to browser host", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "   ",
    browserHostname: "192.168.1.231",
    browserProtocol: "https:",
  }), "https://192.168.1.231");
});

test("invalid protocol throws expected error", () => {
  assert.throws(
    () =>
      resolveAmazonCoordinatorUrl({
        configuredUrl: "ftp://example.com",
        browserHostname: "localhost",
        browserProtocol: "http:",
      }),
    /VITE_AMAZON_COORDINATOR_URL must be a valid HTTP\(S\) URL or relative path\./,
  );
});
