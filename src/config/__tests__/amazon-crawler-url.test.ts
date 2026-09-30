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

test("production environment sanitizes internal ports (8766, 3001, 8768) and localhost to same-origin relative URL", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "http://127.0.0.1:8766",
    browserHostname: "vps.example.com",
    browserProtocol: "https:",
    environment: "production",
  }), "");

  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "http://localhost:3001",
    browserHostname: "vps.example.com",
    browserProtocol: "https:",
    environment: "production",
  }), "");

  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "http://vps-server:8768",
    browserHostname: "vps.example.com",
    browserProtocol: "https:",
    environment: "production",
  }), "");
});

test("production environment preserves public HTTPS domain when properly configured without internal ports", () => {
  assert.equal(resolveAmazonCoordinatorUrl({
    configuredUrl: "https://crawler.production.com",
    browserHostname: "production.com",
    browserProtocol: "https:",
    environment: "production",
  }), "https://crawler.production.com");
});


