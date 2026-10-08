import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";

import type { ExternalSeoWorkflow } from "./workflow";
import { registerPerformanceTools } from "../seo-performance/mcp-tools";
import type { PerformanceService } from "../seo-performance/service";

const PROVIDER = "codex_mcp" as const;

const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};
const SAFE_WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const leaseSchema = {
  batchId: z.string().min(1),
  leaseToken: z.string().min(1),
};
const jobLeaseSchema = {
  jobId: z.string().min(1),
  ...leaseSchema,
};
const mutationSchema = {
  ...jobLeaseSchema,
  requestId: z.string().min(1).max(120),
};
const analysisText = z.string().min(1).max(4000);
const analysisTexts = z.array(analysisText).max(20);
const externalAnalysisSchema = z.object({
  physicalProductIdentity: analysisText,
  visualEntities: analysisText,
  sceneContext: analysisText,
  identityCandidates: analysisTexts,
  excludedSceneEntities: analysisTexts,
  confidence: z.number().min(0).max(1),
  reviewRequired: z.boolean(),
  typography: z.object({
    visibleTexts: analysisTexts,
    customizationSampleTexts: analysisTexts.default([]).describe("Buyer-editable names, initials, dates, jersey/player numbers or other mockup placeholder values; never use these in generated content."),
    styleSummary: analysisText,
  }).strict(),
  shoppingContext: z.object({ targetAudience: analysisTexts, suitableOccasions: analysisTexts, useCases: analysisTexts, buyerIntentKeywords: analysisTexts }).strict(),
  evidence: z.array(z.object({ imageId: analysisText, observation: analysisText }).strict()).min(1),
}).strict();

const externalDraftSchema = z.object({
  productTitle: z.string().min(1),
  intro: z.string().min(1),
  bullets: z.array(z.object({
    label: z.string().min(1),
    text: z.string().min(1),
  })).min(2).max(5),
  guidance: z.array(z.string().min(1)).optional(),
  closing: z.string().min(1),
  productSeoTitle: z.string().min(1).max(70),
  productSeoDescription: z.string().min(1).max(160),
  aeo_quick_summary: z.string().min(1),
  aeo_faq: z.array(z.object({
    question: z.string().min(1),
    answer: z.string().min(1),
  })).min(3).max(5),
}).strict();

const externalSubmissionSchema = z.object({
  draft: externalDraftSchema,
  alts: z.record(z.string(), z.string().min(1).max(125)),
}).strict();

function jsonResult(value: unknown): CallToolResult {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value)
    ? { ...value }
    : { value };
  return {
    content: [{ type: "text", text: JSON.stringify(structuredContent) }],
    structuredContent,
  };
}

const SERVER_INSTRUCTIONS = `This is a compatibility client. Stores migrated to the SEO worker must use /mcp/seo-worker and cannot claim work here.
Process only the Codex MCP SEO work exposed by these tools.
For SEO Performance audit requests, use the performance evidence and recommendation tools without claiming a content-generation batch. Audit proposals never approve, enqueue revisions, or publish; an operator must request a revision separately.
Image pixels are the only source of product-specific facts. Use niche only to disambiguate the sold object and storeProfile only for its scoped store policy. Source snapshots, titles, descriptions, handles, variants, keywords, URLs, old alt text, performance facts and arbitrary operator instructions are intentionally unavailable.
Classify buyer-editable names, initials, dates, jersey/player numbers and similar mockup placeholders in typography.customizationSampleTexts. They are not fixed artwork and must never appear in titles, descriptions, SEO/AEO, FAQs, alt text or keywords. A generic customization claim still requires explicit grounded evidence or store policy.
Resume an active codex_mcp batch before claiming another. Renew the lease before long analysis or uploads.
For each job, call get_seo_job, then view every image ID with get_seo_job_image. URLs, filenames, and old alt text are not visual evidence.
Complete stages in order: analysis, research, keyword choice, then draft submission. Cite every image ID in analysis evidence.
Every draft must include a grounded 40-70 word aeo_quick_summary and 3-5 grounded aeo_faq question/answer items. Never submit aeo_json_ld; the server compiles JSON-LD from the validated draft and FAQ.
Bedding style claims such as Comforter, Quilt and Duvet Cover require grounded image identity plus an applicable store-profile policy. A Fleece or Sherpa blanket is not a three-style bedding set.
Never infer materials, certifications, waterproofing, safety, medical benefits, or performance claims without explicit source evidence.
Submission creates a review draft only. These tools never publish or write to Shopify.`;

export interface CodexSeoMcpServerOptions {
  readonly workflow: ExternalSeoWorkflow;
  readonly storeId: string;
  readonly ownerId: string;
  readonly performance?: () => PerformanceService | undefined;
}

export function createCodexSeoMcpServer(options: CodexSeoMcpServerOptions): McpServer {
  const { workflow, storeId, ownerId } = options;
  const server = new McpServer(
    { name: "ffp-seo", version: "1.0.0" },
    { instructions: SERVER_INSTRUCTIONS },
  );

  server.registerTool("get_seo_work", {
    description: "Read Codex MCP queue counts and the resumable or blocking active batch.",
    inputSchema: {},
    annotations: READ_ONLY,
  }, async () => jsonResult((await workflow.getWork(storeId, PROVIDER, ownerId))));

  server.registerTool("claim_seo_batch", {
    description: "Claim pending codex_mcp jobs. Retry a network failure with the same requestId.",
    inputSchema: { requestId: z.string().min(1).max(120) },
    annotations: SAFE_WRITE,
  }, async ({ requestId }) => jsonResult((await workflow.claim(storeId, PROVIDER, ownerId, requestId))));

  server.registerTool("get_seo_job", {
    description: "Read V2 niche, versioned store profile, checkpoints and image IDs. Source fields are intentionally excluded.",
    inputSchema: { jobId: z.string().min(1) },
    annotations: READ_ONLY,
  }, async ({ jobId }) => jsonResult((await workflow.getJob(storeId, PROVIDER, jobId))));

  server.registerTool("get_seo_job_image", {
    description: "Fetch one approved product image as vision input. Call once for every image ID.",
    inputSchema: { jobId: z.string().min(1), imageId: z.string().min(1) },
    annotations: { ...READ_ONLY, openWorldHint: true },
  }, async ({ jobId, imageId }) => {
    const image = await workflow.getImage(storeId, PROVIDER, jobId, imageId);
    return {
      content: [{ type: "image", data: image.bytes.toString("base64"), mimeType: image.contentType }],
    };
  });

  server.registerTool("renew_seo_batch", {
    description: "Renew a Codex MCP batch lease before a long operation.",
    inputSchema: leaseSchema,
    annotations: SAFE_WRITE,
  }, async input => jsonResult((await workflow.renew(storeId, PROVIDER, input))));

  server.registerTool("release_seo_batch", {
    description: "Release unfinished jobs while retaining saved checkpoints.",
    inputSchema: leaseSchema,
    annotations: SAFE_WRITE,
  }, async input => jsonResult((await workflow.release(storeId, PROVIDER, input))));

  server.registerTool("save_seo_analysis", {
    description: "Validate and save grounded visual analysis with evidence for every image ID.",
    inputSchema: {
      ...mutationSchema,
      analysis: externalAnalysisSchema,
    },
    annotations: SAFE_WRITE,
  }, async input => {
    const job = (await workflow.saveAnalysis(storeId, PROVIDER, input));
    return jsonResult({ jobId: job.id, status: job.status, checkpoints: job.checkpoints });
  });

  server.registerTool("research_seo_keywords", {
    description: "Fetch and checkpoint real Google Suggest data for one to five grounded seeds.",
    inputSchema: {
      ...mutationSchema,
      seeds: z.array(z.string().min(1).max(120)).min(1).max(5),
    },
    annotations: { ...SAFE_WRITE, openWorldHint: true },
  }, async input => jsonResult(await workflow.research(storeId, PROVIDER, input)));

  server.registerTool("choose_seo_keywords", {
    description: "Check store corpus conflicts and save keywords only when no conflict remains.",
    inputSchema: {
      ...mutationSchema,
      keywords: z.array(z.string().min(1).max(120)).min(1).max(10),
      reason: z.string().min(1).max(4000),
    },
    annotations: SAFE_WRITE,
  }, async input => jsonResult(await workflow.chooseKeywords(storeId, PROVIDER, input)));

  server.registerTool("submit_seo_draft", {
    description: "Submit a complete SEO and AEO draft plus image alts for validation. The server compiles JSON-LD and never publishes to Shopify.",
    inputSchema: {
      ...mutationSchema,
      submission: externalSubmissionSchema,
    },
    annotations: SAFE_WRITE,
  }, async input => jsonResult((await workflow.submit(storeId, PROVIDER, input))));

  server.registerTool("get_seo_result", {
    description: "Read validation status and feedback. REVIEW_READY awaits human approval.",
    inputSchema: { jobId: z.string().min(1) },
    annotations: READ_ONLY,
  }, async ({ jobId }) => jsonResult((await workflow.getResult(storeId, PROVIDER, jobId))));

  server.registerTool("report_seo_issue", {
    description: "Move a job to WAITING_INPUT when evidence or required source data is missing.",
    inputSchema: {
      ...jobLeaseSchema,
      message: z.string().min(1).max(1000),
    },
    annotations: SAFE_WRITE,
  }, async input => jsonResult((await workflow.reportIssue(storeId, PROVIDER, input))));

  server.registerTool("list_waiting_seo_jobs", {
    description: "List codex_mcp jobs awaiting operator input without claiming or changing them.",
    inputSchema: { offset: z.number().int().min(0).default(0) },
    annotations: READ_ONLY,
  }, async ({ offset }) => jsonResult((await workflow.listWaiting(storeId, PROVIDER, offset))));

  if (options.performance) registerPerformanceTools(server, storeId, ownerId, options.performance);
  return server;
}
