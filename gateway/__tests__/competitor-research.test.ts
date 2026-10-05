import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { createCompetitorResearchRepository, competitorResearchSchema } from "../ads-intelligence/competitor-research";

const sample = {
  storeId: "sample", shopDomain: "sample.myshopify.com", storeDomain: "sample.example",
  observedAt: "2026-10-05T00:00:00Z",
  scope: { products: ["blanket"], market: "US", currency: "USD", excluded: ["rug"] },
  selected: [{ name: "Example", domain: "competitor.example", productGroup: "blanket", score: 75,
    scoreBreakdown: { product: 30, customizationModel: 20, audience: 15, price: 0, themes: 10 },
    confidence: "high", evidence: [{ url: "https://competitor.example/blanket", note: "Personalized blanket; US delivery" }],
    adStatus: "No verified ads" }],
  limitations: ["No verified ads"], websiteDerivedHypotheses: [],
};

test("Research persists independently of ads, survives repository recreation and isolates stores", async () => {
  const root = await mkdtemp(join(tmpdir(), "research-test-"));
  try {
    const first = createCompetitorResearchRepository(root);
    assert.equal(await first.get("sample"), null);
    await first.save(sample);
    const second = createCompetitorResearchRepository(root);
    assert.equal((await second.get("sample"))?.selected[0]?.name, "Example");
    assert.equal(await second.get("other-store"), null);
    await assert.rejects(second.get("../sample"));
    await assert.rejects(second.save({ ...sample, observedAt: "2026-10-04T00:00:00Z" }), /RESEARCH_STALE/);
    assert.equal((await second.get("sample"))?.observedAt, sample.observedAt);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Research rejects unsafe links, duplicate domains, mismatched scores and invalid scope", () => {
  const candidate = sample.selected[0];
  assert.ok(candidate);
  for (const selected of [
    [candidate, candidate],
    [{ ...candidate, score: 99 }],
    [{ ...candidate, evidence: [{ url: "javascript:alert(1)", note: "Unsafe" }] }],
    [{ ...candidate, score: 55, scoreBreakdown: { ...candidate.scoreBreakdown, product: 10 } }],
  ]) assert.equal(competitorResearchSchema.safeParse({ ...sample, selected }).success, false);
  assert.equal(competitorResearchSchema.safeParse({ ...sample, storeId: "../sample" }).success, false);
});

test("MCP publish is readable through dashboard HTTP without an ad provider and rejects wrong mapping", async context => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
  const { createAdsMcpServer } = await import("../ads-intelligence/mcp-server");
  const { configureAdsGateway } = await import("../ads-intelligence/gateway-connection");
  const { InMemoryStoreRegistry } = await import("../store-registry");
  const { ShopifyGraphqlClient } = await import("../shopify-graphql-client");
  const { InMemoryThrottleManager } = await import("../throttle-manager");
  const { competitorResearchRepository } = await import("../ads-intelligence/competitor-research");
  const { handleAdsIntelligenceHttpRequest } = await import("../ads-intelligence/http-handler");
  const http = await import("node:http");
  const root = await mkdtemp(join(tmpdir(), "research-api-test-"));
  const repository = createCompetitorResearchRepository(root);
  context.mock.method(competitorResearchRepository, "get", repository.get);
  context.mock.method(competitorResearchRepository, "save", repository.save);
  configureAdsGateway({
    storeRegistry: new InMemoryStoreRegistry([{ storeId: "sample", shopDomain: "sample.myshopify.com", apiVersion: "2026-07", auth: { type: "static", staticToken: "fixture" } }]),
    graphqlClient: new ShopifyGraphqlClient({ tokenProvider: { getToken: async () => "fixture", invalidate() {} }, throttleManager: new InMemoryThrottleManager() }),
  });
  const server = createAdsMcpServer();
  const client = new Client({ name: "research-test", version: "1" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const httpServer = http.createServer((req, res) => { void handleAdsIntelligenceHttpRequest(req, res); });
  try {
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
    const published = await client.callTool({ name: "ads_publish_competitor_research", arguments: { research: sample } });
    assert.notEqual(published.isError, true);
    const mismatch = await client.callTool({ name: "ads_publish_competitor_research", arguments: { research: { ...sample, shopDomain: "wrong.myshopify.com" } } });
    assert.equal(mismatch.isError, true);
    await new Promise<void>(resolve => httpServer.listen(0, "127.0.0.1", resolve));
    const address = httpServer.address();
    assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/api/ads-intelligence/competitor-research`;
    const response = await fetch(`${base}?storeId=sample`);
    assert.equal(response.status, 200);
    const body = await response.json() as { research: { selected: { name: string }[] } };
    assert.equal(body.research.selected[0]?.name, "Example");
    assert.equal((await fetch(base)).status, 400);
    assert.equal((await fetch(`${base}?storeId=other`, { method: "POST", body: JSON.stringify(sample) })).status, 400);
  } finally {
    await client.close(); await server.close();
    if (httpServer.listening) await new Promise<void>((resolve, reject) => httpServer.close(error => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  }
});

test("stores without Ads profiles reject before launching concurrent sources", async context => {
  const { AdsIntelligenceService } = await import("../ads-intelligence/service");
  const service = new AdsIntelligenceService();
  let started = 0;
  context.mock.method(service, "getStoreSummary", async () => { started++; return undefined; });
  context.mock.method(service, "getReconciliationReport", async () => { started++; return undefined; });
  await assert.rejects(service.getDecisionCards("research-test-unconfigured"));
  await assert.rejects(service.getAiStrategicReport("research-test-unconfigured"));
  assert.equal(started, 0);
});

test("advertiser lookup returns provider Page IDs and fails explicitly on quota errors", async context => {
  const { DefaultCompetitorClient } = await import("../ads-intelligence/competitor-client");
  const previous = process.env.SCRAPE_CREATORS_API_KEY;
  process.env.SCRAPE_CREATORS_API_KEY = "synthetic-test-key";
  try {
    context.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
      assert.match(String(input), /search\/companies\?query=Example/);
      return Response.json({ success: true, searchResults: [{ page_id: "123", name: "Example", page_alias: "examplebrand" }] });
    });
    const client = new DefaultCompetitorClient();
    assert.deepEqual(await client.searchCompanies("Example"), [{ pageId: "123", pageName: "Example", pageAlias: "examplebrand" }]);
    context.mock.method(globalThis, "fetch", async () => new Response("quota", { status: 402 }));
    await assert.rejects(client.searchCompanies("Example"), /COMPETITOR_PROVIDER_HTTP_402/);
  } finally {
    if (previous === undefined) delete process.env.SCRAPE_CREATORS_API_KEY;
    else process.env.SCRAPE_CREATORS_API_KEY = previous;
  }
});

test("verified ad snapshots require brand evidence and remain filterable without the old watchlist", async () => {
  const { normalizeSnapshotAd } = await import("../ads-intelligence/competitor-client");
  const { createResearchAdReport } = await import("../ads-intelligence/competitor-ad-research");
  const ad = { ...normalizeSnapshotAd({ ad_archive_id: "234", page_id: "123", page_name: "Example", is_active: true, snapshot: { body: { text: "Personalized blanket" }, link_url: "https://competitor.example/products/blanket", images: [{ original_image_url: "https://competitor.example/blanket.jpg" }] } }, "123"), retrievedAt: sample.observedAt };
  const verifiedAds = [{ brandDomain: "competitor.example", productEvidenceUrl: "https://competitor.example/products/blanket", qualificationReason: "Synthetic fixture: matching blanket", ad }];
  const adCollection = [{ brandDomain: "competitor.example", pageIds: ["123"], identityEvidence: ["https://competitor.example"], status: "verified_ads", retrievedCount: 4, matchedCount: 1, note: "Synthetic fixture" }];
  const research = competitorResearchSchema.parse({ ...sample, verifiedAds, adCollection });
  const report = createResearchAdReport({ storeId: sample.storeId, observedAt: sample.observedAt, verifiedAds: research.verifiedAds ?? [] });
  assert.equal(report.ads.length, 1);
  assert.equal(report.watchlist[0]?.pageId, "123");
  assert.equal(createResearchAdReport({ storeId: sample.storeId, observedAt: sample.observedAt, verifiedAds: research.verifiedAds ?? [], filters: { format: "VIDEO" } }).ads.length, 0);
  assert.equal(competitorResearchSchema.safeParse({ ...sample, verifiedAds }).success, false);
  assert.equal(competitorResearchSchema.safeParse({ ...sample, verifiedAds: [verifiedAds[0], verifiedAds[0]], adCollection }).success, false);
  assert.equal(competitorResearchSchema.safeParse({ ...sample, verifiedAds: [{ ...verifiedAds[0], brandDomain: "other.example" }], adCollection }).success, false);
  assert.equal(ad.inspectionLevel, "THUMBNAIL_ONLY");
});

test("Live ad search forwards expanded country, status and pagination scope", async () => {
  const { DefaultCompetitorClient } = await import("../ads-intelligence/competitor-client");
  const originalFetch = globalThis.fetch;
  const previousKey = process.env.SCRAPECREATORS_API_KEY;
  process.env.SCRAPECREATORS_API_KEY = "test-only";
  try {
    globalThis.fetch = async (input) => {
      const url = new URL(String(input));
      assert.equal(url.searchParams.get("country"), "ALL");
      assert.equal(url.searchParams.get("status"), "ALL");
      assert.equal(url.searchParams.get("cursor"), "next-page");
      return new Response(JSON.stringify({ success: true, searchResults: [], cursor: "last-page" }));
    };
    const response = await new DefaultCompetitorClient().searchLiveAds("sample blanket", { country: "ALL", cursor: "next-page", activeStatus: "ALL" });
    assert.equal(response.nextCursor, "last-page");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousKey === undefined) delete process.env.SCRAPECREATORS_API_KEY;
    else process.env.SCRAPECREATORS_API_KEY = previousKey;
  }
});

test("Research displays only verified product cards from a mixed carousel and preserves inactive status", async () => {
  const { normalizeSnapshotAd } = await import("../ads-intelligence/competitor-client");
  const { verifiedCompetitorAdSchema, createResearchAdReport } = await import("../ads-intelligence/competitor-ad-research");
  const ad = { ...normalizeSnapshotAd({ ad_archive_id: "234", page_id: "123", is_active: false, snapshot: { link_url: "https://competitor.example/" } }, "123"), retrievedAt: sample.observedAt, mediaType: "CAROUSEL" as const,
    cards: [{ mediaUrl: "https://competitor.example/rug.jpg", linkUrl: "https://competitor.example/rug" }, { mediaUrl: "https://competitor.example/blanket.jpg", linkUrl: "https://competitor.example/blanket" }] };
  const entry = { brandDomain: "competitor.example", productEvidenceUrl: "https://competitor.example/blanket", qualificationReason: "Only card two is a blanket", selectedCardIndices: [1], ad };
  const parsed = verifiedCompetitorAdSchema.parse(entry);
  const report = createResearchAdReport({ storeId: "sample", observedAt: sample.observedAt, verifiedAds: [parsed] });
  assert.deepEqual(report.ads[0]?.mediaUrls, ["https://competitor.example/blanket.jpg"]);
  assert.equal(report.ads[0]?.cards?.length, 1);
  assert.equal(report.ads[0]?.status, "INACTIVE");
  assert.equal(report.ads[0]?.landingUrl, "https://competitor.example/blanket");
  assert.match(report.ads[0]?.taxonomy.angle ?? "", /2\/2/);
  assert.equal(verifiedCompetitorAdSchema.safeParse({ ...entry, selectedCardIndices: [2] }).success, false);
  assert.equal(verifiedCompetitorAdSchema.safeParse({ ...entry, selectedCardIndices: [1, 1] }).success, false);
});
