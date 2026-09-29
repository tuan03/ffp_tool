import type { IncomingMessage, ServerResponse } from "node:http";
import { GoogleGenAI } from "@google/genai";

import { isGatewayAuthorized } from "./http-server";
import { loadLocalEnv } from "./store-config-loader";
import { generateReviewSamples, REVIEW_PROMPT } from "./amazon-reviews-generator";
import type { GenerateReviewInput, RawReviewSample, ReviewProvider } from "./amazon-reviews-generator";

class InvalidReviewRequest extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readInput(value: unknown): GenerateReviewInput {
  if (!isRecord(value) || typeof value.asin !== "string" || typeof value.count !== "number" || !isRecord(value.product) ||
      !Array.isArray(value.sourceReviews) || !Array.isArray(value.priorSamples)) {
    throw new InvalidReviewRequest("Yêu cầu tạo review không hợp lệ.");
  }
  if (!/^[A-Z0-9]{10}$/.test(value.asin) || !Number.isInteger(value.count) || value.count < 1 || value.count > 50) {
    throw new InvalidReviewRequest("ASIN hoặc số review không hợp lệ.");
  }
  const product = value.product;
  return {
    asin: value.asin,
    count: value.count,
    startIndex: typeof value.startIndex === "number" ? value.startIndex : 1,
    product: {
      title: typeof product.title === "string" ? product.title : "",
      description: typeof product.description === "string" ? product.description : "",
      bullets: Array.isArray(product.bullets) ? product.bullets.filter((entry): entry is string => typeof entry === "string").slice(0, 20) : [],
      details: isRecord(product.details) ? Object.fromEntries(Object.entries(product.details).filter((entry): entry is [string, string] => typeof entry[1] === "string")) : {},
    },
    sourceReviews: value.sourceReviews.filter((entry): entry is { body: string } => isRecord(entry) && typeof entry.body === "string").slice(0, 50),
    priorSamples: value.priorSamples.filter((entry): entry is { author: string; body: string } => isRecord(entry) && typeof entry.author === "string" && typeof entry.body === "string").slice(0, 100),
  };
}

function createVertexProvider(): ReviewProvider {
  const env = loadLocalEnv();
  const project = env.GOOGLE_CLOUD_PROJECT;
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is required for review generation.");
  const client = new GoogleGenAI({ vertexai: true, project, location: env.GOOGLE_CLOUD_LOCATION || "global" });
  const model = env.GEMINI_ANALYSIS_MODEL || "gemini-2.5-flash";
  return async (plans, input, repair) => {
    const context = { product: input.product, sourceReviews: input.sourceReviews, reviewPlan: plans, count: plans.length, repair };
    const response = await client.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: `${REVIEW_PROMPT}\n\nContext:\n${JSON.stringify(context)}` }] }],
      config: { responseMimeType: "application/json", temperature: 0.8, maxOutputTokens: 8192 },
    });
    const parsed: unknown = JSON.parse(response.text || "null");
    if (!isRecord(parsed) || !Array.isArray(parsed.samples)) throw new Error("Gemini returned an invalid review sample response.");
    return parsed.samples.filter((sample): sample is RawReviewSample => isRecord(sample) && typeof sample.author === "string" &&
      typeof sample.body === "string" && typeof sample.rating === "number" && typeof sample.variantText === "string" &&
      typeof sample.verifiedPurchase === "boolean");
  };
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}

export async function handleAmazonReviewsHttpRequest(
  req: IncomingMessage,
  res: ServerResponse,
  options: { readonly authToken?: string; readonly maxBodyBytes: number; readonly provider?: ReviewProvider },
): Promise<void> {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: "Method Not Allowed" });
    return;
  }
  if (options.authToken && !isGatewayAuthorized(req.headers, options.authToken)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }
  try {
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      totalBytes += buffer.length;
      if (totalBytes > options.maxBodyBytes) {
        sendJson(res, 413, { error: "Request too large" });
        return;
      }
      chunks.push(buffer);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new InvalidReviewRequest("JSON không hợp lệ.");
    }
    const input = readInput(parsed);
    const generated = await generateReviewSamples(input, options.provider ?? createVertexProvider());
    sendJson(res, 200, generated);
  } catch (error) {
    if (error instanceof InvalidReviewRequest) {
      sendJson(res, 422, { error: error.message });
      return;
    }
    sendJson(res, 503, { error: "Không tạo được review AI. Kiểm tra cấu hình backend hoặc thử lại." });
  }
}
