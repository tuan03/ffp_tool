import assert from "node:assert/strict";
import test from "node:test";

import { filterSeoProducts, findNextProductInList } from "../review-navigation";
import { sanitizeHtmlDescription } from "../sanitize-html";
import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import { buildProductZoomImages } from "../zoom-image-helper";
import type {
  ReviewDecision,
  SeoProductUiViewModel,
  SeoReviewViewMode,
  ZoomImageItem,
} from "../types";

test("SeoReviewViewMode: supports cards, table, and split view modes", () => {
  const modes: SeoReviewViewMode[] = ["cards", "table", "split"];
  assert.equal(modes.length, 3);
  assert.ok(modes.includes("cards"));
  assert.ok(modes.includes("table"));
  assert.ok(modes.includes("split"));
});

test("filterSeoProducts: filters by decision (pending, approved, rejected)", () => {
  const sample = getInitialSampleViewModels();
  const modified: SeoProductUiViewModel[] = [
    { ...sample[0]!, reviewDecision: "pending" as ReviewDecision },
    { ...sample[1]!, reviewDecision: "approved" as ReviewDecision },
    { ...sample[2]!, reviewDecision: "rejected" as ReviewDecision },
  ];

  const pendingOnly = filterSeoProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "pending",
    onlyMockData: false,
  });
  assert.equal(pendingOnly.length, 1);
  assert.equal(pendingOnly[0]!.id, modified[0]!.id);

  const approvedOnly = filterSeoProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "approved",
    onlyMockData: false,
  });
  assert.equal(approvedOnly.length, 1);
  assert.equal(approvedOnly[0]!.id, modified[1]!.id);

  const rejectedOnly = filterSeoProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "rejected",
    onlyMockData: false,
  });
  assert.equal(rejectedOnly.length, 1);
  assert.equal(rejectedOnly[0]!.id, modified[2]!.id);
});

test("filterSeoProducts: searches by title, handle, or ASIN", () => {
  const sample = getInitialSampleViewModels();
  const testItem: SeoProductUiViewModel = {
    ...sample[0]!,
    productTitle: { value: "Vintage Leather Jacket", source: "real" },
    handle: { value: "vintage-leather-jacket", source: "real" },
    asin: "B09TESTASIN",
  };

  const list = [testItem];

  // Match title
  const byTitle = filterSeoProducts(list, {
    searchQuery: "leather",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byTitle.length, 1);

  // Match handle
  const byHandle = filterSeoProducts(list, {
    searchQuery: "vintage-leather",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byHandle.length, 1);

  // Match ASIN
  const byAsin = filterSeoProducts(list, {
    searchQuery: "B09TESTASIN",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byAsin.length, 1);

  // No match
  const noMatch = filterSeoProducts(list, {
    searchQuery: "non-existent-product",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(noMatch.length, 0);
});

test("findNextProductInList: advances through sequential review stream without getting stuck", () => {
  const sample = getInitialSampleViewModels();
  assert.ok(sample.length >= 3);

  // 1. Advance from first item -> returns second item
  const nextFromFirst = findNextProductInList(sample, sample[0]!.id);
  assert.equal(nextFromFirst?.id, sample[1]!.id);

  // 2. Advance from middle item -> returns third item
  const nextFromSecond = findNextProductInList(sample, sample[1]!.id);
  assert.equal(nextFromSecond?.id, sample[2]!.id);

  // 3. Advance from the last product -> falls back to previous item so user is never stuck
  const lastIndex = sample.length - 1;
  const last = sample[lastIndex]!;
  const fallbackFromLast = findNextProductInList(sample, last.id);
  assert.equal(fallbackFromLast?.id, sample[lastIndex - 1]!.id);

  // 4. Advance when item was already filtered out / not in list -> returns first available item
  const outOfListId = "non-existent-id";
  const fallbackOutOfList = findNextProductInList(sample, outOfListId);
  assert.equal(fallbackOutOfList?.id, sample[0]!.id);

  // 5. Sole remaining item in list -> returns null (all reviewed)
  const singleItem = [sample[0]!];
  const nextFromSingle = findNextProductInList(singleItem, sample[0]!.id);
  assert.equal(nextFromSingle, null);

  // 6. Empty list -> returns null
  const emptyResult = findNextProductInList([], "any-id");
  assert.equal(emptyResult, null);
});

test("table expand logic: toggle single and toggle all", () => {
  const sample = getInitialSampleViewModels();
  const ids = sample.map((s) => s.id);

  let expanded = new Set<string>();

  // Toggle first
  if (expanded.has(ids[0]!)) {
    expanded.delete(ids[0]!);
  } else {
    expanded.add(ids[0]!);
  }
  assert.equal(expanded.size, 1);
  assert.ok(expanded.has(ids[0]!));

  // Toggle all expand
  if (sample.every((p) => expanded.has(p.id))) {
    expanded = new Set();
  } else {
    expanded = new Set(sample.map((p) => p.id));
  }
  assert.equal(expanded.size, sample.length);

  // Toggle all collapse
  if (sample.every((p) => expanded.has(p.id))) {
    expanded = new Set();
  } else {
    expanded = new Set(sample.map((p) => p.id));
  }
  assert.equal(expanded.size, 0);
});

test("sanitizeHtmlDescription: strips malicious scripts, frames, and event handlers", () => {
  // 1. Plain text remains intact
  const plain = "This is a simple plain text description.";
  assert.equal(sanitizeHtmlDescription(plain), plain);

  // 2. Safe semantic HTML remains intact
  const safeHtml = "<p>Premium <strong>handmade</strong> leather bag with <em>brass</em> buckles.</p>";
  const sanitizedSafe = sanitizeHtmlDescription(safeHtml);
  assert.ok(sanitizedSafe.includes("<strong>handmade</strong>"));
  assert.ok(sanitizedSafe.includes("<em>brass</em>"));

  // 3. Malicious <script> tag is completely stripped
  const maliciousScript = "<p>Great product</p><script>alert('pwned')</script>";
  const cleanScript = sanitizeHtmlDescription(maliciousScript);
  assert.ok(!cleanScript.includes("<script"));
  assert.ok(!cleanScript.includes("alert"));
  assert.ok(cleanScript.includes("<p>Great product</p>"));

  // 4. Malicious <iframe> tag is removed
  const maliciousIframe = '<p>Description</p><iframe src="https://evil.com"></iframe>';
  const cleanIframe = sanitizeHtmlDescription(maliciousIframe);
  assert.ok(!cleanIframe.includes("<iframe"));
  assert.ok(!cleanIframe.includes("evil.com"));

  // 5. Dangerous inline event handlers (onerror, onclick, onload) are stripped
  const inlineXss = '<img src="x" onerror="alert(1)" /><button onclick="steal()">Click</button>';
  const cleanHandlers = sanitizeHtmlDescription(inlineXss);
  assert.ok(!cleanHandlers.includes("onerror"));
  assert.ok(!cleanHandlers.includes("onclick"));
  assert.ok(!cleanHandlers.includes("alert(1)"));

  // 6. javascript: pseudo-protocol is sanitized
  const jsLink = '<a href="javascript:alert(1)">Click for free coupon</a>';
  const cleanLink = sanitizeHtmlDescription(jsLink);
  assert.ok(!cleanLink.includes("javascript:alert"));
});

test("buildProductZoomImages: correctly extracts zoomable items from product gallery", () => {
  const sample = getInitialSampleViewModels();
  const product = sample[0]!;

  const zoomImages = buildProductZoomImages(product);
  assert.ok(Array.isArray(zoomImages));
  assert.equal(zoomImages.length, product.images.length);

  zoomImages.forEach((item: ZoomImageItem, i: number) => {
    const original = product.images[i];
    assert.ok(original);
    assert.equal(item.url, original.previewUrl.value || original.webpUrl.value);
    assert.equal(item.altText, original.alt.value);
    assert.equal(item.title, product.productTitle.value);
  });

  // Gracefully handles empty or null products
  assert.deepEqual(buildProductZoomImages(null), []);
  assert.deepEqual(buildProductZoomImages(undefined), []);
  assert.deepEqual(buildProductZoomImages({ ...product, images: [] }), []);
});

test("ImageZoom navigation bounds: wraps around correctly", () => {
  const totalImages = 4;
  const prevFromZero = 0 > 0 ? 0 - 1 : totalImages - 1;
  assert.equal(prevFromZero, 3);

  const nextFromEnd = 3 < totalImages - 1 ? 3 + 1 : 0;
  assert.equal(nextFromEnd, 0);

  const nextFromMiddle = 1 < totalImages - 1 ? 1 + 1 : 0;
  assert.equal(nextFromMiddle, 2);
});
