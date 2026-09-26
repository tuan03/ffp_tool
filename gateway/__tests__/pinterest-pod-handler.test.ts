import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { handlePinterestPodSeoHttpRequest } from "../pinterest-pod-handler";
import type { PinterestPodDeliverables } from "../../src/modules/pinterest-pod";
import type { SeoContentInput, SeoContentOutput } from "../../src/modules/seo-content";

function createMockReqRes(options: {
  method: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}): {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  getResult: () => { status: number; body: Record<string, unknown> };
} {
  const bodyString = typeof options.body === "string" ? options.body : JSON.stringify(options.body ?? {});
  const req = Readable.from([Buffer.from(bodyString)]) as unknown as http.IncomingMessage;
  req.method = options.method;
  req.url = options.url || "/api/pinterest-pod/handover-seo";
  req.headers = options.headers || { "content-type": "application/json" };

  let statusCode = 200;
  let responseData = "";
  const headersObj: Record<string, string> = {};

  const res = {
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
    setHeader(key: string, val: string) {
      headersObj[key.toLowerCase()] = val;
    },
    end(chunk?: unknown) {
      if (chunk) {
        responseData += Buffer.isBuffer(chunk) ? chunk.toString("utf-8") : String(chunk);
      }
    },
    destroy() {},
  } as unknown as http.ServerResponse;

  return {
    req,
    res,
    getResult: () => {
      let parsed = {};
      try {
        parsed = JSON.parse(responseData);
      } catch {
        parsed = { raw: responseData };
      }
      return { status: statusCode, body: parsed as Record<string, unknown> };
    },
  };
}

const sampleDeliverables: PinterestPodDeliverables = {
  workflowId: "test_job_123",
  success: true,
  productType: "rug",
  totalProduced: 1,
  items: [
    {
      designId: "design_alpha",
      sourceCandidateId: "cand_001",
      productType: "rug",
      originalPinTitle: "Gothic Skull Moon Area Rug",
      trendKeywords: ["gothic rug", "celestial rug"],
      printMaster: {
        cmykUrl: "https://example.com/print_master.png",
        rgbUrl: "https://example.com/print_master_rgb.png",
        widthPx: 3600,
        heightPx: 3600,
        dpi: 300,
      },
      cutoutProduct: {
        transparentUrl: "https://example.com/cutout.png",
        whiteBgUrl: "https://example.com/cutout_white.png",
      },
      composedMockups: [
        {
          referenceImageId: "ref_1",
          mockupUrl: "https://example.com/mockup_1.jpg",
          detectedSceneType: "living_room",
          detectedSceneDescription: "Moody living room setting",
        },
      ],
    },
  ],
};

test("handlePinterestPodSeoHttpRequest: rejects non-POST request with 405", async () => {
  const { req, res, getResult } = createMockReqRes({ method: "GET" });
  await handlePinterestPodSeoHttpRequest(req, res);
  const result = getResult();
  assert.equal(result.status, 405);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodSeoHttpRequest: rejects unauthorized request when authToken configured", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    headers: { "content-type": "application/json" },
    body: sampleDeliverables,
  });
  await handlePinterestPodSeoHttpRequest(req, res, { authToken: "secret_gateway_token" });
  const result = getResult();
  assert.equal(result.status, 401);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodSeoHttpRequest: rejects invalid JSON body with 400", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    body: "{ invalid json string",
  });
  await handlePinterestPodSeoHttpRequest(req, res);
  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodSeoHttpRequest: rejects payload missing items array with 400", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    body: { workflowId: "no_items" },
  });
  await handlePinterestPodSeoHttpRequest(req, res);
  const result = getResult();
  assert.equal(result.status, 400);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodSeoHttpRequest: successfully processes deliverables and returns viewModels", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffp_pod_test_"));

  try {
    const mockSeoRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => {
      return {
        productTitle: `Enhanced ${input.title}`,
        productDescription: `<p>SEO optimized description for ${input.title}</p>`,
        productHandle: "enhanced-gothic-skull-moon-area-rug",
        productSeoTitle: `Enhanced ${input.title} - Best Quality`,
        productSeoDescription: `Shop ${input.title} with high quality finish.`,
        images: input.images.map((img) => ({
          sourceUrl: img.url,
          alt: `Alt text for ${input.title}`,
          webp: {
            filename: "enhanced.webp",
            url: "/api/assets/enhanced.webp",
          },
        })),
      };
    };

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: sampleDeliverables,
    });

    await handlePinterestPodSeoHttpRequest(req, res, {
      outputDir: tempDir,
      seoRunner: mockSeoRunner,
    });

    const result = getResult();
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.workflowId, "test_job_123");
    assert.equal(result.body.count, 1);
    assert.equal(result.body.printMasterCount, 1);
    assert.equal(result.body.approvedMockupCount, 1);

    // Verify backup file was created
    const savedHandoffFile = path.join(tempDir, "test_job_123", "seo_handoff_payload.json");
    assert.ok(fs.existsSync(savedHandoffFile), "Backup file seo_handoff_payload.json should exist");
    const savedContent = JSON.parse(fs.readFileSync(savedHandoffFile, "utf8"));
    assert.equal(savedContent.workflowId, "test_job_123");

    // Verify viewModels returned
    const viewModels = result.body.viewModels as Array<{ id: string; productTitle: { value: string }; sourceOrigin: string }>;
    assert.ok(Array.isArray(viewModels));
    assert.equal(viewModels.length, 1);
    assert.equal(viewModels[0].id, "design_alpha");
    assert.equal(viewModels[0].productTitle.value, "Enhanced Gothic Skull Moon Area Rug");
    assert.equal(viewModels[0].sourceOrigin, "pinterest_pod");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
