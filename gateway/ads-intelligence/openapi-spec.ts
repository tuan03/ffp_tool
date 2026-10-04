/**
 * OpenAPI 3.1.0 Specification Generator for FFP Ads Intelligence
 * Generates valid OpenAPI schema for Custom GPT Builder Actions & External Agents.
 */

export function generateAdsOpenApiSpec(serverBaseUrl = "http://localhost:3001"): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "FFP Ads Intelligence API",
      version: "1.0.0",
      description:
        "High-performance media buying intelligence API for AI Agents and Custom GPTs. Provides multi-source reconciliation (Meta, GA4, Shopify), 6-rule decision cards, competitor creative intelligence, 12-section international-standard Creative Briefs, and an Observational Experiment Memory Ledger.",
    },
    servers: [
      {
        url: serverBaseUrl,
        description: "FFP Gateway Server",
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "Optional bearer token for authenticated gateway access",
        },
      },
      schemas: {
        ErrorResponse: {
          type: "object",
          properties: {
            error: {
              type: "object",
              properties: {
                message: { type: "string" },
                details: { type: "object", additionalProperties: true },
              },
              required: ["message"],
            },
          },
        },
      },
    },
    paths: {
      "/api/ads-intelligence/summary": {
        get: {
          operationId: "getAdsSummary",
          summary: "Get overall store performance summary",
          description: "Returns spend, purchases, blended CPA, MER, ROAS, gross/net sales, profit, and three-way reconciliation status.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
              description: "Identifier of the store (e.g. chillgen, jeminise, wrydeco)",
            },
            {
              name: "forceRefresh",
              in: "query",
              required: false,
              schema: { type: "boolean", default: false },
              description: "Bypass cached facts to trigger live refresh",
            },
          ],
          responses: {
            "200": {
              description: "Store summary data",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
            "500": { description: "Internal error", content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorResponse" } } } },
          },
        },
      },
      "/api/ads-intelligence/hierarchy": {
        get: {
          operationId: "getAdsHierarchy",
          summary: "Get campaign hierarchy (Campaign -> Ad Set -> Ad)",
          description: "Returns the 3-level Meta ad hierarchy with performance, hook rates, link CTR, and creative fatigue indicators.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
              description: "Store ID",
            },
          ],
          responses: {
            "200": {
              description: "Campaign hierarchy array",
              content: { "application/json": { schema: { type: "object", properties: { campaigns: { type: "array", items: { type: "object" } } } } } },
            },
          },
        },
      },
      "/api/ads-intelligence/health": {
        get: {
          operationId: "getDataHealth",
          summary: "Check data freshness, sync health & attribution maturity",
          description: "Surfaces attribution window maturity (MATURED vs PROVISIONAL) and lists blocked decisions.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Data health status",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/reconciliation": {
        get: {
          operationId: "getReconciliationReport",
          summary: "Get three-way reconciliation report (Meta vs GA4 vs Shopify)",
          description: "Analyzes click-to-session drop, purchase tracking discrepancies, and funnel drop-off rates.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Reconciliation matrix & funnel metrics",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/decisions": {
        get: {
          operationId: "getDecisionCards",
          summary: "Get 6-rule synthesized Decision Cards",
          description: "Returns cards for pause candidates, scale opportunities, creative fatigue, and data maturity gates.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Decision cards list",
              content: { "application/json": { schema: { type: "object", properties: { decisions: { type: "array", items: { type: "object" } } } } } },
            },
          },
        },
      },
      "/api/ads-intelligence/ai-analyze": {
        post: {
          operationId: "runAiStrategicAnalysis",
          summary: "Run AI Strategic Performance Analysis",
          description: "Generates executive diagnosis, root-cause hypotheses, and actionable brief suggestions.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "AI Strategic Report",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/competitors": {
        get: {
          operationId: "getCompetitorIntelligence",
          summary: "Get competitor ad spy intelligence and creative gaps",
          description: "Returns competitor ads library, taxonomy breakdown, and prioritized creative gaps with citations.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Competitor intelligence report",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/briefs": {
        get: {
          operationId: "getCreativeBriefs",
          summary: "Get all creative briefs for a store",
          description: "Lists 12-section international-standard briefs in various lifecycle statuses.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Creative briefs array",
              content: { "application/json": { schema: { type: "object", properties: { briefs: { type: "array", items: { type: "object" } } } } } },
            },
          },
        },
      },
      "/api/ads-intelligence/briefs/generate": {
        post: {
          operationId: "generateCreativeBrief",
          summary: "Generate a new 12-section Creative Brief",
          description: "Generates brief from a decision card or competitor gap, complete with storyboard, variables, and kill criteria.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    storeId: { type: "string", default: "chillgen" },
                    sourceType: { type: "string", enum: ["decision", "gap"] },
                    sourceId: { type: "string" },
                  },
                  required: ["sourceType", "sourceId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Generated creative brief",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/briefs/{id}": {
        get: {
          operationId: "getCreativeBriefById",
          summary: "Get creative brief details by ID",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Brief details",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
            "404": { description: "Brief not found" },
          },
        },
      },
      "/api/ads-intelligence/briefs/{id}/markdown": {
        get: {
          operationId: "getCreativeBriefMarkdown",
          summary: "Get ready-to-copy Markdown production document of a brief",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Brief formatted as production Markdown",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      briefId: { type: "string" },
                      title: { type: "string" },
                      markdown: { type: "string" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/ads-intelligence/briefs/{id}/status": {
        put: {
          operationId: "updateCreativeBriefStatus",
          summary: "Update the lifecycle status of a brief",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["DRAFT", "APPROVED", "IN_PRODUCTION", "READY_FOR_TEST", "ARCHIVED"] },
                    notes: { type: "string" },
                  },
                  required: ["status"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated brief",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/experiments": {
        get: {
          operationId: "getAdsExperiments",
          summary: "Get Observational Experiment Memory Ledger",
          description: "Lists active and completed tests with control vs variant comparisons, confounders, and reviewed learnings.",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string", default: "chillgen" },
            },
          ],
          responses: {
            "200": {
              description: "Experiments ledger list",
              content: { "application/json": { schema: { type: "object", properties: { experiments: { type: "array", items: { type: "object" } } } } } },
            },
          },
        },
        post: {
          operationId: "createAdsExperiment",
          summary: "Create a registered observational experiment from a brief",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    storeId: { type: "string", default: "chillgen" },
                    briefId: { type: "string" },
                    variantName: { type: "string" },
                    notes: { type: "string" },
                  },
                  required: ["briefId", "variantName"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Created experiment",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/experiments/{id}": {
        get: {
          operationId: "getAdsExperimentById",
          summary: "Get single experiment details by ID",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": {
              description: "Experiment record",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
            "404": { description: "Experiment not found" },
          },
        },
      },
      "/api/ads-intelligence/experiments/{id}/outcome": {
        put: {
          operationId: "updateExperimentOutcome",
          summary: "Record test conclusion, verdict, confounders and reviewed learning",
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", enum: ["COMPLETED", "INCONCLUSIVE", "ABORTED"] },
                    results: {
                      type: "object",
                      properties: {
                        controlSpend: { type: "number" },
                        controlPurchases: { type: "number" },
                        controlCpa: { type: "number" },
                        controlRoas: { type: "number" },
                        variantSpend: { type: "number" },
                        variantPurchases: { type: "number" },
                        variantCpa: { type: "number" },
                        variantRoas: { type: "number" },
                        cpaDeltaPercent: { type: "number" },
                        roasDeltaPercent: { type: "number" },
                        statisticalSignificance: { type: "number" },
                        confounders: { type: "array", items: { type: "string" } },
                      },
                    },
                    learning: {
                      type: "object",
                      properties: {
                        verdict: { type: "string", enum: ["WIN", "LOSS", "INCONCLUSIVE"] },
                        summary: { type: "string" },
                        scope: { type: "string" },
                        nextTest: { type: "string" },
                        reviewedBy: { type: "string" },
                      },
                      required: ["verdict", "summary"],
                    },
                  },
                  required: ["status", "learning"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Updated experiment with recorded learning",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/mcp/info": {
        get: {
          operationId: "getMcpServerInfo",
          summary: "Get MCP Server configuration & available tool directory",
          responses: {
            "200": {
              description: "MCP Server metadata",
              content: { "application/json": { schema: { type: "object", additionalProperties: true } } },
            },
          },
        },
      },
      "/api/ads-intelligence/writes/preview": {
        post: {
          operationId: "createWritePreview",
          summary: "Generate tamper-proof cryptographic preview for ad mutation (V3 Guarded Writes)",
          description: "Generates sha256 checksum, verifies 20% budget caps, and establishes 15m expiration window before human approval.",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    storeId: { type: "string" },
                    entityId: { type: "string" },
                    entityName: { type: "string" },
                    entityType: { type: "string", enum: ["CAMPAIGN", "ADSET", "AD"] },
                    action: { type: "string", enum: ["PAUSE_ENTITY", "ENABLE_ENTITY", "UPDATE_BUDGET"] },
                    currentStatus: { type: "string" },
                    currentBudget: { type: "number" },
                    proposedStatus: { type: "string" },
                    proposedBudget: { type: "number" },
                    currency: { type: "string" },
                    reason: { type: "string" },
                    requestedBy: { type: "string" },
                  },
                  required: ["storeId", "entityId", "action", "currentStatus", "currency", "reason", "requestedBy"],
                },
              },
            },
          },
          responses: {
            "201": { description: "Tamper-proof preview with sha256 hash" },
          },
        },
      },
      "/api/ads-intelligence/writes/approve": {
        post: {
          operationId: "approveWritePreview",
          summary: "Submit human media buyer approval for guarded write preview",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    previewId: { type: "string" },
                    previewHash: { type: "string" },
                    approvedBy: { type: "string" },
                    comment: { type: "string" },
                  },
                  required: ["previewId", "previewHash", "approvedBy"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Approval recorded" },
            "400": { description: "Approval rejected or hash mismatch" },
          },
        },
      },
      "/api/ads-intelligence/writes/execute": {
        post: {
          operationId: "executeGuardedWrite",
          summary: "Execute guarded write under safety fences (Fails safe in V1/V2 read-only mode)",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    previewId: { type: "string" },
                    liveEntityState: {
                      type: "object",
                      properties: {
                        status: { type: "string" },
                        budget: { type: "number" },
                      },
                      required: ["status"],
                    },
                  },
                  required: ["previewId", "liveEntityState"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Action executed (when V3 enabled)" },
            "403": { description: "Action denied safe in V1/V2 read-only mode" },
          },
        },
      },
      "/api/ads-intelligence/writes/audit": {
        get: {
          operationId: "getWriteAuditLog",
          summary: "Get immutable audit trail of all mutation requests and outcomes",
          parameters: [
            {
              name: "storeId",
              in: "query",
              required: false,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Guarded write audit entries" },
          },
        },
      },
    },
  };
}
