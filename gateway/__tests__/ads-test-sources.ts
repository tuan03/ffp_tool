import { competitorResearchRepository } from "../ads-intelligence/competitor-research";
import { beforeEach, afterEach, mock } from "node:test";
import { adsIntelligenceService } from "../ads-intelligence/service";
import { loadStoreAdsProfile } from "../ads-intelligence/store-profile";
import { adsIntelligenceCache } from "../ads-intelligence/cache";
import { adsExperimentRepository } from "../ads-intelligence/experiment-repository";
import { DefaultCompetitorClient, PAGE_REGISTRY } from "../ads-intelligence/competitor-client";
import { AiStrategicAnalyst } from "../ads-intelligence/ai-analyst";
import type { AdsExperiment, AdsHierarchyCampaign, AdsStoreSummary, AdsReconciliationReport, CreativeBrief, CompetitorAd, CompetitorHookType, CompetitorVisualStyle, CompetitorMediaType, CompetitorCarouselCard, CompetitorInspectionLevel } from "../ads-intelligence/types";

const summary: AdsStoreSummary = {
 storeId: "chillgen", accountId: "act_1010295448281555", accountName: "Fixture", currency: "USD", timezone: "America/Los_Angeles",
 periodStart: "2026-09-26", periodEnd: "2026-10-02", maturity: "PROVISIONAL", spend: "528.60", impressions: "24850", clicks: "940", linkClicks: "820", linkCtr: "3.30%", cpc: "0.64", cpm: "21.27", lpv: "710", atc: "68", checkout: "42", purchases: "29", purchaseValue: "1845.00", cpa: "18.23", roas: "3.49", warnings: [],
};
const reconciliation: AdsReconciliationReport = {
 storeId: "chillgen", periodStart: summary.periodStart, periodEnd: summary.periodEnd,
 meta: { spend: summary.spend, impressions: summary.impressions, linkClicks: summary.linkClicks, purchases: summary.purchases, purchaseValue: summary.purchaseValue, cpa: summary.cpa, roas: summary.roas },
 ga4: {status: "CONNECTED",sessions: 541,ecommercePurchases: 10,purchaseRevenue: 533.5,clickToSessionDropPct: "34.0%"},
 shopify: {status: "CONNECTED",totalOrders: 10,grossSales: "568.50",totalRefunds: "35.00",netSales: "533.50",averageOrderValue: "53.35",mer: "1.01",blendedCpa: "52.86",source: "Test fixture"},
 gaps: {purchaseDiscrepancy: 19,revenueDiscrepancy: "1311.50",clickDropPct: "34.0%",notes: ["Test fixture"]},
};
beforeEach(async () => {
 mock.method(competitorResearchRepository, "get", async () => null);
 adsIntelligenceCache.invalidate();
 mock.method(adsIntelligenceService, "getStoreSummary", async (storeId = "chillgen") => ({...summary,storeId}));
 mock.method(adsIntelligenceService, "getCampaignHierarchy", async (storeId = "chillgen") => fixtureHierarchy(storeId));
 mock.method(adsIntelligenceService, "getReconciliationReport", async (storeId = "chillgen") => ({...reconciliation,storeId}));
 mock.method(adsIntelligenceService, "getDataHealth", async (storeId = "chillgen") => {
   loadStoreAdsProfile(storeId);
   return {metaConnection:{status:"CONNECTED",accountId:summary.accountId,accountName:"Fixture",proxyProfile:"fixture",apiVersion:"v26.0"},ga4Connection:{status:"CONNECTED",propertyId:"fixture",serviceAccount:"fixture"},competitorProvider:{provider:"fixture",status:"UNKNOWN",remainingCredits:null},maturity:{status:"PROVISIONAL",reason:"fixture",blockedDecisions:[]}};
 });
 mock.method(DefaultCompetitorClient.prototype, "listAds", async (pageId: string, options: {limit?: number} = {}) => {
   const ads = generateCalibratedAdsForPage(pageId, options.limit);
   return {pageId,pageName: PAGE_REGISTRY[pageId]?.name ?? "Fixture",ads,totalHarvested:ads.length,provider:"calibrated_benchmark",usageCostEstimatedUsd:ads.length*0.0003};
 });
 mock.method(AiStrategicAnalyst.prototype, "generateStrategicReport", async function(this: AiStrategicAnalyst, input: Parameters<AiStrategicAnalyst["generateStrategicReport"]>[0]) { return this.generateExpertFallback(input); });
 for (const experiment of SEED_EXPERIMENTS) await adsExperimentRepository.saveExperiment(structuredClone(experiment));
 for (const brief of SEED_BRIEFS) await adsExperimentRepository.saveBrief(structuredClone(brief));
});
afterEach(() => { mock.restoreAll(); adsIntelligenceCache.invalidate(); });
function fixtureHierarchy(storeId: string): readonly AdsHierarchyCampaign[] {
    return [
    {
      id: "120252593555340601",
      name: `${storeId}_prospecting_us_sales_v1`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      objective: "OUTCOME_SALES",
      budgetType: "CAMPAIGN",
      dailyBudget: "50.00",
      spend: "345.20",
      purchases: "18",
      purchaseValue: "1180.00",
      cpa: "19.18",
      roas: "3.42",
      adsets: [
        {
          id: "120252593555360601",
          name: "adset_broad_interest_home_wellness",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudget: null,
          optimizationGoal: "OFFSITE_CONVERSIONS",
          spend: "262.70",
          purchases: "13",
          cpa: "20.21",
          roas: "3.31",
          ads: [
            {
              id: "120252593555350601",
              name: "ad_video_unboxing_sleep_quality",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "162.20",
              impressions: "9200",
              linkClicks: "320",
              linkCtr: "3.48%",
              purchases: "10",
              purchaseValue: "680.00",
              cpa: "16.22",
              roas: "4.19",
            },
            {
              id: "120252593555350602",
              name: "ad_image_lifestyle_weighted_cozy",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "100.50",
              impressions: "7450",
              linkClicks: "90",
              linkCtr: "1.21%",
              purchases: "3",
              purchaseValue: "190.00",
              cpa: "33.50",
              roas: "1.89",
            },
          ],
        },
        {
          id: "120252593555360602",
          name: "adset_lookalike_purchasers_1pct",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudget: null,
          optimizationGoal: "OFFSITE_CONVERSIONS",
          spend: "82.50",
          purchases: "5",
          cpa: "16.50",
          roas: "3.76",
          ads: [
            {
              id: "120252593555350603",
              name: "ad_carousel_colors_cozy_aesthetic",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "82.50",
              impressions: "4200",
              linkClicks: "170",
              linkCtr: "4.05%",
              purchases: "5",
              purchaseValue: "310.00",
              cpa: "16.50",
              roas: "3.76",
            },
          ],
        },
      ],
    },
    {
      id: "120252593555340602",
      name: `${storeId}_retargeting_cart_abandoners_v1`,
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      objective: "OUTCOME_SALES",
      budgetType: "CAMPAIGN",
      dailyBudget: "25.00",
      spend: "138.40",
      purchases: "10",
      purchaseValue: "620.00",
      cpa: "13.84",
      roas: "4.48",
      adsets: [
        {
          id: "120252593555360603",
          name: "adset_retargeting_viewed_content_7d",
          status: "ACTIVE",
          effectiveStatus: "ACTIVE",
          dailyBudget: null,
          optimizationGoal: "OFFSITE_CONVERSIONS",
          spend: "138.40",
          purchases: "10",
          cpa: "13.84",
          roas: "4.48",
          ads: [
            {
              id: "120252593555350604",
              name: "ad_social_proof_testimonial_ugc",
              status: "ACTIVE",
              effectiveStatus: "ACTIVE",
              spend: "138.40",
              impressions: "6200",
              linkClicks: "210",
              linkCtr: "3.39%",
              purchases: "10",
              purchaseValue: "620.00",
              cpa: "13.84",
              roas: "4.48",
            },
          ],
        },
      ],
    },
  ];
}

function generateCalibratedAdsForPage(pageId: string, limit = 20): readonly CompetitorAd[] {
  const info = PAGE_REGISTRY[pageId] ?? {
    name: `Competitor Studio ${pageId.slice(-4)}`,
    niche: "Personalized Home & Lifestyle Products",
  };

  const now = Date.parse("2026-10-04T12:00:00Z");
  const DAY_MS = 86400000;

  // Real-world creative templates benchmarked from live Facebook Ad Library
  const templates = [
    {
      format: "VIDEO" as CompetitorMediaType,
      headline: "The custom rug everyone on TikTok is obsessing over ✨",
      copy: "We turned our client's favorite album cover into a plush, handmade tufted rug! Watch this 30s unboxing reaction — she had no idea her boyfriend ordered this for their anniversary. Tap Shop Now to customize yours with 100% premium wool and non-slip backing.",
      cta: "Shop Now",
      hookType: "UNBOXING" as CompetitorHookType,
      visualStyle: "UGC_LOFI" as CompetitorVisualStyle,
      daysActive: 38,
      inspectionLevel: "VIDEO_AND_AUDIO_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1200&q=80",
      ],
      angle: "Emotional Couple Gift Unboxing Reaction",
      offer: "Free Shipping on Orders Over $75",
    },
    {
      format: "CAROUSEL" as CompetitorMediaType,
      headline: "4 Reasons Why Generic Rugs Ruin Your Living Room Aesthetic",
      copy: "Tired of boring beige mass-produced carpets? Swipe left to see how 5 real customer homes completely transformed their space with custom personalized colors and sizes. Made to order in 5-7 business days.",
      cta: "Learn More",
      hookType: "PROBLEM_AGITATION" as CompetitorHookType,
      visualStyle: "GRAPHIC_OVERLAY" as CompetitorVisualStyle,
      daysActive: 29,
      inspectionLevel: "IMAGE_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=1200&q=80",
        "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80",
      ],
      cards: [
        { headline: "Step 1: Upload Your Design", body: "Upload your pet, logo, or favorite art piece", mediaUrl: "https://images.unsplash.com/photo-1513694203232-719a280e022f?auto=format&fit=crop&w=600&q=80" },
        { headline: "Step 2: Choose Exact Dimensions", body: "From bedside 2ft up to grand living room 6ft rugs", mediaUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=600&q=80" },
        { headline: "Step 3: Hand-Tufted Delivery", body: "Arrives at your doorstep safely packaged in 7 days", mediaUrl: "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=600&q=80" },
      ],
      angle: "Living Room Aesthetic Transformation & Custom Dimensions",
      offer: "15% Off Your First Custom Order with code CUSTOM15",
    },
    {
      format: "VIDEO" as CompetitorMediaType,
      headline: "Over 4,800 5-Star Reviews ⭐⭐⭐⭐⭐",
      copy: "“I honestly didn't think the colors would look this vibrant in person, but it completely blew my expectations away.” Hear directly from our verified buyers about durability, washing machine resilience, and why everyone asks where they got it.",
      cta: "Shop Now",
      hookType: "SOCIAL_PROOF" as CompetitorHookType,
      visualStyle: "UGC_LOFI" as CompetitorVisualStyle,
      daysActive: 21,
      inspectionLevel: "VIDEO_AND_AUDIO_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1586023492125-27b2c045efd7?auto=format&fit=crop&w=1200&q=80",
      ],
      angle: "Verified Customer Social Proof & Washing Durability Test",
      offer: "Satisfaction Guaranteed or 100% Full Refund",
    },
    {
      format: "IMAGE" as CompetitorMediaType,
      headline: "Before & After: Look at this Bedroom Transformation!",
      copy: "Before: Plain dull hardwood floor. After: Vibrant retro wavy runner rug that ties the whole room together! Tap below to explore 50+ pre-designed templates or design your own in 60 seconds.",
      cta: "Explore Now",
      hookType: "BEFORE_AFTER" as CompetitorHookType,
      visualStyle: "STUDIO_PRO" as CompetitorVisualStyle,
      daysActive: 17,
      inspectionLevel: "IMAGE_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1555041469-a586c61ea9bc?auto=format&fit=crop&w=1200&q=80",
      ],
      angle: "Direct Before & After Visual Contrast",
      offer: "Buy 1 Get 1 30% Off Mix & Match",
    },
    {
      format: "VIDEO" as CompetitorMediaType,
      headline: "Behind The Scenes: How we craft your rug from scratch 🧶",
      copy: "Hi, I'm Sarah! 2 years ago I started tufting in my garage. Today my team handcrafts each rug with high-density yarn, precision carving, and double-reinforced edges. Thank you for supporting our small workshop!",
      cta: "Our Story",
      hookType: "FOUNDER_STORY" as CompetitorHookType,
      visualStyle: "UGC_LOFI" as CompetitorVisualStyle,
      daysActive: 12,
      inspectionLevel: "VIDEO_AND_AUDIO_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1579783900882-c0d3dad7b119?auto=format&fit=crop&w=1200&q=80",
      ],
      angle: "Artisan Craftsmanship & Authentic Founder Behind-The-Scenes",
      offer: "Handmade in the USA with 2-Year Warranty",
    },
    {
      format: "IMAGE" as CompetitorMediaType,
      headline: "FLASH SALE: Up to 40% Off Personalized Rugs This Weekend Only ⏰",
      copy: "Upgrade your space before stock runs out! Over 200 bestselling designs are currently marked down. Enter your custom text or initials for free during checkout. Fast tracked shipping across the USA.",
      cta: "Get Offer",
      hookType: "DISCOUNT_OFFER" as CompetitorHookType,
      visualStyle: "GRAPHIC_OVERLAY" as CompetitorVisualStyle,
      daysActive: 4,
      inspectionLevel: "IMAGE_REVIEWED" as CompetitorInspectionLevel,
      thumbnailUrl: "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=600&q=80",
      mediaUrls: [
        "https://images.unsplash.com/photo-1618221195710-dd6b41faaea6?auto=format&fit=crop&w=1200&q=80",
      ],
      angle: "Urgent Flash Sale & Free Personalization Promotion",
      offer: "40% Off Select Runner Rugs + Free Shipping",
    },
  ];

  const ads: CompetitorAd[] = [];
  const count = Math.min(limit, templates.length * 3);

  for (let i = 0; i < count; i++) {
    const t = templates[i % templates.length];
    const adIndex = i + 1;
    const daysActive = Math.max(2, t.daysActive - Math.floor(i / templates.length) * 5);
    const startMs = now - daysActive * DAY_MS;
    const startDate = new Date(startMs).toISOString().split("T")[0];
    const firstSeen = new Date(startMs + 3600000).toISOString();
    const lastSeen = new Date(now - 1800000).toISOString();
    const archiveAdId = `arc_meta_${pageId}_${1000 + adIndex}`;

    ads.push({
      archiveAdId,
      pageId,
      pageName: info.name,
      status: "ACTIVE",
      startDate,
      firstSeen,
      lastSeen,
      daysActive,
      copy: t.copy,
      headline: t.headline,
      cta: t.cta,
      landingUrl: `https://${info.name.toLowerCase().replace(/[^a-z0-9]/g, "")}.com/products/custom-${t.hookType.toLowerCase()}`,
      mediaType: t.format,
      mediaUrls: t.mediaUrls,
      thumbnailUrl: t.thumbnailUrl,
      cards: t.cards,
      provider: "calibrated_benchmark",
      retrievedAt: new Date(now).toISOString(),
      costEstimatedUsd: 0.0003,
      inspectionLevel: t.inspectionLevel,
      taxonomy: {
        niche: info.niche,
        format: t.format,
        hookType: t.hookType,
        angle: t.angle,
        visualStyle: t.visualStyle,
        offer: t.offer,
      },
    });
  }

  return ads.sort((a, b) => b.daysActive - a.daysActive);
}

const SEED_BRIEFS: CreativeBrief[] = [
  {
    briefId: "brief_chillgen_seed_001",
    storeId: "chillgen",
    title: "Test Competitor Angle Gap: Problem Agitation vs Studio Showcase",
    assignee: "Senior Media Buyer",
    status: "READY_FOR_TEST",
    problemOrOpportunity: "Competitor ErgoComfort ran Problem Agitation angle for 38 days; Chillgen had zero UGC agitation ads active.",
    product: {
      name: "Ergonomic Lumbar Cushion Pro",
      targetMarket: "US (Office & Remote Workers)",
      offer: "Buy 1 Get 1 20% OFF + Free Ergonomic Guide",
      landingPageUrl: "https://chillgen.com/products/lumbar-cushion-pro",
      priceUsd: 49.99,
    },
    targetAudience: "Adults 25-45 sitting 6+ hours daily with lower back stiffness.",
    hypothesis: "Demonstrating the 200% spinal pressure point in the first 3s will increase Link CTR from 1.2% to > 2.0% and lower CPA below $22.",
    creativeConcept: {
      hookAngle: "Why your $500 office chair isn't stopping your 3 PM back pain",
      hookType: "PROBLEM_AGITATION",
      visualStyle: "UGC_LOFI",
      format: "VIDEO",
      aspectRatio: "9:16",
      conceptSummary: "Raw smartphone UGC agitation opening with immediate ergonomic cushion demonstration.",
    },
    storyboard: [
      {
        timestamp: "0:00 - 0:03",
        scene: "Hook",
        visualAction: "Creator rubs aching lower back standing up from chair; sound of creaking chair.",
        audioVoiceover: "If you sit like this all day, an expensive chair won't save your lumbar spine.",
        onScreenText: "🚨 3 PM Sitting Mistake",
        isNewIdea: true,
      },
      {
        timestamp: "0:04 - 0:12",
        scene: "Demonstration",
        visualAction: "Slouching spine vs upright alignment with cushion inserted behind lower back.",
        audioVoiceover: "Watch what happens when you support the L4-L5 vertebrae directly.",
        onScreenText: "Instant Spinal Alignment",
        isNewIdea: false,
      },
      {
        timestamp: "0:13 - 0:22",
        scene: "Feature Proof",
        visualAction: "Creator compresses memory foam; shows breathable organic mesh cover.",
        audioVoiceover: "Medical-grade high density foam that never flattens out, guaranteed.",
        onScreenText: "50,000-press resilience core",
        isNewIdea: false,
      },
      {
        timestamp: "0:23 - 0:30",
        scene: "Offer CTA",
        visualAction: "Product bundle with 30-day guarantee badge.",
        audioVoiceover: "Try it risk-free for 30 days. Click below for 20% off your posture reset.",
        onScreenText: "30-Day Risk-Free Trial",
        isNewIdea: false,
      },
    ],
    copyAndCta: {
      primaryText: "Stop letting poor sitting posture drain your energy. The Lumbar Cushion Pro locks your spine into effortless alignment.",
      headline: "The 3-Second Lower Back Relief",
      ctaButton: "Shop Now",
      productTruths: [
        "100% slow-rebound memory foam core",
        "Washable breathable athletic mesh",
        "Dual adjustable buckle straps",
      ],
      brandConstraints: [
        "No medical diagnosis or disease cure claims",
        "Authentic lighting, avoid over-glossy studio aesthetics",
      ],
    },
    references: [
      {
        referenceId: "COMP_AD_100064829182341_01",
        source: "ErgoComfort Living (Active 38 days)",
        whatWeLearned: "Problem agitation hooks retained audience 4x longer than product beauty shots.",
        creativeDifference: "Custom posture comparison animation and proprietary memory core demonstration.",
      },
    ],
    testVariables: {
      isolatedVariable: "First 3s Hook Angle (UGC Agitation vs Studio Static)",
      constantVariables: [
        "Product landing page",
        "Offer terms ($49.99 with 20% bundle discount)",
        "Meta target audience (Broad US 25-54)",
      ],
      controlAdId: "23851029481023",
      controlAdName: "Ad 01 - Lumbar Cushion - Studio Showcase",
    },
    guardrails: {
      primaryMetric: "cpa",
      metricBasis: "META_PURCHASE",
      budgetCapUsd: 60.0,
      killCriteria: "Stop variant if spend reaches $50 with 0 purchases or CTR < 1.0% after 2,000 impressions.",
      reviewWindowDays: 14,
    },
    linkedExperimentId: "exp_chillgen_seed_001",
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-09-28T14:00:00.000Z",
  },
];

const SEED_EXPERIMENTS: AdsExperiment[] = [
  {
    id: "exp_chillgen_seed_001",
    storeId: "chillgen",
    title: "Observational Test: UGC Problem Agitation Hook vs Studio Showcase",
    hypothesis: "Replacing studio b-roll with a UGC lower back agitation hook will lift Link CTR above 2.0% and reduce CPA below $22.",
    linkedBriefId: "brief_chillgen_seed_001",
    design: {
      type: "OBSERVATIONAL",
      objective: "CONVERSIONS",
      control: {
        entityType: "ad",
        entityId: "23851029481023",
        entityName: "Ad 01 - Lumbar Cushion - Studio Showcase",
        baselineSpend: 142.5,
        baselineMetricValue: 28.5,
        baselinePurchases: 5,
      },
      variants: [
        {
          entityType: "ad",
          entityId: "23851029489999",
          entityName: "Ad 02 - Lumbar Cushion - UGC Agitation Hook",
          briefId: "brief_chillgen_seed_001",
          description: "Smartphone UGC video with 200% spinal pressure interrupt hook.",
        },
      ],
      isolatedVariable: "First 3 seconds hook visual & script",
      allocationMechanism: "Meta Dynamic Budget Allocation (Observational distribution across ad set)",
    },
    measurement: {
      primaryMetric: "cpa",
      metricBasis: "META_PURCHASE",
      minimumSampleSize: 8,
      mde: 15,
      maturityRequirement: "MATURE",
    },
    limits: {
      budgetCapUsd: 120.0,
      maxLossGuardrailUsd: 50.0,
      reviewWindowDays: 14,
    },
    timeline: {
      startDate: "2026-09-26T00:00:00.000Z",
      endDate: "2026-10-10T00:00:00.000Z",
    },
    status: "RUNNING",
    createdAt: "2026-09-26T10:00:00.000Z",
    updatedAt: "2026-10-04T08:00:00.000Z",
  },
  {
    id: "exp_chillgen_seed_past_001",
    storeId: "chillgen",
    title: "Observational Test: Unboxing Experience vs Static Product Carousel",
    hypothesis: "Unboxing format creates tactile anticipation that overcomes purchase friction on ergonomic accessories.",
    design: {
      type: "OBSERVATIONAL",
      objective: "CONVERSIONS",
      control: {
        entityType: "ad",
        entityId: "23850918239011",
        entityName: "Ad Static - Product Multi-Angle Carousel",
        baselineSpend: 210.0,
        baselineMetricValue: 29.8,
        baselinePurchases: 7,
      },
      variants: [
        {
          entityType: "ad",
          entityId: "23850918239012",
          entityName: "Ad Video - Fast-Paced Unboxing & First Sit",
          description: "15s snappy unboxing with crisp ASMR packaging sounds.",
        },
      ],
      isolatedVariable: "Creative Format (Snappy Unboxing Video vs Static Carousel)",
      allocationMechanism: "Meta Campaign Budget Optimization",
    },
    measurement: {
      primaryMetric: "cpa",
      metricBasis: "META_PURCHASE",
      minimumSampleSize: 10,
      mde: 15,
      maturityRequirement: "MATURE",
    },
    limits: {
      budgetCapUsd: 250.0,
      maxLossGuardrailUsd: 60.0,
      reviewWindowDays: 14,
    },
    timeline: {
      startDate: "2026-09-01T00:00:00.000Z",
      endDate: "2026-09-15T00:00:00.000Z",
      actualReviewDate: "2026-09-16T15:00:00.000Z",
    },
    status: "COMPLETED",
    results: {
      controlSpend: 210.0,
      variantSpend: 245.0,
      controlOutcomes: 7,
      variantOutcomes: 12,
      controlMetricValue: 30.0,
      variantMetricValue: 20.42,
      deltaPercent: -31.9,
      confidence: "HIGH",
      confoundersNoted: [
        "Meta algorithmic delivery skewed 70% of impression volume to the unboxing video after day 3.",
        "Observational test: not a pure randomized double-blind experiment.",
      ],
      reviewer: "Lead Media Buyer",
    },
    learning: {
      verdict: "WIN",
      conclusion: "Snappy unboxing video cut CPA by 31.9% ($30.00 -> $20.42) with ROAS increasing from 1.95 to 2.74.",
      scope: "Applicable to Chillgen physical ergonomic cushions in US market during non-holiday periods.",
      nextRecommendedTest: "Test Problem Agitation hook vs Unboxing hook in isolated A/B ad sets.",
    },
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-16T15:30:00.000Z",
  },
];
