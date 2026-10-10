import { normalizeAmazonAsins } from "./amazon-asin-preflight";

interface AsinFilterInput {
  readonly asins: readonly string[];
  readonly duplicateCount: number;
  readonly invalidEntries: readonly { readonly position: number; readonly value: string }[];
}

export function parseAsinFilterInput(text: string): AsinFilterInput {
  const tokens = text.split(/[\s,;]+/).filter(Boolean);
  const uniqueAsins = new Set<string>();
  const invalidEntries: { position: number; value: string }[] = [];
  let duplicateCount = 0;
  tokens.forEach((value, index) => {
    try {
      const asin = normalizeAmazonAsins([value])[0];
      if (!asin) { invalidEntries.push({ position: index + 1, value }); return; }
      if (uniqueAsins.has(asin)) duplicateCount++;
      else uniqueAsins.add(asin);
    } catch {
      invalidEntries.push({ position: index + 1, value });
    }
  });
  return { asins: [...uniqueAsins], duplicateCount, invalidEntries };
}
