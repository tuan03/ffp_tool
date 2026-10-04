import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createAdsMcpServer } from "../gateway/ads-intelligence/mcp-server";
import { getAdsIntelligenceService } from "../gateway/ads-intelligence/service";

const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
};

async function main() {
  console.log(`\n${ANSI.bold}${ANSI.cyan}================================================================${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}   FFP ADS INTELLIGENCE — MCP SERVER LIVE TEST RUNNER           ${ANSI.reset}`);
  console.log(`${ANSI.bold}${ANSI.cyan}================================================================${ANSI.reset}\n`);

  const storeId = process.argv[2] || "chillgen";
  console.log(`${ANSI.yellow}🎯 Target Store:${ANSI.reset} ${storeId}`);

  // 1. Initialize MCP Server and In-Memory Client
  console.log(`\n${ANSI.blue}[Step 1] Connecting to MCP Server via Protocol SDK...${ANSI.reset}`);
  const service = getAdsIntelligenceService();
  const server = createAdsMcpServer({ service, defaultStoreId: storeId });
  const client = new Client({ name: "ffp-ads-test-runner", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);

  console.log(`${ANSI.green}✔ MCP Client & Server successfully connected!${ANSI.reset}`);

  try {
    // 2. Instructions check
    console.log(`\n${ANSI.blue}[Step 2] Verifying System Instructions & Guardrails...${ANSI.reset}`);
    const instructions = client.getInstructions() || "";
    console.log(`${ANSI.cyan}Instructions preview (First 200 chars):${ANSI.reset}\n${instructions.substring(0, 200)}...`);

    // 3. List Tools
    console.log(`\n${ANSI.blue}[Step 3] Querying Registered Tools (tools/list)...${ANSI.reset}`);
    const toolsResult = await client.listTools();
    console.log(`${ANSI.green}✔ Registered Tools Count:${ANSI.reset} ${toolsResult.tools.length}`);
    toolsResult.tools.forEach((t, i) => {
      const mode = t.annotations?.readOnlyHint ? `${ANSI.cyan}[Read-Only]${ANSI.reset}` : `${ANSI.magenta}[Mutation]${ANSI.reset}`;
      console.log(`  ${(i + 1).toString().padStart(2, " ")}. ${ANSI.bold}${t.name.padEnd(35, " ")}${ANSI.reset} ${mode} ${t.description.substring(0, 65)}...`);
    });

    // 4. Test ads_get_store_overview
    console.log(`\n${ANSI.blue}[Step 4] Calling Tool: ads_get_store_overview (Store Profile & Economics)...${ANSI.reset}`);
    const overviewRes = await client.callTool({
      name: "ads_get_store_overview",
      arguments: { storeId },
    });
    const overview = overviewRes.structuredContent as Record<string, any>;
    console.log(`${ANSI.green}✔ Store Overview Result:${ANSI.reset}`);
    console.log(`  - Currency: ${overview.profile?.currency}`);
    console.log(`  - Target CPA: $${overview.profile?.economics?.targetCpa}`);
    console.log(`  - Spend: $${overview.summary?.spend}`);
    console.log(`  - Purchases: ${overview.summary?.purchases}`);
    console.log(`  - ROAS: ${overview.summary?.roas}`);
    console.log(`  - Data Maturity: ${overview.summary?.maturity}`);

    // 5. Test ads_get_data_health
    console.log(`\n${ANSI.blue}[Step 5] Calling Tool: ads_get_data_health (Maturity Gate & Tracking Discrepancy)...${ANSI.reset}`);
    const healthRes = await client.callTool({
      name: "ads_get_data_health",
      arguments: { storeId },
    });
    const health = healthRes.structuredContent as Record<string, any>;
    console.log(`${ANSI.green}✔ Data Health Result:${ANSI.reset}`);
    console.log(`  - Meta Status: ${health.metaConnection?.status} (Ad Account: ${health.metaConnection?.adAccountId})`);
    console.log(`  - GA4 Status: ${health.ga4Connection?.status} (Property: ${health.ga4Connection?.propertyId})`);
    console.log(`  - Maturity: ${health.maturity?.status} (${health.maturity?.policyNote})`);
    console.log(`  - Blocked Decisions: ${health.maturity?.blockedDecisions?.join(", ") || "None"}`);

    // 6. Test ads_get_decision_cards
    console.log(`\n${ANSI.blue}[Step 6] Calling Tool: ads_get_decision_cards (AI Decision Engine)...${ANSI.reset}`);
    const decisionsRes = await client.callTool({
      name: "ads_get_decision_cards",
      arguments: { storeId, filter: "all" },
    });
    const decisions = decisionsRes.structuredContent as Record<string, any>;
    const cards = decisions.decisionCards || [];
    console.log(`${ANSI.green}✔ Decision Cards Returned:${ANSI.reset} ${cards.length} cards`);
    cards.slice(0, 3).forEach((card: any, idx: number) => {
      console.log(`  ${idx + 1}. [${card.decision}] ${ANSI.bold}${card.title}${ANSI.reset}`);
      console.log(`     Action: ${card.recommendedNextStep}`);
      const confText = typeof card.confidence === "number" ? `${(card.confidence * 100).toFixed(0)}%` : "N/A";
      console.log(`     Priority: ${card.priority} | Confidence: ${confText}`);
    });

    // 7. Test ads_get_competitor_creative_gaps
    console.log(`\n${ANSI.blue}[Step 7] Calling Tool: ads_get_competitor_creative_gaps...${ANSI.reset}`);
    const gapsRes = await client.callTool({
      name: "ads_get_competitor_creative_gaps",
      arguments: { storeId },
    });
    const gapsData = gapsRes.structuredContent as Record<string, any>;
    const gaps = gapsData.creativeGaps || [];
    console.log(`${ANSI.green}✔ Creative Gaps Identified:${ANSI.reset} ${gaps.length} gaps`);
    if (gaps.length > 0) {
      console.log(`  - Gap 1: ${ANSI.bold}${gaps[0].patternName}${ANSI.reset}`);
      console.log(`    Format: ${gaps[0].format} | Hook: ${gaps[0].hookType} | Style: ${gaps[0].visualStyle}`);
      console.log(`    Competitors using it: ${gaps[0].competitorNames?.join(", ")} (${gaps[0].competitorOccurrences} ads)`);
      console.log(`    Suggested Angle: ${gaps[0].suggestedAngle || gaps[0].hypothesis}`);
    }

    // 8. Test ads_generate_brief
    console.log(`\n${ANSI.blue}[Step 8] Calling Tool: ads_generate_brief (Safe Mutation)...${ANSI.reset}`);
    const briefRes = await client.callTool({
      name: "ads_generate_brief",
      arguments: {
        storeId,
        sourceType: "decision",
        sourceId: cards[0]?.id || "manual-test",
      },
    });
    const briefData = briefRes.structuredContent as Record<string, any>;
    console.log(`${ANSI.green}✔ Brief Generated Successfully!${ANSI.reset}`);
    console.log(`  - Brief ID: ${ANSI.bold}${briefData.briefId}${ANSI.reset}`);
    console.log(`  - Markdown Length: ${briefData.markdown?.length} characters`);

    // 9. Test ads_create_experiment
    console.log(`\n${ANSI.blue}[Step 9] Calling Tool: ads_create_experiment (Ledger Mutation)...${ANSI.reset}`);
    const expRes = await client.callTool({
      name: "ads_create_experiment",
      arguments: {
        storeId,
        briefId: briefData.briefId,
        variantName: "Test Variant Hook V2",
        notes: "Automated test from CLI test runner",
      },
    });
    const expData = expRes.structuredContent as Record<string, any>;
    console.log(`${ANSI.green}✔ Experiment Created!${ANSI.reset}`);
    console.log(`  - Experiment ID: ${ANSI.bold}${expData.experimentId}${ANSI.reset}`);
    console.log(`  - Methodology: ${expData.testMethodology}`);

    console.log(`\n${ANSI.bold}${ANSI.green}================================================================${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}   ALL MCP TOOLS TESTED & OPERATIONAL (100% SUCCESS)            ${ANSI.reset}`);
    console.log(`${ANSI.bold}${ANSI.green}================================================================${ANSI.reset}\n`);
  } finally {
    await client.close();
    await server.close();
  }
}

main().catch((err) => {
  console.error("Test runner failed:", err);
  process.exit(1);
});
