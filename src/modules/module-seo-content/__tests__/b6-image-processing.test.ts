import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import test from "node:test";

import type { SeoContentImageInput, SeoContentInput } from "../types";
import type { SeoPipelineContext } from "../internal/domain-types";
import { createInitialContext } from "../internal/pipeline-context";
import {
  generateWebpFilename,
} from "../internal/image-processing/webp-filename-generator";
import {
  cleanAltText,
  characterLength,
  isPlaceholderAlt,
} from "../internal/image-processing/alt-text-sanitizer";
import { fitAltText } from "../internal/image-processing/alt-text-fitter";
import {
  generateAltText,
} from "../internal/image-processing/alt-text-generator";
import {
  isWebpBuffer,
  VALID_1X1_WEBP_BUFFER,
} from "../internal/image-processing/webp-validator";
import {
  DeterministicTestWebpConverter,
  UnavailableWebpConverter,
  ImageConversionUnavailableError,
} from "../internal/image-processing/webp-converter";
import {
  InMemoryImageSourceLoader,
  DefaultImageSourceLoader,
  validateSafeUrl,
} from "../internal/image-processing/image-source-loader";
import {
  MemoryImageSink,
  FileSystemImageSink,
} from "../internal/image-processing/image-artifact-sink";
import {
  DefaultImageProcessor,
} from "../internal/image-processing/image-processor";
import {
  executeB6ImageProcessing,
} from "../internal/stages/b6-image-processing";

// --- Group 1: WebP Filename Generator ---

test("B6 Filename: formats ${handle}-${index + 1}.webp correctly", () => {
  const filename = generateWebpFilename({
    productHandle: "vintage-black-cat-rug",
    index: 0,
  });
  assert.equal(filename, "vintage-black-cat-rug-1.webp");

  const filename2 = generateWebpFilename({
    productHandle: "vintage-black-cat-rug",
    index: 2,
  });
  assert.equal(filename2, "vintage-black-cat-rug-3.webp");
});

test("B6 Filename: falls back to primaryKeyword, productTitle, or product-image", () => {
  const fromKeyword = generateWebpFilename({
    primaryKeyword: "Spooky Halloween Mat",
    index: 0,
  });
  assert.equal(fromKeyword, "spooky-halloween-mat-1.webp");

  const fromTitle = generateWebpFilename({
    productTitle: "Cute Ghost Rug Collection",
    index: 1,
  });
  assert.equal(fromTitle, "cute-ghost-rug-collection-2.webp");

  const fromNothing = generateWebpFilename({
    index: 0,
  });
  assert.equal(fromNothing, "product-image-1.webp");
});

test("B6 Filename: normalizes accents, uppercase, and special chars to safe kebab-case", () => {
  const filename = generateWebpFilename({
    productHandle: "Thảm Mèo Đen Halloween! 2026",
    index: 0,
  });
  assert.equal(filename, "tham-meo-den-halloween-2026-1.webp");
});

test("B6 Filename: prevents path traversal and malicious filenames", () => {
  const malicious = generateWebpFilename({
    productHandle: "../../../etc/passwd",
    index: 0,
  });
  assert.equal(malicious, "passwd-1.webp");
  assert.doesNotMatch(malicious, /\.\./);
});

// --- Group 2: Alt Text Sanitizer & Fitter ---

test("B6 Alt Sanitizer: strips HTML tags, control chars, and URLs", () => {
  const raw = "<b>Cute cat</b> <script>alert(1)</script> https://example.com/pic.jpg \x00\x1F rug";
  const cleaned = cleanAltText(raw);
  assert.equal(cleaned, "Cute cat alert(1) rug");
  assert.doesNotMatch(cleaned, /<[^>]*>/);
  assert.doesNotMatch(cleaned, /https?:/);
});

test("B6 Alt Sanitizer: detects placeholder and filename alts", () => {
  assert.equal(isPlaceholderAlt("IMG_1234.jpg"), true);
  assert.equal(isPlaceholderAlt("dsc_0042.PNG"), true);
  assert.equal(isPlaceholderAlt("product image"), true);
  assert.equal(isPlaceholderAlt("photo"), true);
  assert.equal(isPlaceholderAlt("12345"), true);
  assert.equal(isPlaceholderAlt("   "), true);
  assert.equal(isPlaceholderAlt("Handcrafted vintage black cat rug in living room"), false);
});

test("B6 Alt Fitter: fits within character limit safely without cutting words in half", () => {
  const longText = "Personalized black cat Halloween area rug crafted with premium low-pile fabric and spooky autumn foliage for gothic homes";
  const fitted = fitAltText(longText, 60);
  assert.ok(characterLength(fitted) <= 60);
  assert.doesNotMatch(fitted, /[,;\-\s]$/);
  assert.ok(fitted.startsWith("Personalized black cat Halloween"));
});

// --- Group 3: Alt Text Generator ---

test("B6 Alt Generator: preserves meaningful sourceAlt", () => {
  const alt = generateAltText({
    sourceAlt: "Vintage distressed black cat Halloween rug styled in living room",
    productTitle: "Test Title",
    imageIndex: 0,
  });
  assert.equal(alt, "Vintage distressed black cat Halloween rug styled in living room");
});

test("B6 Alt Generator: ignores placeholder sourceAlt and uses primary keyword + entities", () => {
  const alt = generateAltText({
    sourceAlt: "IMG_9821.jpg",
    sourceTitle: "Area Rug",
    primaryKeyword: "vintage black cat rug",
    entities: ["pumpkin", "autumn botanicals"],
    visualStyle: "gothic",
    imageIndex: 0,
  });
  assert.equal(
    alt,
    "Vintage black cat rug featuring pumpkin and autumn botanicals in gothic style",
  );
});

test("B6 Alt Generator: filters out generic stop words and unspecified styles", () => {
  const alt = generateAltText({
    sourceTitle: "Rug Mat",
    primaryKeyword: "black cat rug",
    entities: ["general", "item", "pumpkin"],
    visualStyle: "unspecified",
    imageIndex: 0,
  });
  assert.equal(alt, "Black cat rug featuring pumpkin");
  assert.doesNotMatch(alt, /unspecified/);
  assert.doesNotMatch(alt, /general/);
});

test("B6 Alt Generator: enforces gallery uniqueness when duplicate alts occur", () => {
  const firstAlt = generateAltText({
    sourceTitle: "Area Rug",
    primaryKeyword: "black cat rug",
    imageIndex: 0,
    previousAlts: [],
  });
  assert.equal(firstAlt, "Black cat rug");

  const secondAlt = generateAltText({
    sourceTitle: "Area Rug",
    primaryKeyword: "black cat rug",
    imageIndex: 1,
    previousAlts: [firstAlt],
  });
  assert.equal(secondAlt, "Black cat rug, view 2");
});

test("B6 Alt Generator: falls back to Product image ${index + 1} when product has no title", () => {
  const alt = generateAltText({
    sourceTitle: "   ",
    imageIndex: 0,
  });
  assert.equal(alt, "Product image 1");
});

test("B6 Alt Generator: enforces <= 125 hard character ceiling", () => {
  const veryLongPrimary = "Extraordinary ultra large oversized personalized vintage gothic black cat halloween indoor living room area rug mat runner";
  const alt = generateAltText({
    sourceTitle: "Some Rug",
    primaryKeyword: veryLongPrimary,
    entities: ["autumn moon", "spooky bats", "jack-o-lantern"],
    visualStyle: "dark vintage aesthetic",
    imageIndex: 0,
    maxLength: 125,
  });
  assert.ok(characterLength(alt) <= 125);
});

// --- Group 4: WebP Validator & Converters ---

test("B6 WebP Validator: verifies valid WebP signature RIFF/WEBP", () => {
  assert.equal(isWebpBuffer(VALID_1X1_WEBP_BUFFER), true);
  assert.equal(isWebpBuffer(Buffer.from("NOT_WEBP_DATA_AT_ALL")), false);
  assert.equal(isWebpBuffer(Buffer.alloc(5)), false);
});

test("B6 WebP Converter: DeterministicTestWebpConverter returns valid WebP buffer", async () => {
  const converter = new DeterministicTestWebpConverter();
  const output = await converter.convert(Buffer.from("mock-jpeg-input"));
  assert.ok(isWebpBuffer(output));
  assert.equal(output.length, 42);
});

test("B6 WebP Converter: UnavailableWebpConverter throws ImageConversionUnavailableError", async () => {
  const converter = new UnavailableWebpConverter();
  await assert.rejects(
    async () => converter.convert(Buffer.from("some-bytes")),
    ImageConversionUnavailableError,
  );
});

// --- Group 5: Image Source Loader & Artifact Sink ---

test("B6 Source Loader: InMemoryImageSourceLoader resolves mock buffers offline", async () => {
  const customBuf = Buffer.from("custom-image-data");
  const loader = new InMemoryImageSourceLoader({
    "https://example.com/cat.jpg": customBuf,
  });
  const loaded = await loader.load({ url: "https://example.com/cat.jpg" });
  assert.equal(loaded.buffer, customBuf);
});

test("B6 Source Loader: DefaultImageSourceLoader parses data URIs safely", async () => {
  const base64Pixel = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
  const dataUri = `data:image/png;base64,${base64Pixel}`;
  const loader = new DefaultImageSourceLoader();
  const loaded = await loader.load({ url: dataUri });
  assert.ok(loaded.buffer.length > 0);
  assert.equal(loaded.mimeType, "image/png");
});

test("B6 Source Loader: DefaultImageSourceLoader blocks localhost and SSRF private addresses", async () => {
  const loader = new DefaultImageSourceLoader();
  await assert.rejects(
    async () => loader.load({ url: "http://localhost:8080/image.jpg" }),
    /blocked/,
  );
  await assert.rejects(
    async () => loader.load({ url: "http://127.0.0.1/admin.png" }),
    /blocked/,
  );
  await assert.rejects(
    async () => loader.load({ url: "http://192.168.1.100/router.png" }),
    /blocked/,
  );
});

test("B6 Artifact Sink: FileSystemImageSink writes atomically and guards against path traversal", async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "b6-sink-test-"));
  try {
    const sink = new FileSystemImageSink(tmpDir);
    const location = await sink.save("test-image-1.webp", VALID_1X1_WEBP_BUFFER);

    assert.ok(location.localFilePath);
    const exists = await fs.stat(location.localFilePath);
    assert.equal(exists.size, 42);

    // Path traversal attempt
    await assert.rejects(
      async () => sink.save("../../escaped.webp", VALID_1X1_WEBP_BUFFER),
      /Path traversal detected/,
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

// --- Group 6: DefaultImageProcessor & Edge Cases ---

test("B6 Processor: empty images input returns empty array with clean metadata", async () => {
  const processor = new DefaultImageProcessor();
  const result = await processor.process({
    images: [],
    productTitle: "Test",
    productHandle: "test",
    entities: [],
  });

  assert.deepEqual(result.processedImages, []);
  assert.equal(result.metadata.totalImages, 0);
  assert.equal(result.metadata.convertedImages, 0);
  assert.equal(result.metadata.failedConversions, 0);
});

test("B6 Processor: preserves input order across multiple images", async () => {
  const processor = new DefaultImageProcessor({
    sourceLoader: new InMemoryImageSourceLoader(),
    webpConverter: new DeterministicTestWebpConverter(),
    artifactSink: new MemoryImageSink(),
  });

  const images: SeoContentImageInput[] = [
    { url: "https://example.com/img-a.jpg", alt: "First View" },
    { url: "https://example.com/img-b.jpg", alt: "Second View" },
    { url: "https://example.com/img-c.jpg", alt: "Third View" },
  ];

  const result = await processor.process({
    images,
    productTitle: "Test Product",
    productHandle: "test-product",
    entities: [],
  });

  assert.equal(result.processedImages.length, 3);
  assert.equal(result.processedImages[0].sourceUrl, "https://example.com/img-a.jpg");
  assert.equal(result.processedImages[1].sourceUrl, "https://example.com/img-b.jpg");
  assert.equal(result.processedImages[2].sourceUrl, "https://example.com/img-c.jpg");

  assert.equal(result.processedImages[0].webp.filename, "test-product-1.webp");
  assert.equal(result.processedImages[1].webp.filename, "test-product-2.webp");
  assert.equal(result.processedImages[2].webp.filename, "test-product-3.webp");

  assert.ok(isWebpBuffer(result.processedImages[0].webp.data!));
  assert.equal(result.metadata.convertedImages, 3);
});

test("B6 Processor: lenient mode preserves entries without fake webp.data when conversion fails", async () => {
  const processor = new DefaultImageProcessor({
    sourceLoader: new InMemoryImageSourceLoader(),
    webpConverter: new UnavailableWebpConverter(),
    strictConversion: false,
  });

  const images: SeoContentImageInput[] = [
    { url: "https://example.com/photo.jpg", alt: "A nice photo" },
  ];

  const result = await processor.process({
    images,
    productTitle: "Cool Item",
    productHandle: "cool-item",
    entities: [],
  });

  assert.equal(result.processedImages.length, 1);
  assert.equal(result.processedImages[0].webp.filename, "cool-item-1.webp");
  assert.equal(result.processedImages[0].webp.data, undefined); // Invariant: never fake WebP bytes!
  assert.equal(result.metadata.failedConversions, 1);
  assert.equal(result.metadata.issues[0].code, "conversion_failed");
});

test("B6 Processor: strict mode throws when conversion fails", async () => {
  const processor = new DefaultImageProcessor({
    sourceLoader: new InMemoryImageSourceLoader(),
    webpConverter: new UnavailableWebpConverter(),
    strictConversion: true,
  });

  const images: SeoContentImageInput[] = [
    { url: "https://example.com/photo.jpg", alt: "A nice photo" },
  ];

  await assert.rejects(
    async () =>
      processor.process({
        images,
        productTitle: "Cool Item",
        productHandle: "cool-item",
        entities: [],
      }),
    ImageConversionUnavailableError,
  );
});

// --- Group 7: Stage B6 Execution & Context Invariants ---

test("B6 Stage: executes and evolves context without mutating source input", async () => {
  const sourceInput: SeoContentInput = {
    images: [
      { url: "https://example.com/item.jpg", alt: "Original Handbag" },
    ],
    niche: "leather bags",
    title: "Black Leather Handbag",
    description: "Sample description",
    handle: "black-leather-handbag",
  };

  const initial = createInitialContext(sourceInput);
  const updatedContext = await executeB6ImageProcessing(initial, {
    imageProcessor: new DefaultImageProcessor({
      sourceLoader: new InMemoryImageSourceLoader(),
      webpConverter: new DeterministicTestWebpConverter(),
      artifactSink: new MemoryImageSink(),
    }),
  });

  assert.ok(updatedContext.imageResult);
  assert.equal(updatedContext.imageResult.processedImages.length, 1);
  assert.equal(
    updatedContext.imageResult.processedImages[0].webp.filename,
    "black-leather-handbag-1.webp",
  );
  assert.ok(isWebpBuffer(updatedContext.imageResult.processedImages[0].webp.data!));

  // Invariant: source reference is strictly preserved
  assert.equal(updatedContext.source, initial.source);
  assert.ok(Object.isFrozen(updatedContext));
});

test("B6 Stage: preserves B5 contentResult and B4 corpusRevision without side effects", async () => {
  const sourceInput: SeoContentInput = {
    images: [{ url: "https://example.com/item.jpg" }],
    niche: "rugs",
    title: "Cat Rug",
    description: "Description",
    handle: "cat-rug",
  };

  const initial = createInitialContext(sourceInput);
  const contextWithB5 = {
    ...initial,
    contentResult: {
      productTitle: "Grounded Cat Rug Title",
      productDescription: "<p>Description</p>",
      productSeoTitle: "Grounded Cat Rug Title",
      productSeoDescription: "SEO description",
      productHandle: "grounded-cat-rug-handle",
    },
    contentGenerationMetadata: {
      primaryKeyword: "vintage cat rug",
      secondaryKeywords: ["halloween cat mat"],
      supportingKeywords: [],
      targetedKeywords: ["vintage cat rug"],
      generator: "heuristic" as const,
      corpusRevision: 42,
    },
  };

  const finalContext = await executeB6ImageProcessing(contextWithB5, {
    imageProcessor: new DefaultImageProcessor({
      sourceLoader: new InMemoryImageSourceLoader(),
      webpConverter: new DeterministicTestWebpConverter(),
    }),
  });

  assert.equal(finalContext.contentGenerationMetadata?.corpusRevision, 42);
  assert.equal(
    finalContext.imageResult?.processedImages[0].webp.filename,
    "grounded-cat-rug-handle-1.webp",
  );
  assert.equal(
    finalContext.imageResult?.processedImages[0].alt,
    "Vintage cat rug",
  );
});

// --- Group 8: Reviewer Confirmations (Boundary & Security) ---

test("B6 Reviewer Confirmation 1: Duplicate long alt (~125 chars) remains unique AND <= 125 chars", () => {
  // Construct a base alt that is near 125 chars
  const longPrimary = "Ultra premium luxury handmade gothic vintage distressed black cat halloween indoor living room area rug mat runner decor";
  
  const alt1 = generateAltText({
    sourceTitle: "Black Cat Rug",
    primaryKeyword: longPrimary,
    imageIndex: 0,
    previousAlts: [],
    maxLength: 125,
  });

  const alt2 = generateAltText({
    sourceTitle: "Black Cat Rug",
    primaryKeyword: longPrimary,
    imageIndex: 1,
    previousAlts: [alt1],
    maxLength: 125,
  });

  assert.notEqual(alt1, alt2, "Alt 1 and Alt 2 must be unique in gallery");
  assert.ok(characterLength(alt1) <= 125, `Alt 1 length (${characterLength(alt1)}) must be <= 125`);
  assert.ok(characterLength(alt2) <= 125, `Alt 2 length (${characterLength(alt2)}) must be <= 125`);
  assert.ok(alt2.includes("view 2") || alt2.includes("#2"), "Alt 2 must contain uniqueness suffix");
});

test("B6 Reviewer Confirmation 2: SSRF protection validates destination on redirect and blocks private IP", () => {
  // Test validateSafeUrl blocks private and localhost addresses
  assert.throws(
    () => validateSafeUrl("http://localhost:3000/test.png"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("http://127.0.0.1:8080/internal.webp"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("http://192.168.1.1/admin.jpg"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("http://10.0.0.1/secret.png"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("http://172.16.0.1/private.png"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("http://server.local/image.jpg"),
    /blocked/,
  );
  assert.throws(
    () => validateSafeUrl("ftp://example.com/image.png"),
    /Invalid protocol/,
  );

  // Safe public URLs pass
  assert.doesNotThrow(() => validateSafeUrl("https://example.com/images/cat.jpg"));
  assert.doesNotThrow(() => validateSafeUrl("http://cdn.shopify.com/products/item.png"));
});

