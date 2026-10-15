import { normalizeAmazonAsins } from "./amazon-asin-preflight";

interface CrawlerInputAnalysis {
  readonly lineCount: number;
  readonly validCount: number;
  readonly duplicateCount: number;
  readonly invalidEntries: readonly { readonly line: number; readonly value: string }[];
  readonly deduplicatedText: string;
}

export function analyzeCrawlerInput(text: string): CrawlerInputAnalysis {
  const asins = new Set<string>();
  const retainedSources: string[] = [];
  const invalidEntries: { line: number; value: string }[] = [];
  let lineCount = 0;
  let duplicateCount = 0;
  text.split(/\r?\n/).forEach((source, index) => {
    const value = source.trim();
    if (!value) return;
    lineCount++;
    try {
      const asin = normalizeAmazonAsins([value])[0];
      if (!asin) throw new Error("Missing ASIN");
      if (asins.has(asin)) { duplicateCount++; return; }
      asins.add(asin);
    } catch {
      invalidEntries.push({ line: index + 1, value });
    }
    // Deduplication is explicit and never discards an invalid row for the operator.
    retainedSources.push(value);
  });
  return { lineCount, validCount: asins.size, duplicateCount, invalidEntries, deduplicatedText: retainedSources.join("\n") };
}
