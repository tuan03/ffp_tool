import test from "node:test";
import assert from "node:assert/strict";
import { DecisionEngine } from "../ads-intelligence/decision-engine";
import { AiStrategicAnalyst } from "../ads-intelligence/ai-analyst";
import { handleAdsIntelligenceHttpRequest } from "../ads-intelligence/http-handler";
import { adsIntelligenceService } from "../ads-intelligence/service";
import { loadStoreAdsProfile } from "../ads-intelligence/store-profile";
import type {
  AdsHierarchyCampaign,
  AdsReconciliationReport,
  AdsStoreSummary,
  StoreAdsProfile,
} from "../ads-intelligence/types";
import http from "node:http";

function createMockSummary(overrides: Partial<AdsStoreSummary> = {}): AdsStoreSummary {
  return {
    storeId: "chillgen",
    accountId: "act_1010295448281555",
    accountName: "Chillgen Store",
    currency: "USD",
    timezone: "America/Los_Angeles",
    periodStart: "2026-09-26",
    periodEnd: "2026-10-02",
    maturity: "PROVISIONAL",
    spend: "500.00",
    impressions: "20000",
    clicks: "800",
    linkClicks: "700",
    linkCtr: "3.50%",
    cpc: "0.71",
    cpm: "25.00",
    lpv: "600",
    atc: "50",
    checkout: "30",
    purchases: "20",
    purchaseValue: "1200.00",
    cpa: "25.00",
    roas: "2.40",
    warnings: [],
    ...overrides,
  };
}

function createMockReconciliation(overrides: Partial<AdsReconciliationReport> = {}): AdsReconciliationReport {
  return {
    storeId: "chillgen",
    periodStart: "2026-09-26",
    periodEnd: "2026-10-02",
    meta: {
      spend: "500.00",
      impressions: "20000",
      linkClicks: "700",
      purchases: "20",
      purchaseValue: "1200.00",
      cpa: "25.00",
      roas: "2.40",
    },
    ga4: {
      status: "CONNECTED",
      sessions: 600,
      ecommercePurchases: 20,
      purchaseRevenue: 1200,
      clickToSessionDropPct: "14.3%",
    },
    shopify: {
      status: "CONNECTED",
      totalOrders: 20,
      grossSales: "1200.00",
      totalRefunds: "0.00",
      netSales: "1200.00",
      averageOrderValue: "60.00",
      mer: "2.40",
      blendedCpa: "25.00",
      source: "mock-shopify",
    },
    gaps: {
      purchaseDiscrepancy: 0,
      revenueDiscrepancy: "0.00",
      clickDropPct: "14.3%",
      notes: [],
    },
    ...overrides,
  };
}

function createMockCampaigns(): readonly AdsHierarchyCampaign[] {
  return [
    {
      id: "camp-001",
      name: "Prospecting Campaign US",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      objective: "OUTCOME_SALES",
      budgetType: "CAMPAIGN",
      dailyBudget: "100.00",
      spend: "350.00",
      purchases: "15",
      purchaseValue: "1050.00",
      cpa: "23.33",
      roas: "3.00",
      adsets: [
        {
          id: "adset-001",
          name: "Broad Interests Home",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudget: null,
          optimizationGoal: "OFFSITE_CONVERSIONS",
          spend: "350.00",
          purchases: "15",
          cpa: "23.33",
          roas: "3.00",
          ads: [
            {
              id: "ad-star",
              name: "Winning Video Ad",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "150.00",
              impressions: "6000",
              linkClicks: "220",
              linkCtr: "3.67%",
              purchases: "10",
              purchaseValue: "700.00",
              cpa: "15.00",
              roas: "4.67",
            },
            {
              id: "ad-burned",
              name: "High Spend No Purchase Ad",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "65.00",
              impressions: "2800",
              linkClicks: "60",
              linkCtr: "2.14%",
              purchases: "0",
              purchaseValue: "0.00",
              cpa: null,
              roas: null,
            },
            {
              id: "ad-fatigued",
              name: "Low CTR Hook Fatigue Ad",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "40.00",
              impressions: "3500",
              linkClicks: "35",
              linkCtr: "1.00%",
              purchases: "1",
              purchaseValue: "60.00",
              cpa: "40.00",
              roas: "1.50",
            },
          ],
        },
      ],
    },
  ];
}

test("DecisionEngine Rule 1: Maturity Gate tags WAIT and blocks automatic scale on PROVISIONAL data", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary({ maturity: "PROVISIONAL" });

  const cards = engine.evaluate({
    summary,
    campaigns: [],
    reconciliation: createMockReconciliation(),
    profile,
  });

  const waitCard = cards.find((c) => c.decision === "WAIT");
  assert.ok(waitCard, "Expected a WAIT decision card");
  assert.equal(waitCard.entity.type, "store");
  assert.equal(waitCard.priority, "HIGH");
  assert.ok(waitCard.blockedActions.includes("AUTOMATIC_BUDGET_CHANGE"));
  assert.ok(waitCard.blockedActions.includes("SCALE_CAMPAIGN_BUDGET"));
  assert.ok(waitCard.observations.some((obs) => obs.metric === "maturity_status"));
});

test("DecisionEngine Rule 2: High Burn / Zero Purchase flags PAUSE_CANDIDATE when spend > 2x Target CPA", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen"); // Target CPA = 18 USD, Burn threshold = 36 USD
  const summary = createMockSummary();
  const campaigns = createMockCampaigns();

  const cards = engine.evaluate({
    summary,
    campaigns,
    reconciliation: createMockReconciliation(),
    profile,
  });

  const pauseCard = cards.find((c) => c.entity.id === "ad-burned");
  assert.ok(pauseCard, "Expected a PAUSE_CANDIDATE card for ad-burned");
  assert.equal(pauseCard.decision, "PAUSE_CANDIDATE");
  assert.equal(pauseCard.priority, "HIGH");
  assert.ok(pauseCard.blockedActions.includes("SCALE_BUDGET"));
  assert.ok(pauseCard.observations.some((obs) => obs.metric === "spend" && obs.current === "$65.00"));
  assert.ok(pauseCard.observations.some((obs) => obs.metric === "purchases" && obs.current === 0));
});

test("DecisionEngine Rule 3: Star Performer flags SCALE_CANDIDATE when ROAS >= 2.50 and purchases >= 3", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary();
  const campaigns = createMockCampaigns();

  const cards = engine.evaluate({
    summary,
    campaigns,
    reconciliation: createMockReconciliation(),
    profile,
  });

  const starCard = cards.find((c) => c.entity.id === "ad-star");
  assert.ok(starCard, "Expected a SCALE_CANDIDATE card for ad-star");
  assert.equal(starCard.decision, "SCALE_CANDIDATE");
  assert.equal(starCard.priority, "HIGH");
  assert.ok(starCard.observations.some((obs) => obs.metric === "meta_roas"));
  assert.ok(starCard.observations.some((obs) => obs.metric === "purchases" && obs.current === 10));
});

test("DecisionEngine Rule 4: Creative Fatigue flags TEST_CREATIVE when Link CTR < 1.5% with high impressions", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary();
  const campaigns = createMockCampaigns();

  const cards = engine.evaluate({
    summary,
    campaigns,
    reconciliation: createMockReconciliation(),
    profile,
  });

  const creativeCard = cards.find((c) => c.entity.id === "ad-fatigued");
  assert.ok(creativeCard, "Expected a TEST_CREATIVE card for ad-fatigued");
  assert.equal(creativeCard.decision, "TEST_CREATIVE");
  assert.equal(creativeCard.priority, "MEDIUM");
  assert.ok(creativeCard.observations.some((obs) => obs.metric === "meta_link_ctr" && obs.current === "1.00%"));
  assert.ok(creativeCard.hypotheses.length >= 2);
});

test("DecisionEngine Rule 5: Landing Page / Tracking Drop flags CHECK_LANDING when click drop > 25%", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary();
  const reconciliation = createMockReconciliation({
    gaps: {
      purchaseDiscrepancy: 0,
      revenueDiscrepancy: "0.00",
      clickDropPct: "32.5%",
      notes: [],
    },
  });

  const cards = engine.evaluate({
    summary,
    campaigns: [],
    reconciliation,
    profile,
  });

  const dropCard = cards.find((c) => c.decision === "CHECK_LANDING");
  assert.ok(dropCard, "Expected a CHECK_LANDING card");
  assert.equal(dropCard.priority, "HIGH");
  assert.ok(dropCard.observations.some((obs) => obs.metric === "click_to_session_drop" && obs.current === "32.5%"));
  assert.ok(dropCard.blockedActions.includes("SCALE_CAMPAIGN_BUDGET"));
});

test("DecisionEngine Rule 6: Checkout Funnel Drop flags CHECK_CHECKOUT when ATC is high but checkout is low", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary({
    atc: "80",
    checkout: "25", // 25 / 80 = 31.25% < 50%
  });

  const cards = engine.evaluate({
    summary,
    campaigns: [],
    reconciliation: createMockReconciliation(),
    profile,
  });

  const checkoutCard = cards.find((c) => c.decision === "CHECK_CHECKOUT");
  assert.ok(checkoutCard, "Expected a CHECK_CHECKOUT card");
  assert.equal(checkoutCard.priority, "HIGH");
  assert.ok(checkoutCard.observations.some((obs) => obs.metric === "atc_to_checkout_drop"));
});

test("DecisionCard Contract Compliance: all cards have standard schema and priority sorting", () => {
  const engine = new DecisionEngine();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary();
  const campaigns = createMockCampaigns();
  const reconciliation = createMockReconciliation({
    gaps: {
      purchaseDiscrepancy: 1,
      revenueDiscrepancy: "50.00",
      clickDropPct: "28.0%",
      notes: [],
    },
  });

  const cards = engine.evaluate({
    summary,
    campaigns,
    reconciliation,
    profile,
  });

  assert.ok(cards.length > 0);
  for (const card of cards) {
    assert.ok(card.id, "card.id must exist");
    assert.ok(card.storeId, "card.storeId must exist");
    assert.ok(card.entity && card.entity.type && card.entity.id, "card.entity must be populated");
    assert.ok(["WAIT", "KEEP", "SCALE_CANDIDATE", "REDUCE_CANDIDATE", "PAUSE_CANDIDATE", "TEST_CREATIVE", "CHECK_LANDING", "CHECK_OFFER", "CHECK_CHECKOUT", "INVESTIGATE_TRACKING"].includes(card.decision));
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(card.priority));
    assert.ok(["HIGH", "MEDIUM", "LOW"].includes(card.confidence));
    assert.ok(card.title && card.title.length > 0);
    assert.ok(card.summary && card.summary.length > 0);
    assert.ok(Array.isArray(card.observations) && card.observations.length > 0);
    assert.ok(Array.isArray(card.hypotheses) && card.hypotheses.length > 0);
    assert.ok(typeof card.recommendedNextStep === "string" && card.recommendedNextStep.length > 0);
    assert.ok(Array.isArray(card.blockedActions));
    assert.ok(typeof card.reviewTrigger === "string" && card.reviewTrigger.length > 0);
  }

  // Check priority sorting: HIGH before MEDIUM before LOW
  const priorityWeight = { HIGH: 3, MEDIUM: 2, LOW: 1 };
  for (let i = 0; i < cards.length - 1; i++) {
    assert.ok(priorityWeight[cards[i].priority] >= priorityWeight[cards[i + 1].priority]);
  }
});

test("AiStrategicAnalyst: produces executive diagnosis, root causes, and 30s creative brief with 3 hooks", async () => {
  const analyst = new AiStrategicAnalyst();
  const profile = loadStoreAdsProfile("chillgen");
  const summary = createMockSummary();
  const reconciliation = createMockReconciliation({
    shopify: {
      status: "CONNECTED",
      totalOrders: 35,
      grossSales: "2100.00",
      totalRefunds: "50.00",
      netSales: "2050.00",
      averageOrderValue: "58.57",
      mer: "4.10",
      blendedCpa: "14.29",
      source: "mock-shopify",
    },
  });
  const campaigns = createMockCampaigns();

  const engine = new DecisionEngine();
  const decisionCards = engine.evaluate({
    summary,
    campaigns,
    reconciliation,
    profile,
  });

  const report = await analyst.generateStrategicReport({
    summary,
    reconciliation,
    campaigns,
    decisionCards,
    profile,
  });

  assert.equal(report.storeId, "chillgen");
  assert.ok(report.generatedAt);
  assert.ok(report.modelUsed);
  assert.equal(report.executiveSummary.overallHealth, "HEALTHY");
  assert.ok(report.executiveSummary.merVerdict.includes("MER"));
  assert.ok(report.executiveSummary.profitLossDiagnosis.length > 0);
  assert.ok(report.rootCauseHypotheses.length > 0);

  // Creative briefs test
  assert.ok(report.creativeBriefs.length > 0);
  const firstBrief = report.creativeBriefs[0];
  assert.ok(firstBrief.angle);
  assert.ok(firstBrief.coreProblem);
  assert.equal(firstBrief.hooks.length, 3);
  assert.ok(firstBrief.visualDirection);
  assert.ok(firstBrief.callToAction);
});

test("HTTP Endpoints: /api/ads-intelligence/decisions and /ai-analyze respond with JSON and headers", async () => {
  // Test GET /api/ads-intelligence/decisions?storeId=chillgen
  const decReq = new http.IncomingMessage(null as any);
  decReq.url = "/api/ads-intelligence/decisions?storeId=chillgen";
  decReq.method = "GET";

  let decStatus = 0;
  let decBody = "";
  const decRes = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk: string) => {
      decBody = chunk;
    },
  } as unknown as http.ServerResponse;

  Object.defineProperty(decRes, "statusCode", {
    set: (v) => { decStatus = v; },
    get: () => decStatus,
  });

  const decHandled = await handleAdsIntelligenceHttpRequest(decReq, decRes);
  assert.equal(decHandled, true);
  assert.equal(decStatus, 200);
  const parsedDec = JSON.parse(decBody);
  assert.ok(Array.isArray(parsedDec));
  assert.ok(parsedDec.length > 0);

  // Test POST /api/ads-intelligence/ai-analyze?storeId=chillgen
  const aiReq = new http.IncomingMessage(null as any);
  aiReq.url = "/api/ads-intelligence/ai-analyze?storeId=chillgen";
  aiReq.method = "POST";

  let aiStatus = 0;
  let aiBody = "";
  const aiRes = {
    statusCode: 200,
    setHeader: () => {},
    end: (chunk: string) => {
      aiBody = chunk;
    },
  } as unknown as http.ServerResponse;

  Object.defineProperty(aiRes, "statusCode", {
    set: (v) => { aiStatus = v; },
    get: () => aiStatus,
  });

  const aiHandled = await handleAdsIntelligenceHttpRequest(aiReq, aiRes);
  assert.equal(aiHandled, true);
  assert.equal(aiStatus, 200);
  const parsedAi = JSON.parse(aiBody);
  assert.equal(parsedAi.storeId, "chillgen");
  assert.ok(parsedAi.executiveSummary);
  assert.ok(Array.isArray(parsedAi.creativeBriefs));
});
