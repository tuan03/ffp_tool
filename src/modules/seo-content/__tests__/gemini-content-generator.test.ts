import assert from "node:assert/strict";
import test from "node:test";

import { GoogleGenAIVertexContentGenerator } from "../internal/product-understanding/gemini-content-generator";
import { GeminiSeoContentGenerator } from "../internal/content-generation/gemini-content-generator";

test("GoogleGenAIVertexContentGenerator forwards structured thinking budget", async () => {
  let capturedConfig: Record<string, unknown> | undefined;
  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    client: {
      models: {
        async generateContent(params) {
          capturedConfig = params.config;
          return { text: '{"niche":"custom rugs"}' };
        },
      },
    },
  });

  await generator.generateStructuredText({
    prompt: "Homepage evidence",
    systemInstruction: "Return JSON",
    responseJsonSchema: { type: "object" },
    thinkingBudget: 0,
  });

  assert.deepEqual(capturedConfig?.thinkingConfig, { thinkingBudget: 0 });
});

test("GoogleGenAIVertexContentGenerator retries on 429 rate limit with exponential backoff", async () => {
  let callCount = 0;
  const retryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    retryOptions: {
      initialDelayMs: 100,
      jitterMs: 0,
      sleepFn: async () => {},
      onRetry: (_err, attempt, delayMs) => {
        retryEvents.push({ attempt, delayMs });
      },
    },
    client: {
      models: {
        async generateContent() {
          callCount++;
          if (callCount === 1) {
            const err = new Error("429 RESOURCE_EXHAUSTED");
            Object.assign(err, { status: 429 });
            throw err;
          }
          return { text: '{"niche":"custom rugs"}' };
        },
      },
    },
  });

  const result = await generator.generateStructuredText({
    prompt: "Test prompt",
    systemInstruction: "Return JSON",
    responseJsonSchema: { type: "object" },
  });

  assert.equal(callCount, 2);
  assert.equal(retryEvents.length, 1);
  assert.equal(retryEvents[0].attempt, 1);
  assert.equal(result.rawText, '{"niche":"custom rugs"}');
});

test("GoogleGenAIVertexContentGenerator prioritizes request-level retryOptions", async () => {
  let callCount = 0;
  const requestRetryEvents: Array<{ attempt: number; delayMs: number }> = [];

  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "test-project",
    retryOptions: {
      maxRetries: 5,
    },
    client: {
      models: {
        async generateContent() {
          callCount++;
          const err = new Error("429 RESOURCE_EXHAUSTED");
          Object.assign(err, { status: 429 });
          throw err;
        },
      },
    },
  });

  await assert.rejects(
    async () => {
      await generator.generateProductImageAnalysis({
        prompt: "Analyze image",
        imagePayloads: [],
        systemInstruction: "Instructions",
        retryOptions: {
          maxRetries: 1, // overrides generator's 5 retries
          initialDelayMs: 50,
          jitterMs: 0,
          sleepFn: async () => {},
          onRetry: (_err, attempt, delayMs) => {
            requestRetryEvents.push({ attempt, delayMs });
          },
        },
      });
    },
    /429 RESOURCE_EXHAUSTED/,
  );

  // 1 initial attempt + 1 retry = 2 calls (not 1 + 5 = 6)
  assert.equal(callCount, 2);
  assert.equal(requestRetryEvents.length, 1);
});

test("GeminiSeoContentGenerator parses AEO fields and builds valid Schema.org @graph JSON-LD", async () => {
  let capturedSystemInstruction: string | undefined;

  const mockGeminiClient = {
    async generateStructuredText(params: { prompt: string; systemInstruction?: string; responseJsonSchema?: unknown }) {
      capturedSystemInstruction = params.systemInstruction;
      return {
        rawText: JSON.stringify({
          productTitle: "Viking Quilt Bed Set - Viking-03",
          intro: "Immerse yourself in Norse mythology with this Viking quilt bed set.",
          bullets: [
            { label: "Design", text: "Features Thor Mjolnir hammer and skull artwork." },
            { label: "Material", text: "Breathable all-season microfiber construction." },
          ],
          guidance: ["Machine wash cold on gentle cycle."],
          closing: "A legendary addition to your master bedroom.",
          productSeoTitle: "Viking Quilt Bed Set Viking-03 | Norse Bedding",
          productSeoDescription: "Shop the Viking-03 quilt bed set featuring Thor's Mjolnir hammer design.",
          aeo_quick_summary: "The Viking-03 Quilt Bed Set is an all-season microfiber bedding package designed for Norse mythology enthusiasts.",
          aeo_faq: [
            {
              question: "How do I choose the right Viking quilt bed set?",
              answer: "Match dimensions to your mattress and look for breathable all-season fabric.",
            },
            {
              question: "Is this quilt set suitable for all seasons?",
              answer: "Yes, lightweight microfiber provides balanced year-round comfort.",
            },
            {
              question: "What is included and how is it washed?",
              answer: "Includes the quilt bedspread. Machine wash cold on gentle cycle.",
            },
            {
              question: "What makes the Viking-03 design unique?",
              answer: "Exclusive Thor Mjolnir skull emblem framed by Celtic knotwork.",
            },
          ],
        }),
      };
    },
    async generateProductImageAnalysis() {
      throw new Error("Not implemented");
    },
  };

  const generator = new GeminiSeoContentGenerator(mockGeminiClient);
  const draft = await generator.generate({
    facts: {
      originalTitle: "Viking Quilt Bed Set",
      originalDescription: "Microfiber bedding.",
      niche: "bedding",
      physicalProductIdentity: "quilt bed set",
      typographyVisibleTexts: [],
      visualEntities: "Thor Mjolnir hammer",
      targetAudience: ["Norse enthusiasts"],
      occasions: [],
      useCases: ["master bedroom"],
      personalizationSupported: false,
      variantLabel: "Viking-03",
    },
    keywords: {
      primary: "viking quilt bed set",
      secondary: [],
      supportingKeywords: [],
      framingConcepts: [],
      targetedKeywords: [],
    },
    constraints: {
      maxSeoTitleLength: 70,
      maxSeoDescriptionLength: 160,
      maxHandleLength: 80,
      maxBullets: 5,
      preserveExistingHandle: true,
    },
  });

  assert.ok(capturedSystemInstruction?.includes("AEO & GENERATIVE SEARCH OPTIMIZATION"));
  assert.equal(draft.aeo_quick_summary, "The Viking-03 Quilt Bed Set is an all-season microfiber bedding package designed for Norse mythology enthusiasts.");
  assert.equal(draft.aeo_faq?.length, 4);
  assert.equal(draft.aeo_faq?.[0].question, "How do I choose the right Viking quilt bed set?");

  assert.ok(draft.aeo_json_ld, "Draft must have aeo_json_ld populated");
  const parsedJsonLd = JSON.parse(draft.aeo_json_ld);
  assert.equal(parsedJsonLd["@context"], "https://schema.org");
  assert.equal(parsedJsonLd["@graph"].length, 2);
  assert.equal(parsedJsonLd["@graph"][0]["@type"], "Product");
  assert.equal(parsedJsonLd["@graph"][1]["@type"], "FAQPage");
  assert.equal(parsedJsonLd["@graph"][1].mainEntity.length, 4);
});


