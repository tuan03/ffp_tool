import type { AmazonAsinChecker, AmazonAsinPreflightResult } from "../types";

export function normalizeAmazonAsins(sources: readonly string[]): string[] {
  const asins = new Set<string>();
  for (const source of sources) {
    const value = source.trim();
    if (/^[a-z0-9]{10}$/i.test(value)) {
      asins.add(value.toUpperCase());
      continue;
    }
    let url: URL;
    try {
      url = new URL(value.includes("://") ? value : `https://${value}`);
    } catch {
      throw new Error(`Link Amazon không hợp lệ: ${value}`);
    }
    if (!/(^|\.)amazon\.[a-z.]+$/i.test(url.hostname)) {
      throw new Error(`Link Amazon không hợp lệ: ${value}`);
    }
    const match = url.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d|product)\/([a-z0-9]{10})(?:\/|$)/i)
      ?? value.match(/(?<![a-z0-9])([a-z0-9]{10})(?![a-z0-9])/i);
    if (!match) {
      throw new Error(`Không tìm thấy ASIN trong link: ${value}`);
    }
    asins.add(match[1].toUpperCase());
  }
  return [...asins];
}

export async function runAfterAmazonAsinPreflight(
  sources: readonly string[],
  storeId: string,
  checkAmazonAsins: AmazonAsinChecker,
  startJob: () => Promise<void>,
): Promise<AmazonAsinPreflightResult> {
  const asins = normalizeAmazonAsins(sources);
  const result = await checkAmazonAsins(storeId, asins);
  if (result.ready && result.matches.length === 0) {
    await startJob();
  }
  return result;
}
