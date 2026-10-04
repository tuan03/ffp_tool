import assert from "node:assert/strict";
import { test } from "node:test";
import http from "node:http";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { createAdsMcpServer, ADS_MCP_SERVER_INSTRUCTIONS } from "../ads-intelligence/mcp-server";
import { createAdsMcpHandler, handleAdsMcpHttpRequest } from "../ads-intelligence/mcp-handler";
import { generateAdsOpenApiSpec } from "../ads-intelligence/openapi-spec";
import { handleAdsIntelligenceHttpRequest } from "../ads-intelligence/http-handler";
import { getAdsIntelligenceService } from "../ads-intelligence/service";

async function connectInMemoryClient(storeId = "chillgen") {
  const service = getAdsIntelligenceService();
  const server = createAdsMcpServer({ service, defaultStoreId: storeId });
  const client = new Client({ name: "ads-mcp-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  return { client, server };
}

test("Ads MCP Server initializes with instructions and registers all 20 tools (10 canonical + 10 aliases)", async () => {
  const { client, server } = await connectInMemoryClient();

  try {
    const instructions = client.getInstructions() || "";
    assert.match(instructions, /UNTRUSTED/i);
    assert.match(instructions, /OBSERVATIONAL/i);
    assert.match(instructions, /DATA MATURITY GATE/i);
    assert.match(instructions, /TARGET CPA GUARDRAILS/i);
    assert.match(instructions, /ANTI-PLAGIARISM/i);

    const toolsResponse = await client.listTools();
    const toolNames = toolsResponse.tools.map(t => t.name);

    // 10 canonical tools
    const canonicalTools = [
      "ads_get_store_overview",
      "ads_get_data_health",
      "ads_query_performance",
      "ads_get_funnel_evidence",
      "ads_get_decision_cards",
      "ads_get_competitor_creative_gaps",
      "ads_get_experiments",
      "ads_generate_brief",
      "ads_create_experiment",
      "ads_get_evidence",
    ];

    for (const tool of canonicalTools) {
      assert.ok(toolNames.includes(tool), `Expected tool ${tool} to be registered`);
    }

    // 10 README Step 16 aliases
    const aliasTools = [
      "ffp_get_store_context",
      "ffp_get_data_health",
      "ffp_query_performance",
      "ffp_get_funnel_evidence",
      "ffp_get_decision_cards",
      "ffp_get_creative_gaps",
      "ffp_get_experiments",
      "ffp_generate_brief",
      "ffp_create_experiment",
      "ffp_get_evidence",
    ];

    for (const alias of aliasTools) {
      assert.ok(toolNames.includes(alias), `Expected alias ${alias} to be registered`);
    }

    assert.equal(toolNames.length, 20);

    // Annotations verification
    const readOnlyOverview = toolsResponse.tools.find(t => t.name === "ads_get_store_overview");
    assert.equal(readOnlyOverview?.annotations?.readOnlyHint, true);

    const safeWriteBrief = toolsResponse.tools.find(t => t.name === "ads_generate_brief");
    assert.equal(safeWriteBrief?.annotations?.readOnlyHint, false);
  } finally {
    await client.close();
    await server.close();
  }
});

test("Ads MCP Server tools execute correctly and return structured data", async () => {
  const { client, server } = await connectInMemoryClient();

  try {
    // 1. ads_get_store_overview
    const overviewRes = await client.callTool({
      name: "ads_get_store_overview",
      arguments: { storeId: "chillgen" },
    });
    assert.ok(overviewRes.structuredContent);
    const overviewData = overviewRes.structuredContent as Record<string, any>;
    assert.equal(overviewData.storeId, "chillgen");
    assert.ok(overviewData.profile);
    assert.equal(overviewData.profile.currency, "USD");
    assert.ok(parseFloat(overviewData.summary.spend) > 0);
    assert.ok(parseFloat(overviewData.summary.roas) > 0);
    // Ensure no secrets leaked
    assert.equal(overviewData.profile.metaAccessToken, undefined);
    assert.equal(overviewData.profile.proxyUrl, undefined);

    // 2. ads_get_data_health
    const healthRes = await client.callTool({
      name: "ads_get_data_health",
      arguments: { storeId: "chillgen" },
    });
    const healthData = healthRes.structuredContent as Record<string, any>;
    assert.equal(healthData.storeId, "chillgen");
    assert.ok(["CONNECTED", "ERROR"].includes(healthData.metaConnection.status));
    assert.ok(["PROVISIONAL", "FINALIZED"].includes(healthData.maturity.status));
    assert.ok(Array.isArray(healthData.maturity.blockedDecisions));

    // 3. ads_query_performance at account and campaign grain
    const perfAccountRes = await client.callTool({
      name: "ads_query_performance",
      arguments: { storeId: "chillgen", level: "account" },
    });
    const perfAccountData = perfAccountRes.structuredContent as Record<string, any>;
    assert.equal(perfAccountData.level, "account");
    assert.ok(parseFloat(perfAccountData.metrics.spend) > 0);

    const perfCampaignRes = await client.callTool({
      name: "ads_query_performance",
      arguments: { storeId: "chillgen", level: "campaign" },
    });
    const perfCampaignData = perfCampaignRes.structuredContent as Record<string, any>;
    assert.equal(perfCampaignData.level, "campaign");
    assert.ok(perfCampaignData.campaigns.length > 0);

    // 4. ads_get_funnel_evidence
    const funnelRes = await client.callTool({
      name: "ads_get_funnel_evidence",
      arguments: { storeId: "chillgen" },
    });
    const funnelData = funnelRes.structuredContent as Record<string, any>;
    assert.ok(funnelData.meta);
    assert.ok(funnelData.ga4);
    assert.ok(funnelData.shopify);
    assert.ok(funnelData.gaps);
    assert.ok(parseFloat(funnelData.meta.linkClicks) > 0);
    assert.ok(parseFloat(funnelData.ga4.clickToSessionDropPct) >= 0);

    // 5. ads_get_decision_cards
    const decisionsRes = await client.callTool({
      name: "ads_get_decision_cards",
      arguments: { storeId: "chillgen", filter: "all" },
    });
    const decisionsData = decisionsRes.structuredContent as Record<string, any>;
    assert.ok(decisionsData.decisionCards.length > 0);
    const firstDecision = decisionsData.decisionCards[0];
    assert.ok(firstDecision.id);
    assert.ok(firstDecision.decision);
    assert.ok(firstDecision.recommendedNextStep);

    // 6. ads_get_competitor_creative_gaps
    const gapsRes = await client.callTool({
      name: "ads_get_competitor_creative_gaps",
      arguments: { storeId: "chillgen" },
    });
    const gapsData = gapsRes.structuredContent as Record<string, any>;
    assert.equal(gapsData.storeId, "chillgen");
    assert.ok(gapsData.creativeGaps.length > 0);

    // 7. ads_get_experiments
    const expRes = await client.callTool({
      name: "ads_get_experiments",
      arguments: { storeId: "chillgen", status: "all" },
    });
    const expData = expRes.structuredContent as Record<string, any>;
    assert.ok(expData.experiments.length >= 2);
    const completedExp = expData.experiments.find((e: any) => e.status === "COMPLETED");
    assert.ok(completedExp);
    assert.equal(completedExp.learning?.verdict, "WIN");
    assert.ok(completedExp.results?.confoundersNoted?.length > 0);

    // 8. ads_generate_brief from decision
    const briefRes = await client.callTool({
      name: "ads_generate_brief",
      arguments: {
        storeId: "chillgen",
        sourceType: "decision",
        sourceId: firstDecision.id,
      },
    });
    const briefData = briefRes.structuredContent as Record<string, any>;
    assert.equal(briefData.success, true);
    assert.ok(typeof briefData.briefId === "string" && briefData.briefId.length > 0);
    assert.ok(briefData.markdown);
    assert.match(briefData.markdown, /Creative.*Brief/i);
    assert.match(briefData.markdown, /Storyboard/i);
    assert.match(briefData.markdown, /Guardrail/i);

    // 9. ads_create_experiment from the generated brief
    const newExpRes = await client.callTool({
      name: "ads_create_experiment",
      arguments: {
        storeId: "chillgen",
        briefId: briefData.briefId,
        variantName: "Variant V2 Hook",
        notes: "Observational test created via MCP tool",
      },
    });
    const newExpData = newExpRes.structuredContent as Record<string, any>;
    assert.equal(newExpData.success, true);
    assert.ok(newExpData.experimentId);
    assert.equal(newExpData.testMethodology, "OBSERVATIONAL");

    // 10. ads_get_evidence snapshot
    const evidenceRes = await client.callTool({
      name: "ads_get_evidence",
      arguments: { storeId: "chillgen", evidenceType: "reconciliation" },
    });
    const evidenceData = evidenceRes.structuredContent as Record<string, any>;
    assert.equal(evidenceData.evidenceType, "reconciliation");
    assert.ok(evidenceData.snapshot);
  } finally {
    await client.close();
    await server.close();
  }
});

test("Ads MCP aliases execute interchangeably with canonical names", async () => {
  const { client, server } = await connectInMemoryClient();

  try {
    // Call ffp_get_store_context (alias of ads_get_store_overview)
    const contextRes = await client.callTool({
      name: "ffp_get_store_context",
      arguments: { storeId: "chillgen" },
    });
    const contextData = contextRes.structuredContent as Record<string, any>;
    assert.equal(contextData.storeId, "chillgen");
    assert.ok(contextData.profile.economics.targetCpa > 0);

    // Call ffp_get_creative_gaps (alias of ads_get_competitor_creative_gaps)
    const gapsRes = await client.callTool({
      name: "ffp_get_creative_gaps",
      arguments: { storeId: "chillgen" },
    });
    const gapsData = gapsRes.structuredContent as Record<string, any>;
    assert.ok(gapsData.creativeGaps.length > 0);

    // Call ffp_get_experiments (alias of ads_get_experiments)
    const expRes = await client.callTool({
      name: "ffp_get_experiments",
      arguments: { storeId: "chillgen", status: "running" },
    });
    const expData = expRes.structuredContent as Record<string, any>;
    assert.ok(expData.experiments.every((e: any) => e.status === "RUNNING"));
  } finally {
    await client.close();
    await server.close();
  }
});

test("Ads MCP HTTP Handler serves GET probe info and handles requests", async () => {
  const handler = createAdsMcpHandler();

  // Test GET probe
  const req = {
    method: "GET",
    url: "/mcp/ads",
    headers: {},
  } as unknown as http.IncomingMessage;

  let statusCode = 0;
  let headers: Record<string, string> = {};
  let responseBody = "";

  const res = {
    set statusCode(code: number) { statusCode = code; },
    get statusCode() { return statusCode; },
    setHeader(name: string, value: string) { headers[name.toLowerCase()] = value; },
    end(chunk?: string) { if (chunk) responseBody += chunk; },
  } as unknown as http.ServerResponse;

  await handler(req, res);

  assert.equal(statusCode, 200);
  assert.equal(headers["content-type"], "application/json; charset=utf-8");
  const parsed = JSON.parse(responseBody);
  assert.equal(parsed.status, "ok");
  assert.equal(parsed.server, "ffp-ads-intelligence");
  assert.equal(parsed.toolsCount, 20);
});

test("OpenAPI spec generator produces valid 3.1.0 schema with all endpoints", async () => {
  const spec = generateAdsOpenApiSpec("http://localhost:3001") as Record<string, any>;

  assert.equal(spec.openapi, "3.1.0");
  assert.equal(spec.info.title, "FFP Ads Intelligence API");
  assert.ok(spec.paths["/api/ads-intelligence/summary"]);
  assert.ok(spec.paths["/api/ads-intelligence/hierarchy"]);
  assert.ok(spec.paths["/api/ads-intelligence/health"]);
  assert.ok(spec.paths["/api/ads-intelligence/reconciliation"]);
  assert.ok(spec.paths["/api/ads-intelligence/decisions"]);
  assert.ok(spec.paths["/api/ads-intelligence/ai-analyze"]);
  assert.ok(spec.paths["/api/ads-intelligence/competitors"]);
  assert.ok(spec.paths["/api/ads-intelligence/briefs"]);
  assert.ok(spec.paths["/api/ads-intelligence/briefs/generate"]);
  assert.ok(spec.paths["/api/ads-intelligence/briefs/{id}"]);
  assert.ok(spec.paths["/api/ads-intelligence/briefs/{id}/markdown"]);
  assert.ok(spec.paths["/api/ads-intelligence/briefs/{id}/status"]);
  assert.ok(spec.paths["/api/ads-intelligence/experiments"]);
  assert.ok(spec.paths["/api/ads-intelligence/experiments/{id}"]);
  assert.ok(spec.paths["/api/ads-intelligence/experiments/{id}/outcome"]);
  assert.ok(spec.paths["/api/ads-intelligence/mcp/info"]);
});

test("Gateway HTTP handler serves /api/ads-intelligence/openapi.json and /mcp/info", async () => {
  // Test /api/ads-intelligence/openapi.json
  const openApiReq = {
    method: "GET",
    url: "/api/ads-intelligence/openapi.json",
    headers: { host: "127.0.0.1:3001" },
  } as unknown as http.IncomingMessage;

  let statusCode = 0;
  let responseBody = "";

  const openApiRes = {
    set statusCode(code: number) { statusCode = code; },
    get statusCode() { return statusCode; },
    setHeader() {},
    end(chunk?: string) { if (chunk) responseBody += chunk; },
  } as unknown as http.ServerResponse;

  const handled = await handleAdsIntelligenceHttpRequest(openApiReq, openApiRes);
  assert.equal(handled, true);
  assert.equal(statusCode, 200);
  const parsedSpec = JSON.parse(responseBody);
  assert.equal(parsedSpec.openapi, "3.1.0");

  // Test /api/ads-intelligence/mcp/info
  let mcpInfoStatus = 0;
  let mcpInfoBody = "";
  const mcpInfoReq = {
    method: "GET",
    url: "/api/ads-intelligence/mcp/info",
    headers: {},
  } as unknown as http.IncomingMessage;

  const mcpInfoRes = {
    set statusCode(code: number) { mcpInfoStatus = code; },
    get statusCode() { return mcpInfoStatus; },
    setHeader() {},
    end(chunk?: string) { if (chunk) mcpInfoBody += chunk; },
  } as unknown as http.ServerResponse;

  const mcpHandled = await handleAdsIntelligenceHttpRequest(mcpInfoReq, mcpInfoRes);
  assert.equal(mcpHandled, true);
  assert.equal(mcpInfoStatus, 200);
  const parsedMcp = JSON.parse(mcpInfoBody);
  assert.equal(parsedMcp.server, "ffp-ads-intelligence");
  assert.equal(parsedMcp.toolsCount, 20);
});
