import test from "node:test";
import assert from "node:assert/strict";
import {
  DefaultCompetitorClient,
  classifyHookType,
  classifyVisualStyle,
} from "../ads-intelligence/competitor-client";
import {
  analyzeCreativeGaps,
} from "../ads-intelligence/creative-intelligence";
import { adsIntelligenceService } from "../ads-intelligence/service";
import { adsIntelligenceCache } from "../ads-intelligence/cache";
import type { AdsHierarchyAd, CompetitorAd } from "../ads-intelligence/types";

test("Competitor Classification: accurately classifies Hook Types from copy & headline", () => {
  assert.equal(classifyHookType("Watch this 30s unboxing reaction to her custom gift", "Best gift ever"), "UNBOXING");
  assert.equal(classifyHookType("Tired of boring mass-produced rugs that fade?", "Fix your living room aesthetic"), "PROBLEM_AGITATION");
  assert.equal(classifyHookType("Look at this room transformation before and after", "Before vs After Glow Up"), "BEFORE_AFTER");
  assert.equal(classifyHookType("2 years ago I started tufting in my garage with love", "Our Small Business Story"), "FOUNDER_STORY");
  assert.equal(classifyHookType("Over 4,800 5-star reviews from verified buyers", "Rated 4.9 Stars"), "SOCIAL_PROOF");
  assert.equal(classifyHookType("Weekend flash sale: 30% off personalized runner rugs", "Limited Time Discount"), "DISCOUNT_OFFER");
  assert.equal(classifyHookType("Neutral tone bohemian wool runner rug", "Nordic Living Collection"), "AESTHETIC_SHOWCASE");
});

test("Competitor Classification: detects Visual Style from copy & media type", () => {
  assert.equal(classifyVisualStyle("Raw handheld phone camera unboxing", "VIDEO"), "UGC_LOFI");
  assert.equal(classifyVisualStyle("Studio product photography on white background", "IMAGE"), "STUDIO_PRO");
  assert.equal(classifyVisualStyle("Big red text overlay banner with prices", "IMAGE"), "GRAPHIC_OVERLAY");
  assert.equal(classifyVisualStyle("Hyper-realistic 3D render dimensional mockups", "IMAGE"), "3D_RENDER");
});

test("Competitor Client: harvests calibrated benchmark ads with valid taxonomy & metadata", async () => {
  const client = new DefaultCompetitorClient();
  const pageId = "100064829182341";
  const result = await client.listAds(pageId, { limit: 12 });

  assert.equal(result.pageId, pageId);
  assert.equal(result.pageName, "Tuft & Loom Co.");
  assert.ok(result.ads.length > 0);
  assert.ok(result.usageCostEstimatedUsd > 0);

  // Inspect first ad
  const first = result.ads[0];
  assert.ok(first.archiveAdId.startsWith("arc_meta_"));
  assert.equal(first.status, "ACTIVE");
  assert.ok(first.daysActive >= 2);
  assert.ok(first.copy.length > 20);
  assert.ok(first.headline.length > 5);
  assert.ok(first.thumbnailUrl.startsWith("http"));
  assert.ok(["TEXT_ONLY", "THUMBNAIL_ONLY", "IMAGE_REVIEWED", "VIDEO_AND_AUDIO_REVIEWED"].includes(first.inspectionLevel));
  assert.ok(first.taxonomy.niche.length > 0);
  assert.ok(first.taxonomy.angle.length > 0);

  // Details lookup
  const details = await client.getAdDetails(first.archiveAdId);
  assert.ok(details !== null);
  assert.equal(details?.archiveAdId, first.archiveAdId);

  // Non-existent ID returns null
  const missing = await client.getAdDetails("arc_meta_999999999_9999");
  assert.equal(missing, null);
});

test("Creative Intelligence: detects Creative Gaps when own store has not tested a competitor pattern", () => {
  const competitorAds: CompetitorAd[] = [
    {
      archiveAdId: "arc_1",
      pageId: "comp_1",
      pageName: "Tuft & Loom Co.",
      status: "ACTIVE",
      startDate: "2026-09-01",
      firstSeen: "2026-09-01T00:00:00Z",
      lastSeen: "2026-10-04T00:00:00Z",
      daysActive: 33,
      copy: "Unboxing reaction to custom anniversary gift",
      headline: "TikTok viral unboxing",
      cta: "Shop Now",
      landingUrl: "https://example.com/unboxing",
      mediaType: "VIDEO",
      mediaUrls: ["https://example.com/v1.mp4"],
      thumbnailUrl: "https://example.com/thumb1.jpg",
      provider: "calibrated_benchmark",
      retrievedAt: "2026-10-04T00:00:00Z",
      costEstimatedUsd: 0.0003,
      inspectionLevel: "VIDEO_AND_AUDIO_REVIEWED",
      taxonomy: {
        niche: "Custom Rugs",
        format: "VIDEO",
        hookType: "UNBOXING",
        angle: "Emotional Reaction",
        visualStyle: "UGC_LOFI",
        offer: "15% off",
      },
    },
    {
      archiveAdId: "arc_2",
      pageId: "comp_2",
      pageName: "LuminaCraft Studio",
      status: "ACTIVE",
      startDate: "2026-09-10",
      firstSeen: "2026-09-10T00:00:00Z",
      lastSeen: "2026-10-04T00:00:00Z",
      daysActive: 24,
      copy: "Over 4,800 5-star customer reviews and feedback",
      headline: "5 Star Rated Rugs",
      cta: "Shop Now",
      landingUrl: "https://example.com/reviews",
      mediaType: "VIDEO",
      mediaUrls: ["https://example.com/v2.mp4"],
      thumbnailUrl: "https://example.com/thumb2.jpg",
      provider: "calibrated_benchmark",
      retrievedAt: "2026-10-04T00:00:00Z",
      costEstimatedUsd: 0.0003,
      inspectionLevel: "VIDEO_AND_AUDIO_REVIEWED",
      taxonomy: {
        niche: "Custom Rugs",
        format: "VIDEO",
        hookType: "SOCIAL_PROOF",
        angle: "Social Proof Durability",
        visualStyle: "UGC_LOFI",
        offer: "Free Shipping",
      },
    },
  ];

  // Own store only runs Aesthetic Catalog ads
  const ownAds: AdsHierarchyAd[] = [
    {
      id: "own_ad_1",
      name: "Chillgen - Aesthetic Room Runner - Catalog Shot",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      spend: "50.00",
      impressions: "1000",
      linkClicks: "15",
      linkCtr: "1.50",
      purchases: "1",
      purchaseValue: "60.00",
      cpa: "50.00",
      roas: "1.20",
    },
  ];

  const analysis = analyzeCreativeGaps({
    competitorAds,
    ownAds,
    storeNiche: "Custom Tufted Rugs",
  });

  // Verify creative gaps
  assert.ok(analysis.creativeGaps.length >= 2);
  const unboxingGap = analysis.creativeGaps.find(g => g.hookType === "UNBOXING");
  assert.ok(unboxingGap !== undefined);
  assert.equal(unboxingGap?.ownStatus, "UNTESTED");
  assert.ok(unboxingGap?.suggestedBrief.hookAngle.length > 10);
  assert.ok(unboxingGap?.suggestedBrief.storyboardIdea.length > 20);
  assert.ok(unboxingGap?.suggestedBrief.callToAction.length > 0);
  assert.ok(unboxingGap?.limitation.includes("Facebook Ad Library"));

  // Verify winning hooks
  assert.ok(analysis.topWinningHooks.length >= 2);
  assert.ok(analysis.topWinningHooks[0].avgDaysActive >= analysis.topWinningHooks[1].avgDaysActive);

  // Verify format distribution
  assert.ok(analysis.formatDistribution.length > 0);
  const totalPct = analysis.formatDistribution.reduce((acc, f) => acc + f.percentage, 0);
  assert.ok(totalPct >= 99 && totalPct <= 101);
});

test("Ads Intelligence Service: getCompetitorIntelligence returns cached full report with filters", async () => {
  adsIntelligenceCache.invalidate("chillgen");

  const report = await adsIntelligenceService.getCompetitorIntelligence("chillgen", true);

  assert.equal(report.storeId, "chillgen");
  assert.ok(report.watchlist.length >= 3);
  assert.ok(report.totalAds >= 12);
  assert.ok(report.activeAds >= 10);
  assert.ok(report.syncCostEstimatedUsd > 0);
  assert.equal(report.monthlyCostCapUsd, 65.0);
  assert.ok(report.transparencyDisclaimer.includes("Facebook Ad Library"));
  assert.ok(report.creativeGaps.length > 0);
  assert.ok(report.topWinningHooks.length > 0);
  assert.ok(report.formatDistribution.length > 0);
  assert.equal(report.fromCache, false);

  // Test In-Memory Cache on second call
  const cachedReport = await adsIntelligenceService.getCompetitorIntelligence("chillgen", false);
  assert.equal(cachedReport.fromCache, true);

  // Test Filtering by format
  const videoOnly = await adsIntelligenceService.getCompetitorIntelligence("chillgen", false, {
    format: "VIDEO",
  });
  assert.ok(videoOnly.ads.length > 0);
  for (const ad of videoOnly.ads) {
    assert.equal(ad.mediaType, "VIDEO");
  }

  // Test Filtering by Hook Type
  const unboxingOnly = await adsIntelligenceService.getCompetitorIntelligence("chillgen", false, {
    hookType: "UNBOXING",
  });
  assert.ok(unboxingOnly.ads.length > 0);
  for (const ad of unboxingOnly.ads) {
    assert.equal(ad.taxonomy.hookType, "UNBOXING");
  }
});
