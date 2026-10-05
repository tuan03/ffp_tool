import type { AmazonCrawlerClientSummary } from "../types";

export type CrawlerClientPresence = {
  readonly label: string;
  readonly tone: "online" | "warning" | "offline" | "unknown";
};

export function filterConnectedCrawlerClients<T extends Pick<AmazonCrawlerClientSummary, "isConnected" | "status">>(
  clients: readonly T[],
): T[] {
  return clients.filter((client) => client.isConnected && client.status !== "offline");
}

export function getCrawlerClientPresence(
  isConnected: boolean,
  status: string,
  isSnapshotStale: boolean,
): CrawlerClientPresence {
  if (isSnapshotStale) return { label: "chưa xác minh", tone: "unknown" };
  if (!isConnected || status === "offline") return { label: "offline", tone: "offline" };
  if (status === "waiting_captcha" || status === "degraded") return { label: status, tone: "warning" };
  return { label: status, tone: "online" };
}
