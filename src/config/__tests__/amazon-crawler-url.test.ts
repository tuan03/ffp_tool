import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmazonCoordinatorUrl } from "../amazon-crawler-url";

test("production coordinator uses the public browser origin including its port", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "http://localhost:8766",
    browserHostname: "ffp.example.com",
    browserProtocol: "https:",
    browserOrigin: "https://ffp.example.com:8443",
    isProduction: true,
  }), "https://ffp.example.com:8443");
});

test("coordinator URL follows the browser IPv4 host when no URL is configured", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: undefined,
    browserHostname: "192.168.1.231",
    browserProtocol: "http:",
  }), "http://192.168.1.231:8766");
});

test("configured coordinator URL overrides the browser host", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "https://crawler.example.com/",
    browserHostname: "192.168.1.231",
    browserProtocol: "http:",
  }), "https://crawler.example.com");
});
