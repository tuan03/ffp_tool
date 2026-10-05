import { spyJobs, spyStartSchema } from "./spy-jobs";
import { detectSpyRunners } from "./spy-runner";
import { listAdsGatewayStores } from "./gateway-connection";
import { ShopifyOrdersClient } from "./shopify-client";
/**
 * FFP Ads Intelligence — Gateway HTTP Request Handler
 * Handles `/api/ads-intelligence/*` endpoints for React client and MCP tools.
 */
import type http from "node:http";
import { readCompetitorResearch, publishCompetitorResearch, competitorResearchSchema } from "./competitor-research";
import { adsIntelligenceService } from "./service";
import { adsIntelligenceCache } from "./cache";
import { formatBriefMarkdown } from "./brief-generator";
import { generateAdsOpenApiSpec } from "./openapi-spec";
import { adsGuardedWritesService, type WritePreviewRequest, type WriteApproval } from "./guarded-writes";
import type { BriefStatus, ExperimentResults, ExperimentLearning, ExperimentStatus, AdsExperiment, CreativeBrief, StoreAdsProfile } from "./types";
import { localAiRunner } from "./local-ai-runner";
import { loadStoreAdsProfile, saveStoreAdsProfile, validateStoreAdsProfile } from "./store-profile";
import { mcpUserManager } from "./mcp-users";

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
    if (pathname.startsWith("/api/ads-intelligence/spy/")) {
      try {
        if (pathname === "/api/ads-intelligence/spy/capabilities" && req.method === "GET") {
          sendJson(res, 200, await detectSpyRunners()); return true;
        }
        const explicitStoreId = parsedUrl.searchParams.get("storeId");
        if (!explicitStoreId || !spyStartSchema.shape.storeId.safeParse(explicitStoreId).success) {
          sendJson(res, 400, { error: { code: "SPY_STORE_REQUIRED" } }); return true;
        }
        if (pathname === "/api/ads-intelligence/spy/jobs" && req.method === "GET") {
          sendJson(res, 200, { job: await spyJobs.get(explicitStoreId) }, { "Cache-Control": "no-store" }); return true;
        }
        if (pathname === "/api/ads-intelligence/spy/jobs" && req.method === "POST") {
          const parsed = spyStartSchema.safeParse(await readJsonBody<unknown>(req));
          if (!parsed.success || parsed.data.storeId !== explicitStoreId) {
            sendJson(res, 400, { error: { code: "SPY_REQUEST_INVALID" } }); return true;
          }
          sendJson(res, 202, { job: await spyJobs.start(parsed.data) }); return true;
        }
        const cancelMatch = pathname.match(/^\/api\/ads-intelligence\/spy\/jobs\/([a-f0-9-]{36})\/cancel$/);
        if (cancelMatch?.[1] && req.method === "POST") {
          sendJson(res, 200, { job: await spyJobs.cancel(explicitStoreId, cancelMatch[1]) }); return true;
        }
        sendJson(res, 404, { error: { code: "SPY_JOB_NOT_FOUND" } }); return true;
      } catch (error) {
        const code = error instanceof Error && /^(SPY|ADS)_[A-Z_]+$/.test(error.message) ? error.message : "SPY_REQUEST_FAILED";
        sendJson(res, code === "SPY_ALREADY_RUNNING" ? 409 : 400, { error: { code } }); return true;
      }
    }
    if (pathname === "/api/ads-intelligence/competitor-research") {
      const explicitStoreId = parsedUrl.searchParams.get("storeId");
      if (!explicitStoreId) {
        sendJson(res, 400, { error: { code: "RESEARCH_STORE_REQUIRED" } });
        return true;
      }
      if (req.method === "GET") {
        sendJson(res, 200, { research: await readCompetitorResearch(explicitStoreId) }, { "Cache-Control": "no-store" });
        return true;
      }
      if (req.method === "POST") {
        const parsed = competitorResearchSchema.safeParse(await readJsonBody<unknown>(req));
        if (!parsed.success || parsed.data.storeId !== explicitStoreId) {
          sendJson(res, 400, { error: { code: "RESEARCH_INVALID" } });
          return true;
        }
        sendJson(res, 200, { research: await publishCompetitorResearch(parsed.data) });
        return true;
      }
    }
    if (pathname === "/api/ads-intelligence/stores" && req.method === "GET") {
      sendJson(res, 200, await listAdsGatewayStores());
      return true;
    }

    if (pathname === "/api/ads-intelligence/profile") {
      const explicitStoreId = parsedUrl.searchParams.get("storeId") || storeId;
      if (req.method === "GET") {
        try {
          const profile = loadStoreAdsProfile(explicitStoreId);
          sendJson(res, 200, { configured: true, storeId: explicitStoreId, profile });
        } catch {
          const stores = await listAdsGatewayStores();
          const matched = stores.find((s) => s.storeId === explicitStoreId);
          sendJson(res, 200, {
            configured: false,
            storeId: explicitStoreId,
            shopDomain: matched?.shopDomain || "",
            profile: null,
          });
        }
        return true;
      }

      if (req.method === "POST" || req.method === "PUT") {
        try {
          const body = await readJsonBody<any>(req);
          let profileToSave: StoreAdsProfile;

          if (body.profile && typeof body.profile === "object") {
            profileToSave = validateStoreAdsProfile(body.profile);
          } else if (body.metaAccountId || (body.meta && body.meta.accountIds)) {
            const rawAccount = body.metaAccountId || body.meta?.accountIds?.[0] || "";
            const accountId = String(rawAccount).trim().startsWith("act_")
              ? String(rawAccount).trim()
              : `act_${String(rawAccount).trim()}`;
            const stores = await listAdsGatewayStores();
            const matched = stores.find((s) => s.storeId === explicitStoreId);
            const shopDomain = body.shopDomain || matched?.shopDomain || `${explicitStoreId}.myshopify.com`;
            const targetCpa = typeof body.targetCpa === "number" ? body.targetCpa : Number(body.targetCpa) || 22;
            const breakEvenRoas = typeof body.breakEvenRoas === "number" ? body.breakEvenRoas : Number(body.breakEvenRoas) || 2.2;
            const breakEvenCpa = typeof body.breakEvenCpa === "number" ? body.breakEvenCpa : Number(body.breakEvenCpa) || targetCpa * 1.25;
            const watchlist = Array.isArray(body.watchlist)
              ? body.watchlist.map(String)
              : typeof body.watchlist === "string"
              ? body.watchlist.split(/[\n,]+/).map((s: string) => s.trim()).filter(Boolean)
              : [];

            profileToSave = validateStoreAdsProfile({
              storeId: explicitStoreId,
              mode: "read_only",
              marketCountries: ["US"],
              reportingCurrency: body.reportingCurrency || "USD",
              meta: {
                accountIds: [accountId],
                accountTimezone: body.accountTimezone || "Asia/Manila",
                apiVersion: "v26.0",
                purchaseActionType: "offsite_conversion.fb_pixel_purchase",
                secretRef: "META_ACCESS_TOKEN",
                proxyRef: "META_PROXY_URL",
                attributionPolicyRef: "7d_click_1d_view",
              },
              ga4: {
                propertyId: body.ga4PropertyId ? String(body.ga4PropertyId).trim() : null,
                propertyTimezone: body.ga4PropertyTimezone || "America/Los_Angeles",
                credentialRef: "credentials/ga4-service-account.json",
              },
              shopify: {
                shopDomain,
                apiVersion: "2026-07",
                connectionRef: `shopify_${explicitStoreId}`,
              },
              competitors: {
                primaryProvider: "scrapecreators",
                backupProvider: "searchapi",
                monthlyCostCapUsd: 65.0,
                watchlist,
              },
              business: {
                costProfileRef: `${explicitStoreId}-standard`,
                targetCpa,
                targetContributionPerOrder: 8.0,
                breakEvenRoas,
                breakEvenCpa,
              },
              rules: {
                policyVersion: "2.0",
                maturityDays: 7,
                allowFinancialRecommendations: true,
              },
              budgets: {
                totalDailyAuthorizedCap: 150.0,
                experimentAuthorizedCap: 30.0,
                maxChangePer24hPct: 20.0,
                cooldownHours: 24,
              },
              actions: {
                externalWritesEnabled: false,
                approvalRequired: true,
              },
            });
          } else {
            profileToSave = validateStoreAdsProfile(body);
          }

          saveStoreAdsProfile(explicitStoreId, profileToSave);
          adsIntelligenceCache.invalidate(explicitStoreId);
          sendJson(res, 200, { success: true, storeId: explicitStoreId, profile: profileToSave });
        } catch (err: any) {
          sendJson(res, 400, { error: { code: "PROFILE_INVALID", message: err.message || "Cấu hình profile không hợp lệ." } });
        }
        return true;
      }
    }

    if (pathname === "/api/ads-intelligence/meta/adaccounts" && req.method === "GET") {
      try {
        const accounts = await adsIntelligenceService.listMetaAccounts();
        sendJson(res, 200, { success: true, accounts });
      } catch (err: any) {
        sendJson(res, 500, { success: false, error: err.message || "Không thể lấy danh sách tài khoản Meta." });
      }
      return true;
    }

    if (pathname === "/api/ads-intelligence/profile/test-connection" && req.method === "POST") {
      const body = await readJsonBody<{ accountId: string }>(req);
      const rawAccount = body.accountId || "";
      if (!rawAccount) {
        sendJson(res, 400, { success: false, error: "Vui lòng nhập Meta Ad Account ID" });
        return true;
      }
      try {
        const testResult = await adsIntelligenceService.testMetaAccountConnection(rawAccount);
        sendJson(res, 200, testResult);
      } catch (err: any) {
        sendJson(res, 400, { success: false, error: err.message || "Không thể kết nối tài khoản Meta này." });
      }
      return true;
    }

    if (pathname === "/api/ads-intelligence/profile/test-ga4" && req.method === "POST") {
      const body = await readJsonBody<{ propertyId: string }>(req);
      const rawProp = body.propertyId || "";
      if (!rawProp) {
        sendJson(res, 400, { success: false, error: "Vui lòng nhập GA4 Property ID" });
        return true;
      }
      try {
        const testResult = await adsIntelligenceService.testGa4PropertyConnection(rawProp);
        sendJson(res, 200, testResult);
      } catch (err: any) {
        sendJson(res, 400, { success: false, error: err.message || "Không thể kết nối GA4 Property này." });
      }
      return true;
    }
    if (pathname === "/api/ads-intelligence/shopify" && req.method === "GET") {
      sendJson(res, 200, await new ShopifyOrdersClient().getOrderSummary(storeId));
      return true;
    }
    if ((pathname === "/api/ads-intelligence/openapi.json" || pathname === "/api/ads-intelligence/openapi") && req.method === "GET") {
      const host = req.headers.host || "localhost:3001";
      const protocol = req.headers["x-forwarded-proto"] || "http";
      const baseUrl = `${protocol}://${host}`;
      const spec = generateAdsOpenApiSpec(baseUrl);
      sendJson(res, 200, spec);
      return true;
    }

    if (pathname === "/api/ads-intelligence/mcp/info" && req.method === "GET") {
      sendJson(res, 200, {
        status: "ok",
        server: "ffp-ads-intelligence",
        version: "1.0.0",
        transport: "StreamableHTTP",
        description: "FFP Ads Intelligence MCP Server exposing performance, creative gaps, brief studio, and experiment ledger tools for Codex & AI agents.",
        endpoints: {
          mcpStreamableHttp: "/mcp/ads",
          installerScript: "/mcp/ads/install.ps1",
          installerScriptUnix: "/mcp/ads/install.sh",
          openApiSpec: "/api/ads-intelligence/openapi.json",
        },
        toolsCount: 37,
      });
      return true;
    }

    // --- MCP Multi-User & Audit Endpoints ---
    if (pathname === "/api/ads-intelligence/mcp/users" && req.method === "GET") {
      sendJson(res, 200, { users: mcpUserManager.listUsers() });
      return true;
    }

    if (pathname === "/api/ads-intelligence/mcp/users" && req.method === "POST") {
      const body = await readJsonBody<{
        name?: string;
        allowedStores?: string[];
        role?: "admin" | "media_buyer" | "viewer";
      }>(req);
      if (!body.name || !body.name.trim()) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Tên người dùng không được để trống" } });
        return true;
      }
      const newUser = mcpUserManager.createUser(body.name, body.allowedStores || ["*"], body.role || "media_buyer");
      sendJson(res, 201, { success: true, user: newUser });
      return true;
    }

    if (pathname === "/api/ads-intelligence/mcp/users/revoke" && req.method === "POST") {
      const body = await readJsonBody<{ id: string }>(req);
      if (!body.id) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Missing user id" } });
        return true;
      }
      const ok = mcpUserManager.revokeUser(body.id);
      sendJson(res, 200, { success: ok });
      return true;
    }

    if (pathname === "/api/ads-intelligence/mcp/users" && req.method === "DELETE") {
      const id = parsedUrl.searchParams.get("id");
      if (!id) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Missing user id parameter" } });
        return true;
      }
      const ok = mcpUserManager.deleteUser(id);
      sendJson(res, 200, { success: ok });
      return true;
    }

    if (pathname === "/api/ads-intelligence/mcp/audit" && req.method === "GET") {
      const limitParam = parsedUrl.searchParams.get("limit");
      const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 100, 1), 500) : 100;
      sendJson(res, 200, { auditLogs: mcpUserManager.getAuditLogs(limit) });
      return true;
    }

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

    if (pathname === "/api/ads-intelligence/competitors/search" && req.method === "GET") {
      const query = parsedUrl.searchParams.get("query") || undefined;
      const pageId = parsedUrl.searchParams.get("pageId") || undefined;
      const mediaType = parsedUrl.searchParams.get("mediaType") || undefined;
      const limit = Number(parsedUrl.searchParams.get("limit")) || 15;
      const results = await adsIntelligenceService.searchCompetitorAds(storeId, { query, pageId, mediaType, limit });
      sendJson(res, 200, { storeId, totalFound: results.length, ads: results });
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/competitors/") && req.method === "GET") {
      const archiveAdId = pathname.slice("/api/ads-intelligence/competitors/".length);
      if (archiveAdId && !archiveAdId.includes("/")) {
        const ad = await adsIntelligenceService.getCompetitorAd(storeId, archiveAdId);
        if (!ad) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Competitor ad '${archiveAdId}' not found` } });
          return true;
        }
        sendJson(res, 200, { storeId, ad });
        return true;
      }
    }

    if (pathname === "/api/ads-intelligence/performance/compare" && req.method === "GET") {
      const periodDays = Number(parsedUrl.searchParams.get("days")) || 7;
      const comparison = await adsIntelligenceService.comparePerformance(storeId, periodDays);
      sendJson(res, 200, comparison);
      return true;
    }

    if (pathname === "/api/ads-intelligence/performance/entity" && req.method === "GET") {
      const entityType = (parsedUrl.searchParams.get("type") as "campaign" | "adset" | "ad") || "campaign";
      const entityId = parsedUrl.searchParams.get("id") || "";
      if (!entityId) {
        sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Missing required 'id' query parameter" } });
        return true;
      }
      const evidence = await adsIntelligenceService.getEntityEvidence(storeId, entityType, entityId);
      sendJson(res, 200, evidence);
      return true;
    }

    if (pathname === "/api/ads-intelligence/ga4/report" && req.method === "GET") {
      const recipe = (parsedUrl.searchParams.get("recipe") as any) || "acquisition";
      const startDate = parsedUrl.searchParams.get("startDate") || undefined;
      const endDate = parsedUrl.searchParams.get("endDate") || undefined;
      const limit = Number(parsedUrl.searchParams.get("limit")) || 20;
      const report = await adsIntelligenceService.getGa4Report(storeId, recipe, { startDate, endDate, limit });
      sendJson(res, 200, report);
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

    if (pathname === "/api/ads-intelligence/local-ai/detect" && req.method === "GET") {
      const detection = await localAiRunner.detectRunners();
      sendJson(res, 200, detection);
      return true;
    }

    if (
      (pathname === "/api/ads-intelligence/ai-analyze" || pathname === "/api/ads-intelligence/ai-report") &&
      (req.method === "POST" || req.method === "GET")
    ) {
      let runner = parsedUrl.searchParams.get("runner") as "codex" | "agy" | undefined;
      let model = parsedUrl.searchParams.get("model") || undefined;
      if (req.method === "POST") {
        try {
          const body = await readJsonBody<{ runner?: "codex" | "agy"; model?: string }>(req);
          if (body?.runner) runner = body.runner;
          if (body?.model) model = body.model;
        } catch {
          // ignore empty body
        }
      }

      const aiReport = await adsIntelligenceService.getAiStrategicReport(storeId, forceRefresh, { runner, model });
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

    // --- Guarded Writes Endpoints (Step 21 · FFP-ADS-021) ---
    if (pathname === "/api/ads-intelligence/writes/preview" && req.method === "POST") {
      const body = await readJsonBody<WritePreviewRequest>(req);
      if (!body.storeId || !body.entityId || !body.action) {
        sendJson(res, 400, {
          error: { code: "BAD_REQUEST", message: "Missing required fields: storeId, entityId, action" },
        });
        return true;
      }
      const preview = adsGuardedWritesService.generatePreview(body);
      sendJson(res, 201, preview);
      return true;
    }

    if (pathname.startsWith("/api/ads-intelligence/writes/preview/") && req.method === "GET") {
      const previewId = pathname.slice("/api/ads-intelligence/writes/preview/".length);
      const preview = adsGuardedWritesService.getPreview(previewId);
      if (!preview) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: `Preview '${previewId}' not found` } });
        return true;
      }
      sendJson(res, 200, preview);
      return true;
    }

    if (pathname === "/api/ads-intelligence/writes/approve" && req.method === "POST") {
      const body = await readJsonBody<WriteApproval>(req);
      if (!body.previewId || !body.previewHash || !body.approvedBy) {
        sendJson(res, 400, {
          error: { code: "BAD_REQUEST", message: "Missing required fields: previewId, previewHash, approvedBy" },
        });
        return true;
      }
      try {
        const approved = adsGuardedWritesService.approvePreview(body);
        sendJson(res, 200, approved);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Approval failed";
        sendJson(res, 400, { error: { code: "APPROVAL_REJECTED", message: msg } });
      }
      return true;
    }

    if (pathname === "/api/ads-intelligence/writes/execute" && req.method === "POST") {
      const body = await readJsonBody<{
        previewId: string;
        liveEntityState: { status: string; budget?: number };
      }>(req);
      if (!body.previewId || !body.liveEntityState) {
        sendJson(res, 400, {
          error: { code: "BAD_REQUEST", message: "Missing required fields: previewId, liveEntityState" },
        });
        return true;
      }
      const result = adsGuardedWritesService.executeGuardedWrite(body.previewId, body.liveEntityState);
      const statusCode = result.success ? 200 : result.status === "DENIED_V1_V2" ? 403 : 400;
      sendJson(res, statusCode, result);
      return true;
    }

    if (pathname === "/api/ads-intelligence/writes/audit" && req.method === "GET") {
      const filterStore = parsedUrl.searchParams.get("storeId") || undefined;
      const logs = adsGuardedWritesService.getAuditLog(filterStore);
      sendJson(res, 200, { storeId: filterStore || "all", auditLog: logs, total: logs.length });
      return true;
    }

    sendJson(res, 404, {
      error: { code: "NOT_FOUND", message: `Ads Intelligence endpoint not found: ${pathname}` },
    });
    return true;
  } catch (error: unknown) {
    const rawCode = error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : error instanceof Error ? error.message : "ADS_SOURCE_UNAVAILABLE";
    const code = rawCode.startsWith("Không tìm thấy file cấu hình Store Ads Profile") ? "ADS_PROFILE_NOT_CONFIGURED" : /^[A-Z0-9_]+$/.test(rawCode) ? rawCode : "ADS_SOURCE_UNAVAILABLE";
    sendJson(res, 503, {
      error: { code, message: "Không lấy được dữ liệu nguồn của store. Kiểm tra kết nối và quyền truy cập." },
    });
    return true;
  }
}
