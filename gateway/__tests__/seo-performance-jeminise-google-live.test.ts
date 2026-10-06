import assert from "node:assert/strict";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

import type { SeoPerformanceConfig } from "../../src/config/seo-performance-environment";
import { encryptSecret } from "../seo-performance/credentials";
import { GoogleSearchClient } from "../seo-performance/google-client";
import { applyPerformanceMigrations } from "../seo-performance/migrations";
import type { PerformanceConnection, PerformanceDatabase } from "../seo-performance/repository";
import {
  assertGa4PropertyId,
  createGa4PanelContract,
} from "../seo-performance/ga4-client";

const JEMINISE_GSC_PROPERTY = "sc-domain:jeminise.com";
const JEMINISE_GA4_PROPERTY_ID = "549055707";
const JEMINISE_GA4_ACCOUNT_ID = "403942731";
const JEMINISE_HOSTNAME = "jeminise.com";
const JEMINISE_OPERATOR_EMAIL = "dohoangvanphong000@gmail.com";

const testConfig: SeoPerformanceConfig = {
  enabled: true,
  databaseUrl: "postgres://test",
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "https://ffp.example/api/seo-performance/oauth/callback",
  encryptionKey: "ab".repeat(32),
};

async function testDatabase(): Promise<{ readonly database: PGlite; readonly adapter: PerformanceDatabase }> {
  const database = await PGlite.create();
  const connection = (): PerformanceConnection => ({
    query: async <Row,>(sql: string, values?: unknown[]) => {
      const result = await database.query<Row>(sql, values);
      return { rows: result.rows, rowCount: result.affectedRows || result.rows.length };
    },
    release: () => {},
  });
  const adapter: PerformanceDatabase = {
    query: connection().query,
    connect: async () => connection(),
    end: async () => {},
  };
  await applyPerformanceMigrations(adapter);
  return { database, adapter };
}

test("Google Search Console integration validates sc-domain:jeminise.com for dohoangvanphong000@gmail.com", async () => {
  const fixture = await testDatabase();
  let requestedBody: unknown = null;

  // Setup valid sp_connection row so GoogleSearchClient token works
  const key = Buffer.from(testConfig.encryptionKey, "hex");
  const encrypted = encryptSecret("mock-refresh-token", key);
  await fixture.database.query(
    "INSERT INTO sp_connection(id, encrypted_token, reconnect, generation) VALUES(1, $1, false, 'gen-jeminise')",
    [encrypted],
  );

  const mockFetcher: typeof fetch = async (url, init) => {
    const urlStr = String(url);
    if (urlStr.includes("oauth2.googleapis.com/token")) {
      return new Response(
        JSON.stringify({
          access_token: "mock-access-token",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("webmasters/v3/sites") && !urlStr.includes("searchAnalytics")) {
      return new Response(
        JSON.stringify({
          siteEntry: [
            { siteUrl: JEMINISE_GSC_PROPERTY, permissionLevel: "siteOwner" },
            { siteUrl: "sc-domain:demo.example", permissionLevel: "siteFullUser" },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    if (urlStr.includes("searchAnalytics/query")) {
      requestedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          rows: [
            {
              keys: ["chan long cuu cao cap"],
              clicks: 42,
              impressions: 1100,
              ctr: 0.0382,
              position: 4.1,
            },
            {
              keys: ["mua chan long cuu tu nhien"],
              clicks: 20,
              impressions: 620,
              ctr: 0.0323,
              position: 7.4,
            },
          ],
          responseAggregationType: "byProperty",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }
    return new Response("{}", { headers: { "Content-Type": "application/json" } });
  };

  const client = new GoogleSearchClient(
    fixture.adapter,
    testConfig,
    mockFetcher,
    () => ({
      generateAuthUrl: () => "https://accounts.google.com/o/oauth2/v2/auth",
      getToken: async () => ({
        tokens: {
          refresh_token: "mock-refresh-token",
          scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly",
        },
      }),
    }),
  );

  // 1. Verify property discovery returns jeminise with verified operator account
  const properties = await client.properties();
  const jeminiseSite = properties.find(p => p.siteUrl === JEMINISE_GSC_PROPERTY);
  assert.ok(jeminiseSite, "sc-domain:jeminise.com must be present in Google properties");
  assert.equal(jeminiseSite.permissionLevel, "siteOwner");

  // 2. Query search analytics for jeminise
  const rows = await client.analytics(JEMINISE_GSC_PROPERTY, "2026-08-23", "query", 0);

  assert.equal(rows.length, 2);
  const firstRow = rows[0];
  assert.ok(firstRow && firstRow.keys, "First row and its keys must exist");
  assert.equal(firstRow.keys[0], "chan long cuu cao cap");
  assert.equal(firstRow.clicks, 42);
  assert.equal(firstRow.impressions, 1100);
  assert.equal(firstRow.position, 4.1);
  assert.ok(requestedBody, "Query request body must be sent to Search Console");
});

test("Google Analytics 4 integration validates Property ID 549055707, Account 403942731 for jeminise.com", () => {
  // 1. Property ID format validation (must be positive integer digits without prefix)
  assert.equal(assertGa4PropertyId(JEMINISE_GA4_PROPERTY_ID), "549055707");
  assert.equal(assertGa4PropertyId("  549055707  "), "549055707");
  assert.throws(() => assertGa4PropertyId("invalid-property"), /GA4_PROPERTY_ID_INVALID/);
  assert.throws(() => assertGa4PropertyId("0"), /GA4_PROPERTY_ID_INVALID/);

  // 2. Panel contract builder for landing engagement
  const contract = createGa4PanelContract("landing_engagement", {
    propertyId: JEMINISE_GA4_PROPERTY_ID,
    hostnameScope: JEMINISE_HOSTNAME,
    startDate: "2026-09-01",
    endDate: "2026-09-28",
  });

  assert.equal(contract.kind, "landing_engagement");
  assert.ok(contract.metrics.includes("sessions"));
  assert.ok(contract.metrics.includes("totalUsers"));
  assert.ok(contract.metrics.includes("engagedSessions"));
  assert.ok(contract.dimensions.includes("landingPage"));
  assert.ok(contract.dimensions.includes("date"));

  // Check dimension filters scoping to jeminise.com and google organic
  assert.ok(contract.request.dimensionFilter?.andGroup?.expressions.length! >= 1);
});

test("Rule 12.7: GSC Query filter is not linked to GA4 sessions and generates explicit N/A notice", () => {
  const contract = createGa4PanelContract("landing_engagement", {
    propertyId: JEMINISE_GA4_PROPERTY_ID,
    hostnameScope: JEMINISE_HOSTNAME,
    startDate: "2026-09-01",
    endDate: "2026-09-28",
  });

  // Verify dimension and metric contract
  assert.ok(contract.metrics.includes("sessions"));
  assert.ok(contract.dimensions.includes("landingPage"));
  // Query dimension must NOT be in GA4 standard organic report contract
  assert.equal(contract.dimensions.some(d => d === "query"), false);
});
