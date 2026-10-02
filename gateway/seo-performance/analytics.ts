import type { SearchMetrics } from "../../src/modules/seo-performance";

export function aggregateMetrics(rows: readonly { readonly clicks: number; readonly impressions: number; readonly position: number }[]): SearchMetrics | null {
  if (!rows.length) return null;
  const clicks = rows.reduce((sum, row) => sum + row.clicks, 0);
  const impressions = rows.reduce((sum, row) => sum + row.impressions, 0);
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? rows.reduce((sum, row) => sum + row.position * row.impressions, 0) / impressions : 0 };
}
export function opportunityReasons(current: SearchMetrics | null, previous: SearchMetrics | null, peerCtr: number | null): string[] {
  if (!current || current.impressions < 100) return ["INSUFFICIENT_DATA"];
  const reasons: string[] = [];
  if (current.position >= 4 && current.position <= 20) reasons.push("POSITION_OPPORTUNITY");
  if (peerCtr !== null && current.ctr < peerCtr * 0.5) reasons.push("LOW_CTR_VS_PEERS");
  if (previous && previous.impressions >= 100 && previous.clicks >= 10 && current.clicks < previous.clicks * 0.7) reasons.push("CLICKS_DECLINING");
  return reasons;
}
export function shiftDate(day: string, delta: number): string { return new Date(Date.parse(`${day}T12:00:00Z`) + delta * 86_400_000).toISOString().slice(0, 10); }
export function pacificDate(now: Date): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit", day: "2-digit" }).format(now); }
