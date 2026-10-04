/**
 * FFP Ads Intelligence — Gateway HTTP Request Handler
 * Handles `/api/ads-intelligence/*` endpoints for React client and MCP tools.
 */
import type http from "node:http";
import { adsIntelligenceService } from "./service";
import { adsIntelligenceCache } from "./cache";
import { formatBriefMarkdown } from "./brief-generator";
import type { BriefStatus, ExperimentResults, ExperimentLearning, ExperimentStatus, AdsExperiment, CreativeBrief } from "./types";

function sendJson(res: http.ServerResponse, statusCode: number, data: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) {
    res.setHeader(k, v);
  }
  res.end(JSON.stringify(data));
}

function sendText(res: http.ServerResponse, statusCode: number, text: string, contentType = "text/plain; charset=utf-8"): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", contentType);
  res.end(text);
}


async function readJsonBody<T>(req: http.IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString("utf-8");
      if (body.length > 2 * 1024 * 1024) {
        reject(new Error("Request body exceeds 2MB limit"));
      }
    });
    req.on("end", () => {
      if (!body.trim()) {
        resolve({} as T);
        return;
      }
      try {
        resolve(JSON.parse(body) as T);
      } catch {
        reject(new Error("Malformed JSON in request body"));
      }
    });
    req.on("error", reject);
  });
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
      const pageId = parsedUrl.searchParams.get("pageId") || undefined;
      const format = parsedUrl.searchParams.get("format") || undefined;
      const hookType = parsedUrl.searchParams.get("hookType") || undefined;
      const intelligence = await adsIntelligenceService.getCompetitorIntelligence(storeId, forceRefresh, {
        pageId,
        format,
        hookType,
      });
      sendJson(res, 200, intelligence, {
        "x-ads-cache": intelligence.fromCache ? "HIT" : "MISS",
      });
      return true;
    }

    if (pathname === "/api/ads-intelligence/creative-gaps" && req.method === "GET") {
      const intelligence = await adsIntelligenceService.getCompetitorIntelligence(storeId, forceRefresh);
      sendJson(res, 200, {
        storeId,
        creativeGaps: intelligence.creativeGaps,
        topWinningHooks: intelligence.topWinningHooks,
        formatDistribution: intelligence.formatDistribution,
      }, {
        "x-ads-cache": intelligence.fromCache ? "HIT" : "MISS",
      });
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

    // --- Briefs Endpoints (Ticket FFP-ADS-015) ---
    if (pathname === "/api/ads-intelligence/briefs" && req.method === "GET") {
      const briefs = await adsIntelligenceService.getBriefs(storeId);
      sendJson(res, 200, briefs);
      return true;
    }

    if (pathname === "/api/ads-intelligence/briefs/generate" && req.method === "POST") {
      const body = await readJsonBody<{
        storeId?: string;
        source: "decision" | "gap" | "custom";
        sourceId?: string;
        brief?: CreativeBrief;
      }>(req);
      const targetStore = body.storeId || storeId;

      let createdBrief: CreativeBrief;
      if (body.source === "decision" && body.sourceId) {
        createdBrief = await adsIntelligenceService.createBriefFromDecision(targetStore, body.sourceId);
      } else if (body.source === "gap" && body.sourceId) {
        createdBrief = await adsIntelligenceService.createBriefFromGap(targetStore, body.sourceId);
      } else if (body.source === "custom" && body.brief) {
        createdBrief = body.brief;
        await adsIntelligenceService.saveBrief(createdBrief);
      } else {
        sendJson(res, 400, {
          error: { code: "BAD_REQUEST", message: "Missing valid source ('decision', 'gap', or 'custom') or sourceId/brief" },
        });
        return true;
      }

      sendJson(res, 201, createdBrief);
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/briefs/") && pathname.endsWith("/markdown") && req.method === "GET") {
      const briefId = pathname.slice("/api/ads-intelligence/briefs/".length, -"/markdown".length);
      const brief = await adsIntelligenceService.getBrief(briefId);
      if (!brief) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Brief '${briefId}' not found` } });
        return true;
      }
      sendText(res, 200, formatBriefMarkdown(brief), "text/markdown; charset=utf-8");
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/briefs/") && pathname.endsWith("/status") && req.method === "PUT") {
      const briefId = pathname.slice("/api/ads-intelligence/briefs/".length, -"/status".length);
      const body = await readJsonBody<{ status: BriefStatus; notes?: string }>(req);
      const updated = await adsIntelligenceService.updateBriefStatus(briefId, body.status, body.notes);
      if (!updated) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Brief '${briefId}' not found` } });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/briefs/") && req.method === "GET") {
      const briefId = pathname.slice("/api/ads-intelligence/briefs/".length);
      const brief = await adsIntelligenceService.getBrief(briefId);
      if (!brief) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Brief '${briefId}' not found` } });
        return true;
      }
      sendJson(res, 200, brief);
      return true;
    }

    // --- Experiments Endpoints (Ticket FFP-ADS-015) ---
    if (pathname === "/api/ads-intelligence/experiments" && req.method === "GET") {
      const experiments = await adsIntelligenceService.getExperiments(storeId);
      sendJson(res, 200, experiments);
      return true;
    }

    if (pathname === "/api/ads-intelligence/experiments" && req.method === "POST") {
      const body = await readJsonBody<{
        storeId?: string;
        briefId?: string;
        experiment?: AdsExperiment;
        customOptions?: { title?: string; budgetCapUsd?: number; reviewWindowDays?: number };
      }>(req);
      const targetStore = body.storeId || storeId;

      if (body.briefId) {
        const exp = await adsIntelligenceService.createExperimentFromBrief(targetStore, body.briefId, body.customOptions);
        sendJson(res, 201, exp);
        return true;
      } else if (body.experiment) {
        await adsIntelligenceService.saveExperiment(body.experiment);
        sendJson(res, 201, body.experiment);
        return true;
      } else {
        sendJson(res, 400, {
          error: { code: "BAD_REQUEST", message: "Provide either briefId or full experiment payload" },
        });
        return true;
      }
    }

    if (pathname.startsWith("/api/ads-intelligence/experiments/") && pathname.endsWith("/outcome") && req.method === "PUT") {
      const expId = pathname.slice("/api/ads-intelligence/experiments/".length, -"/outcome".length);
      const body = await readJsonBody<{
        results?: ExperimentResults;
        learning?: ExperimentLearning;
        status?: ExperimentStatus;
        statusReason?: string;
      }>(req);
      const updated = await adsIntelligenceService.updateExperimentOutcome(expId, body);
      if (!updated) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Experiment '${expId}' not found` } });
        return true;
      }
      sendJson(res, 200, updated);
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/experiments/") && req.method === "GET") {
      const expId = pathname.slice("/api/ads-intelligence/experiments/".length);
      const exp = await adsIntelligenceService.getExperiment(expId);
      if (!exp) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Experiment '${expId}' not found` } });
        return true;
      }
      sendJson(res, 200, exp);
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
