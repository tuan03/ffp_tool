import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  handlePinterestPodDirectShopifySyncHttpRequest,
  handlePinterestPodSeoHttpRequest,
} from "../pinterest-pod-handler";
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

test("handlePinterestPodSeoHttpRequest: safely sanitizes path-traversal in workflowId", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "ffp_pod_sec_test_"));

  try {
    const maliciousDeliverables: PinterestPodDeliverables = {
      ...sampleDeliverables,
      workflowId: "../../evil_path",
    };

    const mockSeoRunner = async (input: SeoContentInput): Promise<SeoContentOutput> => ({
      productTitle: input.title,
      productDescription: "<p>safe</p>",
      productHandle: "safe",
      productSeoTitle: input.title,
      productSeoDescription: "safe",
      images: [],
    });

    const { req, res, getResult } = createMockReqRes({
      method: "POST",
      body: maliciousDeliverables,
    });

    await handlePinterestPodSeoHttpRequest(req, res, {
      outputDir: tempDir,
      seoRunner: mockSeoRunner,
    });

    const result = getResult();
    assert.equal(result.status, 200);

    // Verify sanitized folder was created INSIDE tempDir and not outside
    const sanitizedDir = path.join(tempDir, "______evil_path");
    assert.ok(fs.existsSync(sanitizedDir), "Sanitized directory should be created inside tempDir");
    assert.ok(fs.existsSync(path.join(sanitizedDir, "seo_handoff_payload.json")));

    // Verify nothing escaped outside tempDir
    const escapedFile = path.resolve(tempDir, "..", "evil_path");
    assert.ok(!fs.existsSync(escapedFile), "File should never escape outputDir");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("handlePinterestPodDirectShopifySyncHttpRequest: rejects non-POST request with 405", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "GET",
    url: "/api/pinterest-pod/sync-shopify",
  });

  await handlePinterestPodDirectShopifySyncHttpRequest(req, res);
  const result = getResult();
  assert.equal(result.status, 405);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodDirectShopifySyncHttpRequest: rejects unauthorized request when authToken configured", async () => {
  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/pinterest-pod/sync-shopify",
    headers: { "content-type": "application/json" },
    body: sampleDeliverables,
  });

  await handlePinterestPodDirectShopifySyncHttpRequest(req, res, { authToken: "secret-token" });
  const result = getResult();
  assert.equal(result.status, 401);
  assert.equal(result.body.success, false);
});

test("handlePinterestPodDirectShopifySyncHttpRequest: successfully synchronizes deliverables to Shopify with dispatcher", async () => {
  const dispatchedRequests: Array<{ operation: string; storeId?: string; mode?: string; requestId?: string; payload?: unknown }> = [];

  const mockDispatcher = {
    async dispatch(req: { operation: string; storeId?: string; mode?: "preview" | "apply"; requestId?: string; payload?: unknown }) {
      dispatchedRequests.push(req);
      return {
        success: true,
        data: {
          product: {
            id: "gid://shopify/Product/999111",
            handle: "gothic-skull-moon-area-rug-prod",
            title: "Gothic Skull Moon Area Rug",
          },
        },
      };
    },
  };

  const payloadWithVariants = {
    ...sampleDeliverables,
    storeId: "chillgen",
    variants: [
      { title: '36" x 60"', price: "49.99", compareAtPrice: "59.99", sku: "RUG-36-60" },
      { title: '48" x 72"', price: "79.99", compareAtPrice: "89.99", sku: "RUG-48-72" },
    ],
  };

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/pinterest-pod/sync-shopify",
    body: payloadWithVariants,
  });

  await handlePinterestPodDirectShopifySyncHttpRequest(req, res, { dispatcher: mockDispatcher });
  const result = getResult();
  assert.equal(result.status, 200);
  assert.equal(result.body.success, true);
  assert.equal(result.body.count, 1);
  assert.equal(dispatchedRequests.length, 1);

  const sentReq = dispatchedRequests[0];
  assert.equal(sentReq.operation, "products.create");
  assert.equal(sentReq.storeId, "chillgen");
  assert.equal(sentReq.mode, "apply");
  assert.ok(sentReq.requestId && sentReq.requestId.startsWith("direct_sync_"));

  const payloadObj = sentReq.payload as { product: { title: string; variants: Array<{ price: string; compareAtPrice?: string; sku?: string; optionValues?: unknown[] }> } };
  assert.equal(payloadObj.product.title, "Gothic Skull Moon Area Rug");
  assert.equal(payloadObj.product.variants.length, 2);
  assert.equal(payloadObj.product.variants[0].price, "49.99");
  assert.equal(payloadObj.product.variants[0].compareAtPrice, "59.99");
  assert.equal(payloadObj.product.variants[0].sku, "RUG-36-60");

  const products = result.body.products as Array<Record<string, unknown>>;
  assert.equal(products.length, 1);
  assert.equal(products[0].designId, "design_alpha");
  assert.equal(products[0].title, "Gothic Skull Moon Area Rug");
  assert.equal(products[0].shopifyProductId, "gid://shopify/Product/999111");
  assert.equal(products[0].handle, "gothic-skull-moon-area-rug-prod");
  assert.equal(products[0].url, "https://bbjttb-n9.myshopify.com/products/gothic-skull-moon-area-rug-prod");
  assert.equal(products[0].status, "ACTIVE");
});

test("handlePinterestPodDirectShopifySyncHttpRequest: records ERROR status when dispatcher fails", async () => {
  const failingDispatcher = {
    async dispatch() {
      return {
        success: false,
        error: { message: "Shopify API throttle error" },
      };
    },
  };

  const { req, res, getResult } = createMockReqRes({
    method: "POST",
    url: "/api/pinterest-pod/sync-shopify",
    body: sampleDeliverables,
  });

  await handlePinterestPodDirectShopifySyncHttpRequest(req, res, { dispatcher: failingDispatcher });
  const result = getResult();
  assert.equal(result.status, 200);
  const products = result.body.products as Array<Record<string, unknown>>;
  assert.equal(products.length, 1);
  assert.equal(products[0].status, "ERROR");
  assert.equal(products[0].error, "Shopify API throttle error");
});


