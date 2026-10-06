import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod/v4";

import { verifiedCompetitorAdSchema, adCollectionSchema } from "./competitor-ad-research";
import { getAdsGatewayStore } from "./gateway-connection";
import { prefetchCompetitorMedia } from "./media-proxy";

const storeIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/);
const domainSchema = z.string().max(253).regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/);
const textSchema = z.string().min(1).max(4000);
const evidenceSchema = z.object({
  url: z.string().max(2048).url().refine(value => /^https?:\/\//.test(value), "HTTP source required"),
  note: textSchema,
});
const candidateSchema = z.object({
  name: z.string().min(1).max(200), domain: domainSchema, productGroup: z.string().min(1).max(200),
  score: z.number().int().min(65).max(100),
  scoreBreakdown: z.object({
    product: z.number().int().min(30).max(40), customizationModel: z.number().int().min(0).max(20),
    audience: z.number().int().min(0).max(15), price: z.number().int().min(0).max(15), themes: z.number().int().min(0).max(10),
  }),
  confidence: z.enum(["high", "medium"]), evidence: z.array(evidenceSchema).min(1).max(20),
  adStatus: textSchema,
}).refine(candidate => Object.values(candidate.scoreBreakdown).reduce((sum, value) => sum + value, 0) === candidate.score, "Score breakdown must match total");

export const competitorResearchSchema = z.object({
  storeId: storeIdSchema, shopDomain: domainSchema, storeDomain: domainSchema,
  observedAt: z.iso.datetime({ offset: true }),
  scope: z.object({ products: z.array(textSchema).min(1).max(30), market: textSchema, currency: textSchema, excluded: z.array(textSchema).max(30) }),
  selected: z.array(candidateSchema).max(10),
  verifiedAds: z.array(verifiedCompetitorAdSchema).max(30).optional(),
  adCollection: adCollectionSchema.optional(),
  adInsights: z.array(z.object({ title: textSchema, observation: textSchema, sourceAdIds: z.array(z.string().regex(/^\d+$/)).min(1).max(30), originalTest: textSchema })).max(10).optional(),
  limitations: z.array(textSchema).max(50),
  websiteDerivedHypotheses: z.array(z.object({ title: textSchema, basis: textSchema, hypothesis: textSchema })).max(10),
}).refine(report => (report.verifiedAds ?? []).every(entry => report.selected.some(candidate => candidate.domain === entry.brandDomain)), "Ad brand must be in the selected shortlist")
  .refine(report => new Set((report.verifiedAds ?? []).map(entry => entry.ad.archiveAdId)).size === (report.verifiedAds ?? []).length, "Duplicate ad IDs")
  .refine(report => (report.adCollection ?? []).every(entry => report.selected.some(candidate => candidate.domain === entry.brandDomain)), "Collection brand must be selected")
  .refine(report => (report.verifiedAds ?? []).every(entry => report.adCollection?.some(collection => collection.brandDomain === entry.brandDomain && collection.status === "verified_ads" && collection.pageIds.includes(entry.ad.pageId))), "Verified ads require matching advertiser collection evidence")
  .refine(report => (report.adCollection ?? []).every(collection => collection.matchedCount === (report.verifiedAds ?? []).filter(entry => entry.brandDomain === collection.brandDomain).length && collection.matchedCount <= collection.retrievedCount), "Collection counts must match saved ads")
  .refine(report => (report.adInsights ?? []).every(insight => insight.sourceAdIds.every(id => report.verifiedAds?.some(entry => entry.ad.archiveAdId === id))), "Insights must cite saved verified ads")
  .refine(report => new Set(report.selected.map(candidate => candidate.domain.replace(/^www\./, ""))).size === report.selected.length, "Duplicate brands")
  .refine(report => !report.selected.some(candidate => candidate.domain.replace(/^www\./, "") === report.storeDomain.replace(/^www\./, "")), "Own store cannot be a competitor");

export type CompetitorResearch = z.infer<typeof competitorResearchSchema>;
export interface CompetitorResearchRepository {
  get(storeId: string): Promise<CompetitorResearch | null>;
  save(input: unknown): Promise<CompetitorResearch>;
}

export function createCompetitorResearchRepository(root = resolve(".runtime/ads-intelligence/competitor-research")): CompetitorResearchRepository {
  // Serialize writes in this gateway; atomic rename protects readers from partial JSON.
  let pending: Promise<unknown> = Promise.resolve();
  const pathFor = (storeId: string) => resolve(root, `${storeIdSchema.parse(storeId)}.json`);
  const get = async (storeId: string): Promise<CompetitorResearch | null> => {
    try {
      const report = competitorResearchSchema.parse(JSON.parse(await readFile(pathFor(storeId), "utf8")));
      if (report.storeId !== storeId) throw new Error("RESEARCH_STORE_MISMATCH");
      return report;
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  };
  return {
    get,
    async save(input) {
      const report = competitorResearchSchema.parse(input);
      const operation = pending.then(async () => {
        const previous = await get(report.storeId);
        if (previous && Date.parse(previous.observedAt) > Date.parse(report.observedAt)) throw new Error("RESEARCH_STALE");
        await mkdir(root, { recursive: true });
        const target = pathFor(report.storeId);
        const temporary = `${target}.${randomUUID()}.tmp`;
        try {
          await writeFile(temporary, JSON.stringify(report, null, 2), { mode: 0o600 });
          await rename(temporary, target);
        } finally { await rm(temporary, { force: true }); }
        return report;
      });
      pending = operation.catch(() => undefined);
      return operation;
    },
  };
}

export const competitorResearchRepository = createCompetitorResearchRepository();

export async function readCompetitorResearch(storeId: string): Promise<CompetitorResearch | null> {
  const store = await getAdsGatewayStore(storeId);
  const report = await competitorResearchRepository.get(storeId);
  if (report && report.shopDomain !== store.shopDomain) throw new Error("RESEARCH_STORE_MISMATCH");
  return report;
}

export async function publishCompetitorResearch(input: unknown): Promise<CompetitorResearch> {
  const report = competitorResearchSchema.parse(input);
  const store = await getAdsGatewayStore(report.storeId);
  if (report.shopDomain !== store.shopDomain) throw new Error("RESEARCH_STORE_MISMATCH");
  const saved = await competitorResearchRepository.save(report);

  // Background prefetch all verified media so it is cached and never expires
  try {
    const mediaUrls: string[] = [];
    for (const entry of saved.verifiedAds ?? []) {
      mediaUrls.push(...entry.ad.mediaUrls);
      if (entry.ad.thumbnailUrl) mediaUrls.push(entry.ad.thumbnailUrl);
      for (const card of entry.ad.cards ?? []) {
        if (card.mediaUrl) mediaUrls.push(card.mediaUrl);
      }
    }
    if (mediaUrls.length > 0) {
      prefetchCompetitorMedia(mediaUrls);
    }
  } catch {
    // Ignore prefetch errors in background
  }

  return saved;
}
