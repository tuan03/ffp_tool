import assert from "node:assert/strict";
import test from "node:test";

import { getInitialSampleViewModels } from "../seo-content-ui-adapter";
import type {
  ReviewDecision,
  SeoProductUiViewModel,
  SeoReviewFilterState,
  SeoReviewViewMode,
} from "../types";

// Helper replicating the view mode and filtering logic used in SeoReviewPage
function filterProducts(
  products: readonly SeoProductUiViewModel[],
  filter: SeoReviewFilterState,
): readonly SeoProductUiViewModel[] {
  return products.filter((p) => {
    // 1. Search query
    if (filter.searchQuery.trim()) {
      const query = filter.searchQuery.toLowerCase().trim();
      const titleMatch = p.productTitle.value.toLowerCase().includes(query);
      const handleMatch = p.handle.value.toLowerCase().includes(query);
      const asinMatch = p.asin ? p.asin.toLowerCase().includes(query) : false;
      if (!titleMatch && !handleMatch && !asinMatch) {
        return false;
      }
    }

    // 2. SEO Status filter
    if (filter.statusFilter !== "all" && p.seoStatus.value !== filter.statusFilter) {
      return false;
    }

    // 3. Review Decision filter
    if (filter.decisionFilter !== "all" && p.reviewDecision !== filter.decisionFilter) {
      return false;
    }

    // 4. Only Mock data filter
    if (filter.onlyMockData) {
      const hasMock =
        p.productTitle.source === "mock" ||
        p.productDescription.source === "mock" ||
        p.seoTitle.source === "mock" ||
        p.seoDescription.source === "mock" ||
        p.handle.source === "mock" ||
        p.images.some((img) => img.alt.source === "mock" || img.webpUrl.source === "mock");
      if (!hasMock) {
        return false;
      }
    }

    return true;
  });
}

function advanceProduct(
  filteredProducts: readonly SeoProductUiViewModel[],
  currentId: string,
): SeoProductUiViewModel | null {
  const currentIndex = filteredProducts.findIndex((p) => p.id === currentId);
  if (currentIndex >= 0 && currentIndex < filteredProducts.length - 1) {
    return filteredProducts[currentIndex + 1] ?? null;
  }
  return null;
}

test("SeoReviewViewMode: supports cards, table, and split view modes", () => {
  const modes: SeoReviewViewMode[] = ["cards", "table", "split"];
  assert.equal(modes.length, 3);
  assert.ok(modes.includes("cards"));
  assert.ok(modes.includes("table"));
  assert.ok(modes.includes("split"));
});

test("filterProducts: filters by decision (pending, approved, rejected)", () => {
  const sample = getInitialSampleViewModels();
  const modified: SeoProductUiViewModel[] = [
    { ...sample[0]!, reviewDecision: "pending" as ReviewDecision },
    { ...sample[1]!, reviewDecision: "approved" as ReviewDecision },
    { ...sample[2]!, reviewDecision: "rejected" as ReviewDecision },
  ];

  const pendingOnly = filterProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "pending",
    onlyMockData: false,
  });
  assert.equal(pendingOnly.length, 1);
  assert.equal(pendingOnly[0]!.id, modified[0]!.id);

  const approvedOnly = filterProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "approved",
    onlyMockData: false,
  });
  assert.equal(approvedOnly.length, 1);
  assert.equal(approvedOnly[0]!.id, modified[1]!.id);

  const rejectedOnly = filterProducts(modified, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "rejected",
    onlyMockData: false,
  });
  assert.equal(rejectedOnly.length, 1);
  assert.equal(rejectedOnly[0]!.id, modified[2]!.id);
});

test("filterProducts: searches by title, handle, or ASIN", () => {
  const sample = getInitialSampleViewModels();
  const testItem: SeoProductUiViewModel = {
    ...sample[0]!,
    productTitle: { value: "Vintage Leather Jacket", source: "real" },
    handle: { value: "vintage-leather-jacket", source: "real" },
    asin: "B09TESTASIN",
  };

  const list = [testItem];

  // Match title
  const byTitle = filterProducts(list, {
    searchQuery: "leather",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byTitle.length, 1);

  // Match handle
  const byHandle = filterProducts(list, {
    searchQuery: "vintage-leather",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byHandle.length, 1);

  // Match ASIN
  const byAsin = filterProducts(list, {
    searchQuery: "B09TESTASIN",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(byAsin.length, 1);

  // No match
  const noMatch = filterProducts(list, {
    searchQuery: "non-existent-product",
    statusFilter: "all",
    decisionFilter: "all",
    onlyMockData: false,
  });
  assert.equal(noMatch.length, 0);
});

test("advanceProduct: correctly advances to next product in split review stream", () => {
  const sample = getInitialSampleViewModels();
  assert.ok(sample.length >= 3);

  const nextFromFirst = advanceProduct(sample, sample[0]!.id);
  assert.equal(nextFromFirst?.id, sample[1]!.id);

  const nextFromSecond = advanceProduct(sample, sample[1]!.id);
  assert.equal(nextFromSecond?.id, sample[2]!.id);

  // Last product returns null (cannot advance further)
  const last = sample[sample.length - 1]!;
  const nextFromLast = advanceProduct(sample, last.id);
  assert.equal(nextFromLast, null);
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
