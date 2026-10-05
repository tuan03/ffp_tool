import { z } from "zod/v4";

import { analyzeCreativeGaps } from "./creative-intelligence";
import type { CompetitorIntelligenceReport } from "./types";

const publicUrl = z.string().max(12000).url().refine(value => /^https?:\/\//.test(value));
const optionalUrl = z.union([publicUrl, z.literal("")]);
const text = z.string().max(20000);

export const verifiedCompetitorAdSchema = z.object({
  brandDomain: z.string().min(1).max(253), productEvidenceUrl: publicUrl,
  qualificationReason: z.string().min(1).max(4000),
  selectedCardIndices: z.array(z.number().int().nonnegative()).min(1).max(30).optional(),
  ad: z.object({
    archiveAdId: z.string().regex(/^\d+$/), pageId: z.string().regex(/^\d+$/), pageName: text,
    status: z.enum(["ACTIVE", "INACTIVE"]), startDate: text, firstSeen: text, lastSeen: text,
    daysActive: z.number().nonnegative(), copy: text, headline: text, cta: text, landingUrl: publicUrl,
    mediaType: z.enum(["VIDEO", "IMAGE", "CAROUSEL"]), mediaUrls: z.array(publicUrl).max(30), thumbnailUrl: optionalUrl,
    cards: z.array(z.object({ headline: text.optional(), body: text.optional(), mediaUrl: optionalUrl.optional(), linkUrl: optionalUrl.optional() })).max(30).optional(),
    provider: z.enum(["scrapecreators", "searchapi", "apify"]), retrievedAt: z.iso.datetime({ offset: true }),
    costEstimatedUsd: z.number().nonnegative(),
    inspectionLevel: z.enum(["TEXT_ONLY", "THUMBNAIL_ONLY", "IMAGE_REVIEWED", "SAMPLED_FRAMES", "VIDEO_AND_AUDIO_REVIEWED"]),
    taxonomy: z.object({
      niche: text, format: z.enum(["VIDEO", "IMAGE", "CAROUSEL"]),
      hookType: z.enum(["UNBOXING", "PROBLEM_AGITATION", "BEFORE_AFTER", "FOUNDER_STORY", "SOCIAL_PROOF", "AESTHETIC_SHOWCASE", "DISCOUNT_OFFER", "UNKNOWN"]),
      angle: text, visualStyle: z.enum(["UGC_LOFI", "STUDIO_PRO", "GRAPHIC_OVERLAY", "3D_RENDER"]), offer: text,
    }),
  }),
}).refine(entry => !entry.selectedCardIndices || (entry.ad.mediaType === "CAROUSEL"
  && new Set(entry.selectedCardIndices).size === entry.selectedCardIndices.length
  && entry.selectedCardIndices.every(index => Boolean(entry.ad.cards?.[index]?.mediaUrl) && Boolean(entry.ad.cards?.[index]?.linkUrl))), "Selected cards must be unique existing carousel cards with media and destinations").refine(entry => {
  const host = new URL(entry.productEvidenceUrl).hostname.replace(/^www\./, "");
  return host === entry.brandDomain.replace(/^www\./, "");
}, "Product evidence must belong to the selected brand");

export const adCollectionSchema = z.array(z.object({
  brandDomain: z.string().min(1).max(253), pageIds: z.array(z.string().regex(/^\d+$/)).max(20),
  identityEvidence: z.array(publicUrl).max(20),
  status: z.enum(["identity_unresolved", "source_error", "fetched_empty", "fetched_no_match", "verified_ads"]),
  retrievedCount: z.number().int().nonnegative(), matchedCount: z.number().int().nonnegative(),
  note: z.string().min(1).max(4000),
})).max(10);

export function createResearchAdReport(input: {
  storeId: string; observedAt: string; verifiedAds: readonly z.infer<typeof verifiedCompetitorAdSchema>[];
  filters?: { pageId?: string; format?: string; hookType?: string };
}): CompetitorIntelligenceReport {
  const ads = input.verifiedAds.map(entry => {
    if (!entry.selectedCardIndices) return entry.ad;
    const cards = entry.selectedCardIndices.flatMap(index => entry.ad.cards?.[index] ? [entry.ad.cards[index]] : []);
    const mediaUrls = cards.flatMap(card => card.mediaUrl ? [card.mediaUrl] : []);
    const label = entry.selectedCardIndices.map(index => `${index + 1}/${entry.ad.cards?.length ?? 0}`).join(", ");
    return { ...entry.ad, headline: cards[0]?.headline || entry.ad.headline, cards, mediaUrls, thumbnailUrl: mediaUrls[0] ?? "", landingUrl: entry.productEvidenceUrl,
      taxonomy: { ...entry.ad.taxonomy, angle: `Chỉ hiển thị thẻ ${label} đã xác minh đúng sản phẩm từ carousel hỗn hợp. ${entry.qualificationReason}` } };
  });
  const pageIds = [...new Set(ads.map(ad => ad.pageId))];
  const filtered = ads.filter(ad => (!input.filters?.pageId || input.filters.pageId === "ALL" || ad.pageId === input.filters.pageId)
    && (!input.filters?.format || input.filters.format === "ALL" || ad.mediaType === input.filters.format)
    && (!input.filters?.hookType || input.filters.hookType === "ALL" || ad.taxonomy.hookType === input.filters.hookType));
  const gapResult = analyzeCreativeGaps({ competitorAds: ads, ownAds: [] });
  return {
    storeId: input.storeId, ads: filtered, totalAds: ads.length, activeAds: ads.filter(ad => ad.status === "ACTIVE").length,
    watchlist: pageIds.map(pageId => ({ pageId, pageName: ads.find(ad => ad.pageId === pageId)?.pageName ?? pageId,
      adCount: ads.filter(ad => ad.pageId === pageId).length, activeAdCount: ads.filter(ad => ad.pageId === pageId && ad.status === "ACTIVE").length })),
    provider: "Nghiên cứu đã xác minh · ScrapeCreators", syncCostEstimatedUsd: 0, monthlyCostCapUsd: 0,
    transparencyDisclaimer: `Mẫu quảng cáo đã lọc theo sản phẩm, lưu ngày ${input.observedAt}. Trạng thái theo nguồn tại lúc thu thập; không phải tổng quảng cáo của thương hiệu. Chi phí đồng bộ chưa tổng hợp. Không có số liệu ROAS/doanh thu đối thủ.`,
    creativeGaps: gapResult.creativeGaps, topWinningHooks: gapResult.topWinningHooks,
    formatDistribution: (["VIDEO", "IMAGE", "CAROUSEL"] as const).map(format => ({ format, count: ads.filter(ad => ad.mediaType === format).length, percentage: ads.length ? ads.filter(ad => ad.mediaType === format).length / ads.length * 100 : 0 })),
    fromCache: true, cachedAt: input.observedAt,
  };
}
