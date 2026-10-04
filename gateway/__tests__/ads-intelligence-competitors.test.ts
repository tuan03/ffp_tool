import test from "node:test";
import assert from "node:assert/strict";
import {
  DefaultCompetitorClient,
  classifyHookType,
  classifyVisualStyle,
  normalizeSnapshotAd,
  PAGE_REGISTRY,
  isAllowedMetaCdnUrl,
  probeMetaCdnMedia,
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

test("Competitor Normalizer: accurately normalizes nested Meta snapshot ads into CompetitorAd", () => {
  const rawMetaAd = {
    ad_archive_id: "715439934763903",
    page_id: "102971998671051",
    page_name: "Macorner",
    is_active: true,
    start_date: 1768204800, // Unix timestamp in seconds
    snapshot: {
      page_name: "Macorner",
      caption: "macorner.co",
      cta_text: "Shop now",
      cta_type: "SHOP_NOW",
      display_format: "VIDEO",
      body: {
        text: "Check the list make everyday fun #couplevibes",
      },
      title: {
        text: "Custom Anniversary Gift for Couple",
      },
      link_url: "https://macorner.co/products/custom-gift",
      videos: [
        {
          video_hd_url: "https://video-iad3-2.xx.fbcdn.net/video.mp4",
          video_preview_image_url: "https://scontent-iad6-1.xx.fbcdn.net/preview.jpg",
        },
      ],
      cards: [
        {
          title: { text: "Card 1: Choose Style" },
          body: { text: "Card 1 Body" },
          original_image_url: "https://scontent-iad6-1.xx.fbcdn.net/card1.jpg",
          link_url: "https://macorner.co/card1",
        },
      ],
    },
  };

  const normalized = normalizeSnapshotAd(rawMetaAd, "102971998671051", "scrapecreators");

  assert.equal(normalized.archiveAdId, "715439934763903");
  assert.equal(normalized.pageId, "102971998671051");
  assert.equal(normalized.pageName, "Macorner");
  assert.equal(normalized.status, "ACTIVE");
  assert.equal(normalized.mediaType, "VIDEO");
  assert.equal(normalized.cta, "Shop now");
  assert.equal(normalized.landingUrl, "https://macorner.co/products/custom-gift");
  assert.ok(normalized.copy.includes("Check the list"));
  assert.equal(normalized.headline, "Custom Anniversary Gift for Couple");
  assert.ok(normalized.mediaUrls.includes("https://video-iad3-2.xx.fbcdn.net/video.mp4"));
  assert.equal(normalized.thumbnailUrl, "https://scontent-iad6-1.xx.fbcdn.net/preview.jpg");
  assert.equal(normalized.cards?.length, 1);
  assert.equal(normalized.cards?.[0].headline, "Card 1: Choose Style");
  assert.equal(normalized.provider, "scrapecreators");
  assert.equal(normalized.inspectionLevel, "VIDEO_AND_AUDIO_REVIEWED");
  assert.ok(PAGE_REGISTRY["102971998671051"] !== undefined);
  assert.ok(PAGE_REGISTRY["188723992071586"] !== undefined);
  assert.ok(PAGE_REGISTRY["100254708876376"] !== undefined);
});

test("Media Range Probe: validates allowed Meta CDN hostnames and rejects unauthorized domains", async () => {
  // Allowed domains
  assert.equal(isAllowedMetaCdnUrl("https://video-iad3-2.xx.fbcdn.net/o1/v/t2/video.mp4"), true);
  assert.equal(isAllowedMetaCdnUrl("https://scontent-iad3-1.xx.fbsbx.com/image.jpg"), true);
  assert.equal(isAllowedMetaCdnUrl("https://fbcdn.net/asset"), true);

  // Rejected non-HTTPS, invalid hosts, credentials
  assert.equal(isAllowedMetaCdnUrl("http://video-iad3-2.xx.fbcdn.net/video.mp4"), false);
  assert.equal(isAllowedMetaCdnUrl("https://evil.com/fbcdn.net"), false);
  assert.equal(isAllowedMetaCdnUrl("https://user:pass@video-iad3-2.xx.fbcdn.net/video.mp4"), false);
  assert.equal(isAllowedMetaCdnUrl("not-a-url"), false);

  // Probe non-allowed domain returns safe error object
  const nonAllowedResult = await probeMetaCdnMedia("https://google.com/test.jpg");
  assert.equal(nonAllowedResult.accessible, false);
  assert.equal(nonAllowedResult.error, "non_meta_https_cdn_url_not_probed");
  assert.equal(nonAllowedResult.bytesRead, 0);

  // Probe error handling on unreachable host without throw
  const unreachableResult = await probeMetaCdnMedia("https://invalid-subdomain-404-test.fbcdn.net/test.jpg", 1000);
  assert.equal(unreachableResult.accessible, false);
  assert.equal(unreachableResult.bytesRead, 0);
  assert.ok(typeof unreachableResult.error === "string");
});

