import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { verifiedCompetitorAdSchema } from "./competitor-ad-research";
import type { CompetitorResearch } from "./competitor-research";
import { writeSpyJson } from "./spy-jobs";

const adSchema = verifiedCompetitorAdSchema.shape.ad;

export async function captureSpyAdSources(directory: string, response: unknown): Promise<void> {
  const visit = async (value: unknown, depth: number): Promise<void> => {
    if (depth > 10 || !value || typeof value !== "object") return;
    const parsed = adSchema.safeParse(value);
    if (parsed.success) {
      await writeSpyJson(join(directory, `source-ad-${parsed.data.archiveAdId}.json`), parsed.data);
      return;
    }
    if (Array.isArray(value)) { for (const child of value) await visit(child, depth + 1); return; }
    for (const [key, child] of Object.entries(value)) {
      if (key === "text" && typeof child === "string") {
        try { await visit(JSON.parse(child), depth + 1); } catch { /* Non-JSON text is not an ad source. */ }
      } else await visit(child, depth + 1);
    }
  };
  await visit(response, 0);
}

export async function preserveSpyAdSources(directory: string, research: CompetitorResearch): Promise<CompetitorResearch> {
  const verifiedAds = await Promise.all((research.verifiedAds ?? []).map(async entry => {
    let text: string;
    try { text = await readFile(join(directory, `source-ad-${entry.ad.archiveAdId}.json`), "utf8"); }
    catch (error) { if (error instanceof Error && "code" in error && error.code === "ENOENT") return entry; throw error; }
    const source = adSchema.parse(JSON.parse(text));
    if (source.pageId !== entry.ad.pageId) throw new Error("SPY_AD_SOURCE_MISMATCH");
    // Signed media URLs and card positions belong to the provider. Never have
    // the language model regenerate them while writing its analysis.
    return { ...entry, ad: { ...source, inspectionLevel: entry.ad.inspectionLevel, taxonomy: entry.ad.taxonomy } };
  }));
  return { ...research, verifiedAds };
}
