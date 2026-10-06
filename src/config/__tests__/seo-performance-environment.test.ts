import assert from "node:assert/strict";
import test from "node:test";

import type { Ga4IntegrationSummary, GscIntegrationSummary, PerformanceIntegrationSummary } from "../../modules/seo-performance";

import { parseSeoPerformanceEnvironment } from "../seo-performance-environment";

const KEY = "ab".repeat(32);

test("SEO Performance uses the combined Google OAuth variables for GSC and GA4", () => {
  const config = parseSeoPerformanceEnvironment({
    SEO_PERFORMANCE_ENABLED: "true",
    DATABASE_URL: "postgresql://localhost/ffp_tool",
    GOOGLE_OAUTH_CLIENT_ID: "combined-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "combined-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "https://ffp.example.com/api/seo-performance/oauth/callback",
    GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: KEY,
    GSC_CLIENT_ID: "legacy-client",
    GSC_CLIENT_SECRET: "legacy-secret",
  });

  assert.equal(config.enabled, true);
  assert.equal(config.requestedEnabled, true);
  assert.equal(config.configured, true);
  assert.equal(config.valid, true);
  assert.deepEqual(config.issues, []);
  assert.equal(config.oauthVariableSource, "google_oauth");
  assert.equal(config.clientId, "combined-client");
  assert.equal(config.clientSecret, "combined-secret");
});

test("SEO Performance falls back to legacy GSC variable names when combined variables are absent", () => {
  const config = parseSeoPerformanceEnvironment({
    SEO_PERFORMANCE_ENABLED: "true",
    AUTO_SEO_DATABASE_URL: "postgresql://localhost/ffp_tool",
    GSC_CLIENT_ID: "legacy-client",
    GSC_CLIENT_SECRET: "legacy-secret",
    GSC_REDIRECT_URI: "https://ffp.example.com/api/seo-performance/oauth/callback",
    GSC_TOKEN_ENCRYPTION_KEY: KEY,
  });

  assert.equal(config.enabled, true);
  assert.equal(config.oauthVariableSource, "legacy_gsc");
  assert.equal(config.clientId, "legacy-client");
  assert.equal(config.clientSecret, "legacy-secret");
  assert.equal(config.encryptionKey, KEY);
});

test("SEO Performance fails closed with typed issues for an invalid redirect URI and encryption key", () => {
  const config = parseSeoPerformanceEnvironment({
    SEO_PERFORMANCE_ENABLED: "true",
    DATABASE_URL: "postgresql://localhost/ffp_tool",
    GOOGLE_OAUTH_CLIENT_ID: "combined-client",
    GOOGLE_OAUTH_CLIENT_SECRET: "combined-secret",
    GOOGLE_OAUTH_REDIRECT_URI: "http://ffp.example.com/oauth/callback#code",
    GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY: "not-a-key",
    GSC_REDIRECT_URI: "https://legacy.example.com/valid",
    GSC_TOKEN_ENCRYPTION_KEY: KEY,
  });

  assert.equal(config.enabled, false);
  assert.equal(config.configured, true);
  assert.equal(config.valid, false);
  assert.deepEqual(config.issues, ["GOOGLE_OAUTH_REDIRECT_URI_INVALID", "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_INVALID"]);
  assert.equal(config.redirectUri, "http://ffp.example.com/oauth/callback#code");
  assert.equal(config.encryptionKey, "not-a-key");
});

test("SEO Performance reports missing server configuration without throwing or enabling the runtime", () => {
  const config = parseSeoPerformanceEnvironment({ SEO_PERFORMANCE_ENABLED: "true" });

  assert.equal(config.enabled, false);
  assert.equal(config.configured, false);
  assert.equal(config.valid, false);
  assert.deepEqual(config.issues, [
    "DATABASE_URL_REQUIRED",
    "GOOGLE_OAUTH_CLIENT_ID_REQUIRED",
    "GOOGLE_OAUTH_CLIENT_SECRET_REQUIRED",
    "GOOGLE_OAUTH_REDIRECT_URI_REQUIRED",
    "GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY_REQUIRED",
  ]);
});

test("public GSC and GA4 integration summaries contain no credential or token fields", () => {
  const freshness = { dataThrough: "2026-10-01", fetchedAt: "2026-10-05T00:00:00Z", lastSuccessfulSync: "2026-10-05T00:00:00Z", stale: false, staleReason: null } as const;
  const summaries: readonly PerformanceIntegrationSummary[] = [{
    source: "gsc", status: "CONNECTED", connectionId: "connection-gsc", mappingRevision: 2,
    origin: "https://example.com", property: "sc-domain:example.com", freshness, quality: [],
  }, {
    source: "ga4", status: "CONNECTED", connectionId: "connection-ga4", mappingRevision: 2,
    origin: "https://example.com", property: { propertyId: "123456789", streamId: "987654321", hostnameScope: "example.com", timeZone: "Asia/Ho_Chi_Minh", currencyCode: "USD" }, freshness, quality: [],
  }];
  type SensitiveGscKey = Extract<keyof GscIntegrationSummary, "accessToken" | "refreshToken" | "clientSecret" | "encryptionKey">;
  type SensitiveGa4Key = Extract<keyof Ga4IntegrationSummary, "accessToken" | "refreshToken" | "clientSecret" | "encryptionKey">;
  const hasNoSensitivePublicKeys: SensitiveGscKey extends never ? SensitiveGa4Key extends never ? true : false : false = true;

  assert.equal(hasNoSensitivePublicKeys, true);
  assert.doesNotMatch(JSON.stringify(summaries), /accessToken|refreshToken|clientSecret|encryptionKey/i);
  assert.deepEqual(summaries.map(summary => summary.source), ["gsc", "ga4"]);
});
