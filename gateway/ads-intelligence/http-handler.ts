/**
 * FFP Ads Intelligence — Gateway HTTP Request Handler
 * Handles `/api/ads-intelligence/*` endpoints for React client and MCP tools.
 */
import type http from "node:http";
import { adsIntelligenceService } from "./service";
import { adsIntelligenceCache } from "./cache";

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
  res.end(JSON.stringify(data));
}

export async function handleAdsIntelligenceHttpRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<boolean> {
  const reqUrl = req.url ?? "/";
  if (!reqUrl.startsWith("/api/ads-intelligence/")) {
    return false;
  }

  const parsedUrl = new URL(reqUrl, "http://localhost");
  const pathname = parsedUrl.pathname;
  const storeId = parsedUrl.searchParams.get("storeId") || "chillgen";
  const forceRefresh = parsedUrl.searchParams.get("refresh") === "true";

  try {
    if (pathname === "/api/ads-intelligence/summary" && req.method === "GET") {
      const summary = await adsIntelligenceService.getStoreSummary(storeId, forceRefresh);
      sendJson(res, 200, summary, {
        "x-ads-cache": summary.fromCache ? "HIT" : "MISS",
      });
      return true;
    }

    if (pathname === "/api/ads-intelligence/campaigns" && req.method === "GET") {
      const campaigns = await adsIntelligenceService.getCampaignHierarchy(storeId, forceRefresh);
      sendJson(res, 200, campaigns);
      return true;
    }

    if (pathname === "/api/ads-intelligence/health" && req.method === "GET") {
      const health = await adsIntelligenceService.getDataHealth(storeId, forceRefresh);
      sendJson(res, 200, health);
      return true;
    }

    if (pathname === "/api/ads-intelligence/reconciliation" && req.method === "GET") {
      const reconciliation = await adsIntelligenceService.getReconciliationReport(storeId, forceRefresh);
      sendJson(res, 200, reconciliation, {
        "x-ads-cache": reconciliation.fromCache ? "HIT" : "MISS",
      });
      return true;
    }

    if (pathname === "/api/ads-intelligence/competitors" && req.method === "GET") {
      const competitors = await adsIntelligenceService.getCompetitorAds(storeId, forceRefresh);
      sendJson(res, 200, competitors);
      return true;
    }

    if (pathname === "/api/ads-intelligence/sync" && req.method === "POST") {
      const syncResult = await adsIntelligenceService.syncNow(storeId);
      sendJson(res, 200, syncResult);
      return true;
    }

    if (pathname === "/api/ads-intelligence/decisions" && (req.method === "GET" || req.method === "POST")) {
      const isCached = !forceRefresh && adsIntelligenceCache.get(`${storeId}:decisions`) !== null;
      const decisions = await adsIntelligenceService.getDecisionCards(storeId, forceRefresh);
      sendJson(res, 200, decisions, {
        "x-ads-cache": isCached ? "HIT" : "MISS",
      });
      return true;
    }

    if (
      (pathname === "/api/ads-intelligence/ai-analyze" || pathname === "/api/ads-intelligence/ai-report") &&
      (req.method === "POST" || req.method === "GET")
    ) {
      const aiReport = await adsIntelligenceService.getAiStrategicReport(storeId, forceRefresh);
      sendJson(res, 200, aiReport, {
        "x-ads-cache": aiReport.fromCache ? "HIT" : "MISS",
      });
      return true;
    }

    sendJson(res, 404, {
      error: { code: "NOT_FOUND", message: `Ads Intelligence endpoint not found: ${pathname}` },
    });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Internal Server Error";
    console.error("[Ads Intelligence] Request handler error:", error);
    sendJson(res, 500, {
      error: { code: "ADS_INTELLIGENCE_ERROR", message },
    });
    return true;
  }
}
