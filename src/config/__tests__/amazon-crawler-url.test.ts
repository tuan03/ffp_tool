import assert from "node:assert/strict";
import test from "node:test";

import { resolveAmazonCoordinatorUrl } from "../amazon-crawler-url";

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

test("production environment defaults to relative same-origin URL when no URL is configured", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: undefined,
    browserHostname: "vps.example.com",
    browserProtocol: "https:",
    environment: "production",
  }), "");
});

test("empty configured URL resolves to relative same-origin URL", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "",
    browserHostname: "localhost",
    browserProtocol: "http:",
  }), "");
});

