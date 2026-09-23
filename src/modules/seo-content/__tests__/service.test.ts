import assert from "node:assert/strict";
import test from "node:test";

import type { SeoContentInput, SeoContentWebpAsset } from "../types";

import {
  createSeoContentPipelineSummary,
  getSeoContentRunner,
  runMockSeoContent,
  runSeoContent,
  runSeoContentDetailed,
  seoContentMockData,
  seoContentMockInput,
} from "..";
import * as moduleExports from "..";

test("SEO + Content baseline service produces valid output conforming to public contract", async () => {
  const result = await runSeoContent(seoContentMockInput);

  assert.ok(result.productTitle.length > 0);
  assert.ok(result.productDescription.length > 0);
  assert.match(result.productDescription, /<p>/);
  assert.ok(result.productSeoTitle.length > 0);
  assert.ok(result.productSeoTitle.length <= 70);
  assert.ok(result.productSeoDescription.length > 0);
  assert.ok(result.productSeoDescription.length <= 160);
  assert.equal(result.productHandle, seoContentMockInput.handle);
  assert.equal(result.images.length, seoContentMockInput.images.length);

  assert.equal(result.images[0].sourceUrl, seoContentMockInput.images[0].url);
  assert.equal(result.images[0].alt, seoContentMockInput.images[0].alt);
  assert.equal(result.images[0].webp.filename, `${seoContentMockInput.handle}-1.webp`);
  assert.equal(result.images[0].webp.localFilePath, seoContentMockInput.images[0].localFilePath);
  assert.equal(result.images[0].webp.url, seoContentMockInput.images[0].url);
});

test("SEO detailed runner supports alt-only processing without image binaries or local files", async () => {
  const result = await runSeoContentDetailed({
    ...seoContentMockInput,
    images: [{ url: "https://example.com/original.jpg", alt: "Original product view" }],
  }, { imageMode: "alt_only" });

  assert.equal(result.output.images.length, 1);
  assert.equal(result.output.images[0].sourceUrl, "https://example.com/original.jpg");
  assert.equal("webp" in result.output.images[0], false);
  assert.ok(result.metadata.fieldsApplied.includes("media.alt"));
  assert.ok(Array.isArray(result.metadata.approvedKeywords));
  assert.match(result.metadata.engine, /^(gemini|heuristic|mixed)$/);

  const publicSummary = createSeoContentPipelineSummary(result);
  assert.deepEqual(Object.keys(publicSummary).sort(), [
    "engine",
    "fallbackStages",
    "fieldsApplied",
    "status",
    "warnings",
  ]);
  assert.equal(JSON.stringify(publicSummary).includes("approvedEmbeddings"), false);
  assert.equal(JSON.stringify(publicSummary).includes("approvedKeywords"), false);
  assert.equal(JSON.stringify(publicSummary).includes("corpusRevision"), false);
});

test("SEO + Content baseline service handles empty images and fallback values", async () => {
  const minimalInput: SeoContentInput = {
    images: [],
    niche: "custom rugs",
    title: "Minimal Rug Title",
    description: "Minimal description text",
    handle: "",
  };

  const result = await runSeoContent(minimalInput);

  assert.ok(result.productTitle.length > 0);
  assert.ok(result.productTitle.length <= 100);
  assert.ok(result.productDescription.length > 0);
  assert.match(result.productDescription, /<p>/);
  assert.ok(result.productHandle.length > 0);
  assert.match(result.productHandle, /^[a-z0-9-]+$/);
  assert.deepEqual(result.images, []);
});

test("SEO + Content baseline service handles image fallbacks when alt and handle are empty", async () => {
  const inputWithoutAlt: SeoContentInput = {
    images: [
      {
        url: "https://example.com/asset.jpg",
      },
    ],
    niche: "general",
    title: "Test Title",
    description: "Test Description",
    handle: "",
  };

  const result = await runSeoContent(inputWithoutAlt);

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].webp.filename, `${result.productHandle}-1.webp`);
  assert.equal(result.images[0].alt, "Test Title - View 1");
  assert.equal(result.images[0].webp.localFilePath, undefined);
});

test("SEO + Content baseline service handles whitespace in handle, title, and alt safely", async () => {
  const inputWithWhitespace: SeoContentInput = {
    images: [
      {
        url: "https://example.com/asset1.jpg",
        alt: "   ",
      },
    ],
    niche: "vintage rugs",
    title: "   ",
    description: "Sample description",
    handle: "   ",
  };

  const result = await runSeoContent(inputWithWhitespace);

  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].webp.filename, `${result.productHandle}-1.webp`);
  assert.equal(result.images[0].alt, "Product image 1");
  assert.ok(result.productHandle.length > 0);
  assert.match(result.productHandle, /^[a-z0-9-]+$/);
});

test("SEO + Content mock runner returns valid mock output with customized handle", async () => {
  const customInput: SeoContentInput = {
    ...seoContentMockInput,
    handle: "custom-gothic-rug-handle",
  };

  const result = await runMockSeoContent(customInput);

  assert.equal(result.productHandle, "custom-gothic-rug-handle");
  assert.equal(result.productTitle, seoContentMockData.productTitle);
  assert.equal(result.productDescription, seoContentMockData.productDescription);
  assert.equal(result.images.length, seoContentMockData.images.length);
});

test("SEO + Content mock runner handles whitespace-only handle by falling back to fixture handle", async () => {
  const inputWithWhitespaceHandle: SeoContentInput = {
    ...seoContentMockInput,
    handle: "   ",
  };

  const result = await runMockSeoContent(inputWithWhitespaceHandle);

  assert.equal(result.productHandle, seoContentMockData.productHandle);
});

test("SEO + Content mock runner returns immutable cloned objects across multiple calls", async () => {
  const result1 = await runMockSeoContent(seoContentMockInput);
  const result2 = await runMockSeoContent(seoContentMockInput);

  assert.notEqual(result1.images, seoContentMockData.images);
  assert.notEqual(result1.images[0], seoContentMockData.images[0]);
  assert.notEqual(result1.images[0].webp, seoContentMockData.images[0].webp);

  assert.notEqual(result1.images, result2.images);
  assert.notEqual(result1.images[0], result2.images[0]);
  assert.notEqual(result1.images[0].webp, result2.images[0].webp);
});

test("SEO + Content runtime selects appropriate runner by environment", async () => {
  const mockRunner = getSeoContentRunner("mock");
  const devRunner = getSeoContentRunner("development");
  const prodRunner = getSeoContentRunner("production");

  assert.equal(mockRunner, runMockSeoContent);
  assert.equal(devRunner, runSeoContent);
  assert.equal(prodRunner, runSeoContent);
});

test("SEO + Content public contract supports SeoContentWebpAsset with binary data", () => {
  const uint8Asset: SeoContentWebpAsset = {
    filename: "test.webp",
    data: new Uint8Array([1, 2, 3]),
  };
  assert.equal(uint8Asset.filename, "test.webp");
  assert.ok(uint8Asset.data instanceof Uint8Array);

  const bufferAsset: SeoContentWebpAsset = {
    filename: "buffer.webp",
    data: Buffer.from([4, 5, 6]),
  };
  assert.equal(bufferAsset.filename, "buffer.webp");
  assert.ok(bufferAsset.data instanceof Uint8Array);
});

test("SEO + Content module exports contain no residual ModuleB references", () => {
  const exportsMap = moduleExports as Record<string, unknown>;

  assert.equal(exportsMap.runModuleB, undefined);
  assert.equal(exportsMap.getModuleBRunner, undefined);
  assert.equal(exportsMap.moduleBMockData, undefined);

  assert.equal(typeof moduleExports.runSeoContent, "function");
  assert.equal(typeof moduleExports.runMockSeoContent, "function");
  assert.equal(typeof moduleExports.getSeoContentRunner, "function");
  assert.equal(typeof moduleExports.seoContentMockData, "object");
  assert.equal(typeof moduleExports.seoContentMockInput, "object");
});
