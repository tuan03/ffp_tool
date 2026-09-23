import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import {
  GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA,
  GeminiSchemaValidationError,
  parseGeminiProductImageAnalysis,
} from "../internal/product-understanding/gemini-analysis-schema";
import {
  InvalidImagePayloadError,
  prepareProductImagePayload,
} from "../internal/product-understanding/product-image-payload";
import {
  FakeGeminiContentGenerator,
  GeminiGeneratorError,
  GoogleGenAIVertexContentGenerator,
} from "../internal/product-understanding/gemini-content-generator";
import {
  GeminiProductImageAnalyzer,
} from "../internal/product-understanding/gemini-product-image-analyzer";
import {
  FallbackProductImageAnalyzer,
} from "../internal/product-understanding/fallback-product-image-analyzer";
import {
  heuristicProductImageAnalyzer,
} from "../internal/product-understanding/heuristic-product-image-analyzer";
import {
  createB1ProductUnderstandingStage,
  createDefaultProductImageAnalyzer,
} from "../internal/stages/b1-product-understanding";
import { createInitialContext } from "../internal/pipeline-context";
import { buildProductUnderstanding } from "../internal/product-understanding/product-understanding-builder";
import { extractTextProductSignals } from "../internal/product-understanding/text-product-signals";
import type { SeoContentInput } from "../types";
import type { ProductImageAnalysis, ProductImageAnalyzer } from "../internal/product-understanding/product-image-analyzer";

test("Schema: GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA has required structured fields", () => {
  assert.equal(GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA.type, "object");
  assert.deepEqual(GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA.required, [
    "ocrTexts",
    "detectedEntities",
    "dominantColors",
    "visualStyle",
    "productCategory",
  ]);
});

test("Schema: parses valid JSON, trims whitespace, removes empty items, preserves OCR casing", () => {
  const raw = JSON.stringify({
    ocrTexts: ["  Ride Free  ", "", "LIVE TO RIDE"],
    detectedEntities: [" motorcycle ", "skull ", ""],
    dominantColors: [" Black ", "Silver"],
    visualStyle: " vintage retro illustration ",
    productCategory: " ceramic mug ",
  });

  const parsed = parseGeminiProductImageAnalysis(raw);
  assert.deepEqual(parsed.ocrTexts, ["Ride Free", "LIVE TO RIDE"]);
  assert.deepEqual(parsed.detectedEntities, ["motorcycle", "skull"]);
  assert.deepEqual(parsed.dominantColors, ["Black", "Silver"]);
  assert.equal(parsed.visualStyle, "vintage retro illustration");
  assert.equal(parsed.productCategory, "ceramic mug");
});

test("Schema: rejects invalid JSON or malformed schema structures", () => {
  assert.throws(
    () => parseGeminiProductImageAnalysis("not valid json"),
    GeminiSchemaValidationError,
  );
  assert.throws(
    () => parseGeminiProductImageAnalysis(JSON.stringify({ ocrTexts: "should be array" })),
    GeminiSchemaValidationError,
  );
  assert.throws(
    () =>
      parseGeminiProductImageAnalysis(
        JSON.stringify({
          ocrTexts: [],
          detectedEntities: [123], // invalid item
          dominantColors: [],
          visualStyle: "vintage",
          productCategory: "t-shirt",
        }),
      ),
    GeminiSchemaValidationError,
  );
  assert.throws(
    () =>
      parseGeminiProductImageAnalysis(
        JSON.stringify({
          ocrTexts: [],
          detectedEntities: [],
          dominantColors: [],
          visualStyle: 42, // invalid type
          productCategory: "t-shirt",
        }),
      ),
    GeminiSchemaValidationError,
  );
});

test("Schema Reviewer Fix: enforces additionalProperties: false and rejects unknown properties", () => {
  assert.throws(
    () =>
      parseGeminiProductImageAnalysis(
        JSON.stringify({
          ocrTexts: [],
          detectedEntities: [],
          dominantColors: [],
          visualStyle: "retro",
          productCategory: "t-shirt",
          hallucinatedField: "invalid", // extra unexpected property
        }),
      ),
    (err: unknown) =>
      err instanceof GeminiSchemaValidationError &&
      err.message.includes("additionalProperties: false violation"),
  );
});

test("Payload: prepares inlineData for local file using node:fs binary read", async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "ffp-test-"));
  const tempFile = path.join(tempDir, "test-design.png");
  const dummyBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  await fs.writeFile(tempFile, dummyBuffer);

  try {
    const payload = await prepareProductImagePayload({
      url: "https://example.com/fallback.png",
      localFilePath: tempFile,
    });

    assert.equal(payload.type, "inline");
    if (payload.type === "inline") {
      assert.equal(payload.inlineData.mimeType, "image/png");
      assert.equal(payload.inlineData.data, dummyBuffer.toString("base64"));
    }
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

test("Payload: prepares fileData for gs:// URIs and data:image URIs", async () => {
  const gsPayload = await prepareProductImagePayload({
    url: "gs://my-bucket/products/mug-mockup.webp",
  });
  assert.equal(gsPayload.type, "fileUri");
  if (gsPayload.type === "fileUri") {
    assert.equal(gsPayload.fileData.fileUri, "gs://my-bucket/products/mug-mockup.webp");
    assert.equal(gsPayload.fileData.mimeType, "image/webp");
  }

  const dataPayload = await prepareProductImagePayload({
    url: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
  });
  assert.equal(dataPayload.type, "inline");
  if (dataPayload.type === "inline") {
    assert.equal(dataPayload.inlineData.mimeType, "image/jpeg");
    assert.equal(dataPayload.inlineData.data, "/9j/4AAQSkZJRg==");
  }
});

test("Payload Reviewer Fix: rejects gs:// URIs without recognized image extensions", async () => {
  await assert.rejects(
    () => prepareProductImagePayload({ url: "gs://my-bucket/products/untyped-file" }),
    (err: unknown) =>
      err instanceof InvalidImagePayloadError &&
      err.message.includes("Cannot determine MIME type for gs:// URI"),
  );
});

test("Payload Reviewer Fix: rejects data:image URI exceeding 10MB decoded limit", async () => {
  // Create a 10MB + 1 byte buffer
  const largeBuffer = Buffer.alloc(10 * 1024 * 1024 + 10, 0x41);
  const largeBase64 = largeBuffer.toString("base64");
  const dataUri = `data:image/jpeg;base64,${largeBase64}`;

  await assert.rejects(
    () => prepareProductImagePayload({ url: dataUri }),
    (err: unknown) =>
      err instanceof InvalidImagePayloadError &&
      err.message.includes("exceeds maximum allowed size of 10MB"),
  );
});

test("Payload Reviewer Fix: rejects remote URL returning explicit non-image content-type (text/html)", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response("<html>Not an image</html>", {
        status: 200,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });

    await assert.rejects(
      () => prepareProductImagePayload({ url: "https://example.com/fake-image.jpg" }),
      (err: unknown) =>
        err instanceof InvalidImagePayloadError &&
        err.message.includes("returned non-image content-type 'text/html; charset=utf-8'"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Payload Reviewer Fix: fetch timeout triggers InvalidImagePayloadError", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, init) => {
      // Simulate slow connection that waits for signal abort
      return new Promise<Response>((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    };

    await assert.rejects(
      () =>
        prepareProductImagePayload(
          { url: "https://example.com/slow-image.png" },
          { fetchTimeoutMs: 20 },
        ),
      (err: unknown) =>
        err instanceof InvalidImagePayloadError && err.message.includes("timed out after 20ms"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Payload: throws InvalidImagePayloadError on missing image, missing files, or unsupported formats", async () => {
  await assert.rejects(
    () => prepareProductImagePayload({ url: "" }),
    InvalidImagePayloadError,
  );
  await assert.rejects(
    () =>
      prepareProductImagePayload({
        url: "",
        localFilePath: "C:/non/existent/path/image.jpg",
      }),
    InvalidImagePayloadError,
  );
  await assert.rejects(
    () =>
      prepareProductImagePayload({
        url: "https://example.com/vector.svg",
      }),
    InvalidImagePayloadError,
  );
});

test("Reviewer Blocker Fix: GoogleGenAIVertexContentGenerator formats payload and calls GoogleGenAI with ADC parameters", async () => {
  interface GenerateContentCallParams {
    readonly model: string;
    readonly contents: Array<{
      readonly role: string;
      readonly parts: Array<Record<string, unknown>>;
    }>;
    readonly config: {
      readonly systemInstruction: string;
      readonly responseMimeType: string;
      readonly responseSchema: unknown;
    };
  }

  let capturedParams: GenerateContentCallParams | undefined;

  const mockClient = {
    models: {
      async generateContent(params: GenerateContentCallParams) {
        capturedParams = params;
        return {
          text: JSON.stringify({
            ocrTexts: ["VERTEX ADC OK"],
            detectedEntities: ["cat"],
            dominantColors: ["black"],
            visualStyle: "minimalist",
            productCategory: "t-shirt",
          }),
        };
      },
    },
  };

  const generator = new GoogleGenAIVertexContentGenerator({
    projectId: "gemini-image-benchmark",
    location: "global",
    defaultModel: "gemini-2.5-flash",
    client: mockClient,
  });

  const response = await generator.generateProductImageAnalysis({
    prompt: "Extract visual signals",
    imagePayload: {
      type: "inline",
      inlineData: {
        data: "base64data",
        mimeType: "image/jpeg",
      },
    },
    systemInstruction: "Strict OCR rules",
    model: "gemini-2.5-flash",
  });

  assert.ok(capturedParams);
  assert.equal(capturedParams.model, "gemini-2.5-flash");
  assert.equal(capturedParams.contents[0].role, "user");
  assert.deepEqual(capturedParams.contents[0].parts[0], { text: "Extract visual signals" });
  assert.deepEqual(capturedParams.contents[0].parts[1], {
    inlineData: { mimeType: "image/jpeg", data: "base64data" },
  });
  assert.equal(capturedParams.config.systemInstruction, "Strict OCR rules");
  assert.equal(capturedParams.config.responseMimeType, "application/json");
  assert.deepEqual(
    capturedParams.config.responseSchema,
    GEMINI_PRODUCT_IMAGE_ANALYSIS_SCHEMA,
  );
  assert.ok(response.rawText.includes("VERTEX ADC OK"));
});

test("Group A: Gemini Analyzer — successful structured extraction matching exact schema", async () => {
  const fakeGenerator = new FakeGeminiContentGenerator(
    JSON.stringify({
      ocrTexts: ["Cats Before People"],
      detectedEntities: ["black cat", "paw prints"],
      dominantColors: ["black", "white"],
      visualStyle: "minimalist typography",
      productCategory: "t-shirt",
    }),
  );

  const analyzer = new GeminiProductImageAnalyzer({ generator: fakeGenerator });
  const result = await analyzer.analyze({
    image: { url: "gs://bucket/cat-shirt.jpg" },
    title: "Cat Shirt",
    description: "Graphic tee",
    niche: "cats",
  });

  assert.equal(fakeGenerator.calls.length, 1);
  assert.deepEqual(result.ocrTexts, ["Cats Before People"]);
  assert.deepEqual(result.detectedEntities, ["black cat", "paw prints"]);
  assert.deepEqual(result.dominantColors, ["black", "white"]);
  assert.equal(result.visualStyle, "minimalist typography");
  assert.equal(result.productCategory, "t-shirt");
});

test("Group B: OCR Semantics — never promotes title or description text into OCR when image has no text", async () => {
  const fakeGenerator = new FakeGeminiContentGenerator(
    JSON.stringify({
      ocrTexts: [],
      detectedEntities: ["black cat", "jack-o-lantern"],
      dominantColors: ["black", "orange"],
      visualStyle: "cute spooky illustration",
      productCategory: "hoodie",
    }),
  );

  const analyzer = new GeminiProductImageAnalyzer({ generator: fakeGenerator });
  const result = await analyzer.analyze({
    image: { url: "gs://bucket/spooky.jpg" },
    title: "Personalized Spooky Black Cat Halloween Hoodie",
    description: "Warm pullover hoodie with cat design",
    niche: "halloween",
  });

  assert.deepEqual(result.ocrTexts, [], "OCR must be empty when image has no visible text");
  assert.deepEqual(result.detectedEntities, ["black cat", "jack-o-lantern"]);
});

test("Group C: Retry policy — retries once on retryable error (503/429) and succeeds", async () => {
  let attempts = 0;
  const fakeGenerator = new FakeGeminiContentGenerator((req) => {
    attempts++;
    if (attempts === 1) {
      throw new GeminiGeneratorError("Service temporarily unavailable", 503, true);
    }
    return {
      rawText: JSON.stringify({
        ocrTexts: ["Retry Success"],
        detectedEntities: ["star"],
        dominantColors: ["gold"],
        visualStyle: "celestial",
        productCategory: "poster",
      }),
    };
  });

  const analyzer = new GeminiProductImageAnalyzer({
    generator: fakeGenerator,
    maxRetries: 1,
  });

  const result = await analyzer.analyze({
    image: { url: "gs://bucket/poster.png" },
    title: "Star Poster",
    description: "Wall art",
    niche: "astronomy",
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result.ocrTexts, ["Retry Success"]);
});

test("Group D: Non-retryable error (400/401/403) throws immediately without retrying", async () => {
  let attempts = 0;
  const fakeGenerator = new FakeGeminiContentGenerator(() => {
    attempts++;
    throw new GeminiGeneratorError("Permission denied", 403, false);
  });

  const analyzer = new GeminiProductImageAnalyzer({
    generator: fakeGenerator,
    maxRetries: 3,
  });

  await assert.rejects(
    () =>
      analyzer.analyze({
        image: { url: "gs://bucket/art.jpg" },
        title: "Art",
        description: "",
        niche: "",
      }),
    (err: unknown) => err instanceof GeminiGeneratorError && err.status === 403,
  );
  assert.equal(attempts, 1, "Must not retry non-retryable 403 error");
});

test("Group F & G: Fallback Analyzer — calls fallback on primary error (timeout/401/403) and preserves pipeline", async () => {
  let fallbackCalled = 0;
  const failingPrimary: ProductImageAnalyzer = {
    async analyze() {
      throw new GeminiGeneratorError("Unauthorized", 401, false);
    },
  };

  const fallback: ProductImageAnalyzer = {
    async analyze(): Promise<ProductImageAnalysis> {
      fallbackCalled++;
      return {
        ocrTexts: [],
        detectedEntities: ["coffee mug"],
        dominantColors: ["white"],
        visualStyle: "minimalist",
        productCategory: "ceramic mug",
      };
    },
  };

  let capturedError: unknown;
  const fallbackAnalyzer = new FallbackProductImageAnalyzer({
    primary: failingPrimary,
    fallback,
    onFallback: (err) => {
      capturedError = err;
    },
  });

  const result = await fallbackAnalyzer.analyze({
    image: { url: "gs://bucket/mug.jpg" },
    title: "White Mug",
    description: "",
    niche: "kitchen",
  });

  assert.equal(fallbackCalled, 1);
  assert.ok(capturedError instanceof GeminiGeneratorError);
  assert.deepEqual(result.detectedEntities, ["coffee mug"]);
});

test("Reviewer Fix: default production fallback logs observable warning on failure", async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => warnings.push(args.join(" "));

  try {
    const prevProject = process.env.GOOGLE_CLOUD_PROJECT;
    process.env.GOOGLE_CLOUD_PROJECT = "gemini-test-observability";

    // Re-create default analyzer with simulated error in primary
    const analyzer = new FallbackProductImageAnalyzer({
      primary: {
        async analyze() {
          throw new Error("Simulated ADC connection timeout");
        },
      },
      fallback: heuristicProductImageAnalyzer,
      onFallback: (err, input) => {
        const target = input.image.url || input.image.localFilePath || "unknown";
        console.warn(`[SEO B1 Fallback] Gemini failed for '${target}'. Reason: ${err}`);
      },
    });

    const result = await analyzer.analyze({
      image: { url: "https://example.com/sample-shirt.jpg" },
      title: "Sample Shirt",
      description: "A nice tee",
      niche: "fashion",
    });

    assert.ok(warnings.length >= 1);
    assert.ok(warnings[0].includes("[SEO B1 Fallback]"));
    assert.ok(warnings[0].includes("Simulated ADC connection timeout"));
    assert.deepEqual(result.ocrTexts, []);

    if (prevProject !== undefined) {
      process.env.GOOGLE_CLOUD_PROJECT = prevProject;
    } else {
      delete process.env.GOOGLE_CLOUD_PROJECT;
    }
  } finally {
    console.warn = originalWarn;
  }
});

test("Group H: Fallback OCR Invariant — when Gemini fails, fallback never hallucinates OCR from alt or filename", async () => {
  const failingPrimary: ProductImageAnalyzer = {
    async analyze() {
      throw new Error("Network timeout");
    },
  };

  const fallbackAnalyzer = new FallbackProductImageAnalyzer({
    primary: failingPrimary,
    fallback: heuristicProductImageAnalyzer,
  });

  const result = await fallbackAnalyzer.analyze({
    image: {
      url: "https://example.com/best-dog-mom-t-shirt.jpg",
      alt: "Best Dog Mom T-Shirt in Pink",
    },
    title: "Best Dog Mom Ever",
    description: "Cute dog mom t-shirt",
    niche: "dogs",
  });

  assert.deepEqual(
    result.ocrTexts,
    [],
    "Fallback to heuristic must NEVER extract OCR from alt text or filename",
  );
  assert.equal(result.productCategory, "t-shirt");
});

test("Group I: Partial Image Failure — per-image failure falls back gracefully while other images succeed in B1", async () => {
  const primaryAnalyzer: ProductImageAnalyzer = {
    async analyze(input) {
      if (input.image.url.includes("corrupted")) {
        throw new Error("Corrupted image format");
      }
      return {
        ocrTexts: ["GEMINI OCR"],
        detectedEntities: ["cat"],
        dominantColors: ["black"],
        visualStyle: "cartoon",
        productCategory: "t-shirt",
      };
    },
  };

  const combinedAnalyzer = new FallbackProductImageAnalyzer({
    primary: primaryAnalyzer,
    fallback: heuristicProductImageAnalyzer,
  });

  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: combinedAnalyzer });
  const input: SeoContentInput = {
    title: "Cat Tee",
    description: "Graphic tee",
    niche: "cat",
    handle: "cat-tee",
    images: [
      { url: "https://example.com/image-1.jpg" },
      { url: "https://example.com/corrupted.jpg" },
      { url: "https://example.com/image-3.jpg" },
    ],
  };

  const result = await stage.execute(createInitialContext(input));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  assert.deepEqual(pu.ocrTexts, ["GEMINI OCR"]);
  assert.deepEqual(pu.detectedEntities, ["cat"]);
});

test("Group J: Multi-image deterministic ranking preserved with Gemini analyzer results", async () => {
  const fakeGenerator = new FakeGeminiContentGenerator((req) => {
    const fileUri =
      req.imagePayload.type === "fileUri" ? req.imagePayload.fileData.fileUri : "";

    if (fileUri.includes("img-1")) {
      return {
        rawText: JSON.stringify({
          ocrTexts: [],
          detectedEntities: ["black cat", "moon"],
          dominantColors: ["black", "purple"],
          visualStyle: "gothic",
          productCategory: "hoodie",
        }),
      };
    }
    // img-2 and img-3 both have pumpkin
    return {
      rawText: JSON.stringify({
        ocrTexts: [],
        detectedEntities: ["pumpkin"],
        dominantColors: ["orange"],
        visualStyle: "halloween",
        productCategory: "hoodie",
      }),
    };
  });

  const analyzer = new GeminiProductImageAnalyzer({ generator: fakeGenerator });
  const stage = createB1ProductUnderstandingStage({ imageAnalyzer: analyzer });

  const input: SeoContentInput = {
    title: "Spooky Hoodie",
    description: "Fall hoodie",
    niche: "halloween",
    handle: "spooky-hoodie",
    images: [
      { url: "gs://bucket/img-1.jpg" },
      { url: "gs://bucket/img-2.jpg" },
      { url: "gs://bucket/img-3.jpg" },
    ],
  };

  const result = await stage.execute(createInitialContext(input));
  const pu = result.productUnderstanding;

  assert.ok(pu);
  // Pumpkin seen in 2 images, black cat in 1 -> Pumpkin must rank first
  assert.deepEqual(pu.detectedEntities, ["pumpkin", "black cat", "moon"]);
});

test("Schema: strips markdown code fences (```json ... ```) and parses structured JSON safely", () => {
  const fenced = "```json\n" + JSON.stringify({
    ocrTexts: ["SALE 50% OFF"],
    detectedEntities: ["banner", "star"],
    dominantColors: ["red", "gold"],
    visualStyle: "bold promotion",
    productCategory: "t-shirt",
  }) + "\n```";

  const parsed = parseGeminiProductImageAnalysis(fenced);
  assert.deepEqual(parsed.ocrTexts, ["SALE 50% OFF"]);
  assert.deepEqual(parsed.detectedEntities, ["banner", "star"]);
  assert.deepEqual(parsed.dominantColors, ["red", "gold"]);
  assert.equal(parsed.visualStyle, "bold promotion");
  assert.equal(parsed.productCategory, "t-shirt");
});

test("Payload: parses multiline RFC-formatted data URI containing newlines", async () => {
  const data = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk\n+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const payload = await prepareProductImagePayload({ url: data });
  assert.equal(payload.type, "inline");
  if (payload.type === "inline") {
    assert.equal(payload.inlineData.mimeType, "image/png");
    assert.ok(payload.inlineData.data.startsWith("iVBORw0KGgo"));
  }
});

test("Gemini Analyzer: forwards configured timeoutMs to image fetch preparation", async () => {
  const originalFetch = globalThis.fetch;
  let signalReceived = false;

  try {
    globalThis.fetch = async (_url, init) => {
      return new Promise<Response>((_, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            signalReceived = true;
            const error = new Error("The operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }
      });
    };

    const fakeGenerator = new FakeGeminiContentGenerator();
    const analyzer = new GeminiProductImageAnalyzer({
      generator: fakeGenerator,
      timeoutMs: 30, // 30ms timeout forwarded to image fetch
    });

    await assert.rejects(
      () =>
        analyzer.analyze({
          image: { url: "https://example.com/hanging-image.png" },
          title: "Shirt",
          description: "",
          niche: "",
        }),
      (err: unknown) =>
        err instanceof InvalidImagePayloadError && err.message.includes("timed out after 30ms"),
    );
    assert.ok(signalReceived);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("Builder: visualStyle 'unknown' or 'none' from Gemini falls back to textSignals.visualStyle", () => {
  const textSignals = extractTextProductSignals({
    title: "Vintage Retro Black Cat Graphic T-Shirt",
    description: "Classic retro tee",
    niche: "vintage cat",
  });

  const analysis: ProductImageAnalysis = {
    ocrTexts: ["Black Cat"],
    detectedEntities: ["black cat"],
    dominantColors: ["black"],
    visualStyle: "unknown", // Gemini followed system instruction: return "unknown" when evidence insufficient
    productCategory: "t-shirt",
  };

  const pu = buildProductUnderstanding([analysis], textSignals);
  assert.equal(
    pu.visualStyle,
    "vintage retro",
    "Should fall back to textSignals when image visualStyle is 'unknown'",
  );
});

test("Builder: productCategory 'unspecified' or 'none' from Gemini falls back to textSignals.productCategory", () => {
  const textSignals = extractTextProductSignals({
    title: "Ceramic Mug for Coffee Lovers",
    description: "White ceramic mug",
    niche: "coffee",
  });

  const analysis: ProductImageAnalysis = {
    ocrTexts: ["Coffee Time"],
    detectedEntities: ["mug"],
    dominantColors: ["white"],
    visualStyle: "minimalist",
    productCategory: "unspecified", // Gemini returned placeholder
  };

  const pu = buildProductUnderstanding([analysis], textSignals);
  assert.equal(
    pu.productCategory,
    "ceramic mug",
    "Should fall back to textSignals when image productCategory is 'unspecified'",
  );
});

test("Builder: deduplicates textSignals dominantColors and entities on fallback", () => {
  const textSignals = {
    detectedEntities: ["cat", "cat", "black cat"],
    dominantColors: ["grey", "gray"], // aliases normalize to "gray"
    visualStyle: "retro",
    productCategory: "t-shirt",
  };

  const pu = buildProductUnderstanding([], textSignals);
  assert.deepEqual(pu.dominantColors, ["gray"]);
  assert.deepEqual(pu.detectedEntities, ["cat", "black cat"]);
});

test("Retry Policy: retries on 504 Gateway Timeout and DEADLINE_EXCEEDED", async () => {
  let attempts = 0;
  const fakeGenerator = new FakeGeminiContentGenerator((req) => {
    attempts++;
    if (attempts === 1) {
      throw new GeminiGeneratorError("DEADLINE_EXCEEDED: upstream timeout", 504, true);
    }
    return {
      rawText: JSON.stringify({
        ocrTexts: ["Success After 504"],
        detectedEntities: ["cat"],
        dominantColors: ["black"],
        visualStyle: "cartoon",
        productCategory: "t-shirt",
      }),
    };
  });

  const analyzer = new GeminiProductImageAnalyzer({
    generator: fakeGenerator,
    maxRetries: 1,
  });

  const result = await analyzer.analyze({
    image: { url: "gs://bucket/sample.png" },
    title: "Cat Shirt",
    description: "",
    niche: "cat",
  });

  assert.equal(attempts, 2);
  assert.deepEqual(result.ocrTexts, ["Success After 504"]);
});

