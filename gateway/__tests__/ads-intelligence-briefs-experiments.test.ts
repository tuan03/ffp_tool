import "./ads-test-sources";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { generateBriefFromDecision, generateBriefFromCreativeGap, formatBriefMarkdown } from "../ads-intelligence/brief-generator";
import { ExperimentMemoryRepository } from "../ads-intelligence/experiment-repository";
import { adsIntelligenceService } from "../ads-intelligence/service";
import { handleAdsIntelligenceHttpRequest } from "../ads-intelligence/http-handler";
import type {
  DecisionCard,
  CreativeGap,
  StoreAdsProfile,
  AdsHierarchyAd,
  CreativeBrief,
  AdsExperiment,
} from "../ads-intelligence/types";

const mockStoreProfile: StoreAdsProfile = {
  storeId: "chillgen",
  mode: "test",
  marketCountries: ["US"],
  reportingCurrency: "USD",
  meta: {
    accountIds: ["act_1010295448281555"],
    accountTimezone: "America/Los_Angeles",
    apiVersion: "v26.0",
    purchaseActionType: "omni_purchase",
  },
  ga4: {
    propertyId: "555699138",
    propertyTimezone: "America/Los_Angeles",
  },
  shopify: {
    shopDomain: "chillgen.myshopify.com",
    apiVersion: "2026-01",
  },
  competitors: {
    primaryProvider: "scrapecreators",
    monthlyCostCapUsd: 65.0,
    watchlist: ["100064829182341"],
  },
  business: {
    targetCpa: 25.0,
    targetContributionPerOrder: 15.0,
    breakEvenRoas: 1.6,
    breakEvenCpa: 35.0,
  },
  rules: {
    policyVersion: "2026.03.1",
    maturityDays: 7,
    allowFinancialRecommendations: true,
  },
  budgets: {
    totalDailyAuthorizedCap: 150.0,
    experimentAuthorizedCap: 50.0,
  },
  actions: {
    externalWritesEnabled: false,
    approvalRequired: true,
  },
};

const mockDecisionCard: DecisionCard = {
  id: "dec_chillgen_test_creative_01",
  storeId: "chillgen",
  entity: {
    type: "ad",
    id: "23851029481023",
    name: "Ad 01 - Lumbar Cushion - Studio Showcase",
  },
  decision: "TEST_CREATIVE",
  priority: "HIGH",
  confidence: "HIGH",
  title: "Creative Fatigue: Ad 01 Link CTR < 1.5% with high impressions",
  summary: "High frequency and dying click-through indicate audience creative fatigue.",
  observations: [
    { metric: "linkCtr", current: "1.12%", benchmark: ">= 1.50%", unit: "%" },
    { metric: "impressions", current: 15420, benchmark: ">= 2000", unit: "impressions" },
  ],
  hypotheses: [
    "Studio b-roll has lost novelty and fails to stop the scroll in first 3s.",
    "Target audience needs an acute pain-point agitation hook.",
  ],
  recommendedNextStep: "Produce 3 new hook angles (Problem Agitation, Social Proof, Pattern Interrupt).",
  blockedActions: ["Do NOT increase budget until new creative variants are deployed."],
  reviewTrigger: "Review after 14 days or 2,500 impressions on new variants.",
};

const mockCreativeGap: CreativeGap = {
  id: "gap_problem_agitation_ugc_lofi",
  patternName: "Problem Agitation with UGC Lo-fi",
  hookType: "PROBLEM_AGITATION",
  visualStyle: "UGC_LOFI",
  format: "VIDEO",
  competitorOccurrences: 4,
  competitorNames: ["ErgoComfort Living", "BackCare Essentials"],
  sampleCompetitorAds: [
    {
      pageName: "ErgoComfort Living",
      archiveAdId: "100064829182341_01",
      daysActive: 38,
      headline: "Stop Ruining Your Lower Spine At Your Desk",
    },
  ],
  ownStatus: "UNTESTED",
  whyTestNext: "Competitor angle ran 38 days continuously with zero internal Chillgen coverage.",
  limitation: "Public Ad Library data does not disclose competitor ROAS.",
  suggestedBrief: {
    hookAngle: "Why your $500 ergonomic chair still gives you lower back pain by 3 PM",
    storyboardIdea: "Selfie video showing bad posture vs instant relief when sliding cushion in.",
    recommendedFormat: "Vertical 9:16 Video (25-30s)",
    callToAction: "Shop Risk-Free 30 Days",
  },
};

const mockControlAd: AdsHierarchyAd = {
  id: "23851029481023",
  name: "Ad 01 - Lumbar Cushion - Studio Showcase",
  status: "ACTIVE",
  effectiveStatus: "ACTIVE",
  spend: "142.50",
  impressions: "15420",
  linkClicks: "173",
  linkCtr: "1.12%",
  purchases: "5",
  purchaseValue: "249.95",
  cpa: "28.50",
  roas: "1.75",
};

describe("FFP Ads Intelligence — Phase 4: Strategy Briefs, Test Plans & Experiment Memory (FFP-ADS-015)", () => {
  it("generateBriefFromDecision: creates compliant 12-section brief isolating hook variable and setting guardrails", () => {
    const brief = generateBriefFromDecision("chillgen", mockDecisionCard, mockStoreProfile, mockControlAd);

    assert.ok(brief.briefId.startsWith("brief_chillgen_"));
    assert.equal(brief.storeId, "chillgen");
    assert.equal(brief.status, "DRAFT");
    assert.ok(brief.title.includes("Ad 01 - Lumbar Cushion"));

    // Step 15 compliance: isolated variable vs constants
    assert.ok(brief.testVariables.isolatedVariable.includes("First 3 seconds"));
    assert.ok(brief.testVariables.constantVariables.length >= 2);
    assert.equal(brief.testVariables.controlAdId, "23851029481023");

    // Guardrail: derived from target CPA ($25 * 2 = $50)
    assert.equal(brief.guardrails.budgetCapUsd, 50.0);
    assert.ok(brief.guardrails.killCriteria.includes("$50.00"));
    assert.equal(brief.guardrails.reviewWindowDays, 14);

    // Storyboard has at least 4 scenes
    assert.equal(brief.storyboard.length, 4);
    assert.equal(brief.storyboard[0].timestamp, "0:00 - 0:03");
    assert.equal(brief.storyboard[0].isNewIdea, true);

    // References & anti-plagiarism
    assert.ok(brief.references.length > 0);
    assert.ok(brief.references[0].creativeDifference.length > 10);
  });

  it("generateBriefFromCreativeGap: incorporates competitor references and distinct creative difference", () => {
    const brief = generateBriefFromCreativeGap("chillgen", mockCreativeGap, mockStoreProfile, mockControlAd);

    assert.ok(brief.briefId.startsWith("brief_chillgen_"));
    assert.equal(brief.creativeConcept.hookType, "PROBLEM_AGITATION");
    assert.equal(brief.creativeConcept.visualStyle, "UGC_LOFI");
    assert.equal(brief.creativeConcept.format, "VIDEO");

    // References
    assert.equal(brief.references[0].referenceId, "100064829182341_01");
    assert.ok(brief.references[0].whatWeLearned.includes("38 days"));
    assert.ok(brief.references[0].creativeDifference.includes("Distinct custom script"));

    // Copy & CTA
    assert.equal(brief.copyAndCta.ctaButton, "Shop Risk-Free 30 Days");
  });

  it("formatBriefMarkdown: renders valid GitHub markdown with all required sections", () => {
    const brief = generateBriefFromDecision("chillgen", mockDecisionCard, mockStoreProfile, mockControlAd);
    const md = formatBriefMarkdown(brief);

    assert.ok(md.includes("# Creative Production Brief:"));
    assert.ok(md.includes("### 1. Vấn đề & Cơ hội"));
    assert.ok(md.includes("### 5. Storyboard Chi tiết"));
    assert.ok(md.includes("### 7. References & Điểm khác biệt Sáng tạo"));
    assert.ok(md.includes("### 8. Thiết kế Biến số Thử nghiệm"));
    assert.ok(md.includes("### 9. Guardrails & Điều kiện Dừng"));
    assert.ok(md.includes("0:00 - 0:03"));
  });

  it("ExperimentMemoryRepository: manages brief lifecycle and experiment outcome tracking", async () => {
    const repo = new ExperimentMemoryRepository();

    // 1. List seeded briefs & experiments
    const briefs = await repo.listBriefs("chillgen");
    assert.ok(briefs.length >= 1);

    const experiments = await repo.listExperiments("chillgen");
    assert.ok(experiments.length >= 2);

    // Verify completed seed experiment with confounders and learning
    const pastExp = experiments.find((e) => e.status === "COMPLETED");
    assert.ok(pastExp);
    assert.equal(pastExp.design.type, "OBSERVATIONAL"); // Step 15 requirement
    assert.ok(pastExp.results);
    assert.equal(pastExp.results.confidence, "HIGH");
    assert.ok(pastExp.results.confoundersNoted.length >= 1);
    assert.equal(pastExp.learning?.verdict, "WIN");

    // 2. Save new brief and update status
    const newBrief = generateBriefFromDecision("chillgen", mockDecisionCard, mockStoreProfile, mockControlAd);
    await repo.saveBrief(newBrief);

    const fetchedBrief = await repo.getBriefById(newBrief.briefId);
    assert.equal(fetchedBrief?.title, newBrief.title);

    const updatedBrief = await repo.updateBriefStatus(newBrief.briefId, "APPROVED", "Approved by Head of Growth");
    assert.equal(updatedBrief?.status, "APPROVED");
    assert.equal(updatedBrief?.reviewerNotes, "Approved by Head of Growth");

    // 3. Save new experiment and record outcome
    const newExp: AdsExperiment = {
      id: `exp_test_${Date.now()}`,
      storeId: "chillgen",
      title: "Test UGC Hook Agitation",
      hypothesis: "Will lift CTR above 2.0%",
      linkedBriefId: newBrief.briefId,
      design: {
        type: "OBSERVATIONAL",
        objective: "CONVERSIONS",
        control: {
          entityType: "ad",
          entityId: mockControlAd.id,
          entityName: mockControlAd.name,
          baselineSpend: 142.5,
          baselineMetricValue: 28.5,
          baselinePurchases: 5,
        },
        variants: [
          {
            entityType: "ad",
            entityName: "Variant UGC 01",
            briefId: newBrief.briefId,
            description: "UGC hook testing",
          },
        ],
        isolatedVariable: "First 3s Hook",
        allocationMechanism: "Meta Dynamic Budget Allocation",
      },
      measurement: {
        primaryMetric: "cpa",
        metricBasis: "META_PURCHASE",
        minimumSampleSize: 8,
        mde: 15,
        maturityRequirement: "MATURE",
      },
      limits: {
        budgetCapUsd: 50.0,
        maxLossGuardrailUsd: 40.0,
        reviewWindowDays: 14,
      },
      timeline: {
        startDate: new Date().toISOString(),
      },
      status: "RUNNING",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await repo.saveExperiment(newExp);
    const fetchedExp = await repo.getExperimentById(newExp.id);
    assert.equal(fetchedExp?.status, "RUNNING");

    // 4. Update outcome with learning
    const completedExp = await repo.updateExperimentOutcome(newExp.id, {
      status: "COMPLETED",
      results: {
        controlSpend: 142.5,
        variantSpend: 150.0,
        controlOutcomes: 5,
        variantOutcomes: 8,
        controlMetricValue: 28.5,
        variantMetricValue: 18.75,
        deltaPercent: -34.2,
        confidence: "HIGH",
        confoundersNoted: ["Meta shifted 75% traffic to variant after initial purchase spike"],
        reviewer: "Senior Media Buyer",
      },
      learning: {
        verdict: "WIN",
        conclusion: "Variant lowered CPA by 34.2% with solid margin contribution.",
        scope: "Chillgen lumbar cushions in US market during Q3/Q4.",
        nextRecommendedTest: "Scale budget by 20% every 48 hours within safety cap.",
      },
    });

    assert.equal(completedExp?.status, "COMPLETED");
    assert.equal(completedExp?.results?.deltaPercent, -34.2);
    assert.equal(completedExp?.learning?.verdict, "WIN");
  });

  it("AdsIntelligenceService: creates experiment directly from brief and updates brief status to READY_FOR_TEST", async () => {
    const briefs = await adsIntelligenceService.getBriefs("chillgen");
    assert.ok(briefs.length > 0);
    const firstBrief = briefs[0];

    const exp = await adsIntelligenceService.createExperimentFromBrief("chillgen", firstBrief.briefId, {
      title: "Observational Test for Chillgen Hook",
      budgetCapUsd: 75.0,
      reviewWindowDays: 14,
    });

    assert.ok(exp.id.startsWith("exp_chillgen_"));
    assert.equal(exp.linkedBriefId, firstBrief.briefId);
    assert.equal(exp.limits.budgetCapUsd, 75.0);
    assert.equal(exp.design.type, "OBSERVATIONAL");

    const updatedBrief = await adsIntelligenceService.getBrief(firstBrief.briefId);
    assert.equal(updatedBrief?.status, "READY_FOR_TEST");
  });

  it("HTTP Endpoints: /briefs and /experiments respond correctly via handleAdsIntelligenceHttpRequest", async () => {
    // 1. GET /api/ads-intelligence/briefs
    const reqBriefs = new http.IncomingMessage(null as any);
    reqBriefs.url = "/api/ads-intelligence/briefs?storeId=chillgen";
    reqBriefs.method = "GET";

    let briefsStatusCode = 0;
    let briefsBody = "";
    const resBriefs = {
      statusCode: 200,
      setHeader() {},
      end(data?: string) {
        briefsStatusCode = 200;
        briefsBody = data ?? "";
      },
    } as unknown as http.ServerResponse;

    const handledBriefs = await handleAdsIntelligenceHttpRequest(reqBriefs, resBriefs);
    assert.equal(handledBriefs, true);
    assert.equal(briefsStatusCode, 200);
    const parsedBriefs = JSON.parse(briefsBody);
    assert.ok(Array.isArray(parsedBriefs));
    assert.ok(parsedBriefs.length > 0);

    // 2. GET /api/ads-intelligence/briefs/:id/markdown
    const firstBriefId = parsedBriefs[0].briefId;
    const reqMd = new http.IncomingMessage(null as any);
    reqMd.url = `/api/ads-intelligence/briefs/${firstBriefId}/markdown`;
    reqMd.method = "GET";

    let mdStatusCode = 0;
    let mdBody = "";
    const resMd = {
      statusCode: 200,
      setHeader() {},
      end(data?: string) {
        mdStatusCode = 200;
        mdBody = data ?? "";
      },
    } as unknown as http.ServerResponse;

    const handledMd = await handleAdsIntelligenceHttpRequest(reqMd, resMd);
    assert.equal(handledMd, true);
    assert.equal(mdStatusCode, 200);
    assert.ok(mdBody.includes("# Creative Production Brief:"));

    // 3. GET /api/ads-intelligence/experiments
    const reqExp = new http.IncomingMessage(null as any);
    reqExp.url = "/api/ads-intelligence/experiments?storeId=chillgen";
    reqExp.method = "GET";

    let expStatusCode = 0;
    let expBody = "";
    const resExp = {
      statusCode: 200,
      setHeader() {},
      end(data?: string) {
        expStatusCode = 200;
        expBody = data ?? "";
      },
    } as unknown as http.ServerResponse;


    const handledExp = await handleAdsIntelligenceHttpRequest(reqExp, resExp);
    assert.equal(handledExp, true);
    assert.equal(expStatusCode, 200);
    const parsedExp = JSON.parse(expBody);
    assert.ok(Array.isArray(parsedExp));
    assert.ok(parsedExp.length >= 2);
  });
});
