import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AutoSeoPage } from "../ui/AutoSeoPage";
import { MockAutoSeoClient } from "../mocks/runner";
import { AutoSeoToolbar } from "../ui/components/AutoSeoToolbar";
import type { AutoSeoToolbarProps } from "../ui/components/AutoSeoToolbar";
import {
  clearVisibleProductsSelection,
  filterAutoSeoProducts,
  selectAllVisibleProducts,
} from "../ui/components/product-filter";
import { ProductSelectionTable } from "../ui/components/ProductSelectionTable";
import type { ProductSelectionTableProps } from "../ui/components/ProductSelectionTable";
import type { AutoSeoEligibilityFilter } from "../ui/smart-batch";

import {
  extractProductSeoVersion,
  type AutoSeoCollectionOption,
  type AutoSeoEligibilityItem,
  type ProductReviewDecision,
  type ShopifyProductForAutoSeoUi,
  type ShopifyStatusFilter,
} from "../types";

const mockProducts: readonly ShopifyProductForAutoSeoUi[] = [
  {
    id: "gid://shopify/Product/101",
    title: "Eco Ceramic Mug",
    handle: "eco-ceramic-mug",
    status: "ACTIVE",
    images: [{ url: "https://example.com/mug.jpg", altText: "Mug" }],
    tags: ["ceramic", "eco"],
  },
  {
    id: "gid://shopify/Product/102",
    title: "Cotton T-Shirt",
    handle: "cotton-t-shirt",
    status: "ACTIVE",
    images: [],
    tags: ["cotton", "apparel"],
  },
  {
    id: "gid://shopify/Product/103",
    title: "Handmade Bamboo Bowl",
    handle: "handmade-bamboo-bowl",
    status: "DRAFT",
    images: [],
    tags: ["bamboo", "kitchen"],
  },
];

interface RenderResult {
  captured: React.ReactElement<{ children: React.ReactNode[] }>;
  html: string;
}

function renderTable(props: {
  products: readonly ShopifyProductForAutoSeoUi[];
  selectedProductIds: readonly string[];
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  statusFilter?: ShopifyStatusFilter;
  onStatusFilterChange?: (status: ShopifyStatusFilter) => void;
  filteredProducts?: readonly ShopifyProductForAutoSeoUi[];
  onToggleSelect?: (id: string) => void;
  onOpenDetail?: (product: ShopifyProductForAutoSeoUi) => void;
  eligibilityItems?: readonly AutoSeoEligibilityItem[];
  eligibilityFilter?: AutoSeoEligibilityFilter;
  typeFilter?: string;
  onTypeFilterChange?: (type: string) => void;
  collectionFilter?: string;
  onCollectionFilterChange?: (collection: string) => void;
  storeCollections?: readonly AutoSeoCollectionOption[];
  asinQuery?: string;
  startDate?: string;
  endDate?: string;
  onResetAllFilters?: () => void;
}): RenderResult {
  let captured: React.ReactElement<{ children: React.ReactNode[] }> | null = null;

  function TestHarness(): React.JSX.Element {
    captured = ProductSelectionTable({
      products: props.products,
      selectedProductIds: props.selectedProductIds,
      searchQuery: props.searchQuery,
      onSearchQueryChange: props.onSearchQueryChange,
      statusFilter: props.statusFilter,
      onStatusFilterChange: props.onStatusFilterChange,
      typeFilter: props.typeFilter,
      onTypeFilterChange: props.onTypeFilterChange,
      collectionFilter: props.collectionFilter,
      onCollectionFilterChange: props.onCollectionFilterChange,
      storeCollections: props.storeCollections,
      filteredProducts: props.filteredProducts,
      onToggleSelect: props.onToggleSelect ?? (() => {}),
      onOpenDetail: props.onOpenDetail ?? (() => {}),
      eligibilityItems: props.eligibilityItems,
      eligibilityFilter: props.eligibilityFilter,
      asinQuery: props.asinQuery,
      startDate: props.startDate,
      endDate: props.endDate,
      onResetAllFilters: props.onResetAllFilters,
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    return captured;
  }

  const html = renderToStaticMarkup(React.createElement(TestHarness));
  return { captured: captured!, html };
}

interface CellProps {
  onClick?: (e: { stopPropagation(): void }) => void;
  children?: React.ReactNode;
}

interface LabelProps {
  onClick?: unknown;
  children?: React.ReactNode;
}

interface InputProps {
  type?: string;
  checked?: boolean;
  onChange?: () => void;
  onClick?: unknown;
}

interface ButtonProps {
  type?: string;
  onClick?: () => void;
  title?: string;
  children?: React.ReactNode;
}

interface TableRowElements {
  tr: React.ReactElement<{ onClick(): void; children: React.ReactNode[] }>;
  checkboxTd: React.ReactElement<CellProps>;
  checkboxLabel: React.ReactElement<LabelProps>;
  checkboxInput: React.ReactElement<InputProps>;
  cells: React.ReactElement[];
}

function assertElement<P>(node: unknown): React.ReactElement<P> {
  if (!React.isValidElement<P>(node)) {
    throw new Error("Expected valid ReactElement");
  }
  return node;
}

function extractFirstRowElements(captured: React.ReactElement<{ children: React.ReactNode[] }>): TableRowElements {
  const rootDivChildren = React.Children.toArray(captured.props.children);
  const tableContainer = assertElement<{ children: React.ReactNode }>(rootDivChildren[1]);
  const table = assertElement<{ children: React.ReactNode[] }>(tableContainer.props.children);
  const tableChildren = React.Children.toArray(table.props.children);
  const tbody = assertElement<{ children: React.ReactNode[] }>(tableChildren[1]);
  const rows = React.Children.toArray(tbody.props.children);
  const tr = assertElement<{ onClick(): void; children: React.ReactNode[] }>(rows[0]);
  const cells = React.Children.toArray(tr.props.children) as React.ReactElement[];

  const checkboxTd = assertElement<CellProps>(cells[0]);
  const checkboxLabel = assertElement<LabelProps>(checkboxTd.props.children);
  const checkboxInput = assertElement<InputProps>(checkboxLabel.props.children);

  return {
    tr,
    checkboxTd,
    checkboxLabel,
    checkboxInput,
    cells,
  };
}

test("ProductSelectionTable: single checkbox change triggers onToggleSelect exactly once per event across 10 clicks", () => {
  const toggleCalls: string[] = [];
  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    onToggleSelect: (id) => toggleCalls.push(id),
  });

  const { checkboxInput } = extractFirstRowElements(captured);

  // Trigger checkbox change 10 times to verify exactly 1 toggle per trigger
  for (let i = 0; i < 10; i++) {
    checkboxInput.props.onChange?.();
  }

  assert.equal(toggleCalls.length, 10, "Each change event must invoke onToggleSelect exactly once");
  assert.ok(toggleCalls.every((id) => id === "gid://shopify/Product/101"));
});

test("AutoSeoToolbar: renders smart batch sizes, counts, and next-batch action", () => {
  const html = renderToStaticMarkup(React.createElement(AutoSeoToolbar, {
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 120,
    selectedCount: 0,
    visibleProductsCount: 120,
    onLoadProducts: () => {},
    onSelectAll: () => {},
    onClearSelection: () => {},
    onRunAutoSeo: () => {},
    batchSize: 50,
    onBatchSizeChange: () => {},
    onSelectNextBatch: () => {},
    eligibilityCounts: {
      never_processed: 70,
      changed: 10,
      retry: 2,
      current: 30,
      active: 8,
    },
  }));

  for (const size of [10, 20, 50, 100]) {
    assert.ok(html.includes(`value="${size}"`));
  }
  assert.ok(html.includes("Chọn 50 sản phẩm tiếp theo"));
  assert.ok(html.includes("Cần SEO: 82"));
  assert.ok(html.includes("Đã SEO: 30"));
  assert.ok(html.includes("Đang xử lý: 8"));
});

test("ProductSelectionTable: filters needs-SEO products and renders localized eligibility badges", () => {
  const eligibilityItems: readonly AutoSeoEligibilityItem[] = [
    { productId: mockProducts[0]!.id, state: "never_processed", reason: "NO_HISTORY" },
    { productId: mockProducts[1]!.id, state: "current", reason: "UP_TO_DATE" },
    { productId: mockProducts[2]!.id, state: "retry", reason: "LAST_DISPATCH_FAILED" },
  ];
  const filtered = filterAutoSeoProducts(mockProducts, {
    searchQuery: "",
    statusFilter: "all",
    eligibilityFilter: "needs_seo",
    eligibilityItems,
  });
  assert.deepEqual(filtered.map(product => product.id), [mockProducts[0]!.id, mockProducts[2]!.id]);

  const { html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    eligibilityItems,
    eligibilityFilter: "all",
  });
  assert.ok(html.includes("Chưa SEO"));
  assert.ok(html.includes("Đã SEO"));
  assert.ok(html.includes("Thử lại"));
});

test("ProductSelectionTable & filterAutoSeoProducts: filters by active (Đang xử lý) and current (Đã SEO)", () => {
  const eligibilityItems: readonly AutoSeoEligibilityItem[] = [
    { productId: mockProducts[0]!.id, state: "never_processed", reason: "NO_HISTORY" },
    { productId: mockProducts[1]!.id, state: "active", reason: "ACTIVE_DISPATCH" },
    { productId: mockProducts[2]!.id, state: "current", reason: "UP_TO_DATE" },
  ];

  // 1. Filter by active
  const filteredActive = filterAutoSeoProducts(mockProducts, {
    searchQuery: "",
    statusFilter: "all",
    eligibilityFilter: "active",
    eligibilityItems,
  });
  assert.deepEqual(filteredActive.map(p => p.id), [mockProducts[1]!.id]);

  // 2. Filter by current
  const filteredCurrent = filterAutoSeoProducts(mockProducts, {
    searchQuery: "",
    statusFilter: "all",
    eligibilityFilter: "current",
    eligibilityItems,
  });
  assert.deepEqual(filteredCurrent.map(p => p.id), [mockProducts[2]!.id]);

  // 3. ProductSelectionTable renders all 4 filter tabs with correct live counts
  const { html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    eligibilityItems,
    eligibilityFilter: "active",
  });
  assert.ok(html.includes("⚡ Cần SEO (1)"));
  assert.ok(html.includes("🟣 Đang xử lý (1)"));
  assert.ok(html.includes("🟢 Đã SEO (1)"));
  assert.ok(html.includes("Tất cả (3)"));
});

test("AutoSeoToolbar: renders interactive eligibility badges with correct counts", () => {
  const toolbar = AutoSeoToolbar({
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 3,
    selectedCount: 0,
    onLoadProducts: () => {},
    onRunAutoSeo: () => {},
    eligibilityCounts: {
      never_processed: 10,
      changed: 5,
      current: 20,
      active: 15,
      retry: 2,
    },
    eligibilityFilter: "active",
    onEligibilityFilterChange: () => {},
  });

  const html = renderToStaticMarkup(React.createElement(() => toolbar));
  assert.ok(html.includes("Cần SEO: 17"));
  assert.ok(html.includes("Đã SEO: 20"));
  assert.ok(html.includes("Đang xử lý: 15"));
  assert.ok(html.includes("Đang lọc: Đang xử lý"));
});

test("ProductSelectionTable: checkbox td.onClick only stops propagation and does NOT call onToggleSelect", () => {
  const toggleCalls: string[] = [];
  let propagationStopped = false;

  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    onToggleSelect: (id) => toggleCalls.push(id),
  });

  const { checkboxTd } = extractFirstRowElements(captured);

  // Simulate click on td (which previously had onToggleSelect inside it)
  checkboxTd.props.onClick?.({
    stopPropagation: () => {
      propagationStopped = true;
    },
  });

  assert.equal(propagationStopped, true, "td.onClick must stop row propagation");
  assert.equal(toggleCalls.length, 0, "td.onClick must NOT call onToggleSelect");
});

test("ProductSelectionTable: checkbox label and input have NO duplicate onClick handlers", () => {
  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });

  const { checkboxLabel, checkboxInput } = extractFirstRowElements(captured);

  assert.equal(checkboxLabel.props.onClick, undefined, "label must not have an onClick handler");
  assert.equal(checkboxInput.props.onClick, undefined, "input must not have an onClick handler");
  assert.equal(typeof checkboxInput.props.onChange, "function", "input.onChange must be the sole trigger");
});

test("ProductSelectionTable: row click triggers onOpenDetail while checkbox cell click prevents it", () => {
  const openedProducts: ShopifyProductForAutoSeoUi[] = [];

  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    onOpenDetail: (p) => openedProducts.push(p),
  });

  const { tr, checkboxTd } = extractFirstRowElements(captured);

  // Row click outside controls opens detail
  tr.props.onClick();
  assert.equal(openedProducts.length, 1);
  assert.equal(openedProducts[0]?.id, "gid://shopify/Product/101");

  // Checkbox cell click stops propagation so onOpenDetail is not triggered
  let stopPropagationCalled = false;
  checkboxTd.props.onClick?.({
    stopPropagation: () => {
      stopPropagationCalled = true;
    },
  });
  assert.equal(stopPropagationCalled, true, "checkboxTd.onClick must call stopPropagation");
});

test("ProductSelectionTable: does NOT render 'Thao tác' or 'Quyết định' headers in the table", () => {
  const { html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });

  assert.equal(html.includes(">Thao tác</th>"), false, "Table must NOT have Thao tác header");
  assert.equal(html.includes(">Quyết định</th>"), false, "Table must NOT have Quyết định header");
});

test("ProductSelectionTable: rows contain exactly 7 cells without action buttons or decision badge", () => {
  const { captured, html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });

  const { cells } = extractFirstRowElements(captured);
  assert.equal(cells.length, 7, "Table row must contain exactly 7 columns (no decision or action columns)");
  assert.equal(html.includes("✓ Duyệt"), false, "Must not contain Duyệt button");
  assert.equal(html.includes("✎ Sửa"), false, "Must not contain Sửa button");
  assert.equal(html.includes("Draft"), true, "Draft status tag remains for DRAFT products, but not action button");
  assert.equal(html.includes("✕ Bỏ"), false, "Must not contain Bỏ button");
  assert.equal(html.includes("Chờ duyệt"), false, "Must not contain Chờ duyệt badge");
  assert.equal(html.includes("Đã duyệt"), false, "Must not contain Đã duyệt badge");
});

test("ProductSelectionTable: renders checked state matching selectedProductIds", () => {
  const { captured: unselectedTree } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });
  const unselectedRow = extractFirstRowElements(unselectedTree);
  assert.equal(unselectedRow.checkboxInput.props.checked, false);

  const { captured: selectedTree } = renderTable({
    products: mockProducts,
    selectedProductIds: ["gid://shopify/Product/101"],
  });
  const selectedRow = extractFirstRowElements(selectedTree);
  assert.equal(selectedRow.checkboxInput.props.checked, true);
});

test("ProductSelectionTable: filter header does NOT render 'Quyết định:' filter row", () => {
  const { html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });
  assert.equal(html.includes("Quyết định:"), false, "Filter header must NOT contain 'Quyết định:' row");
  assert.equal(html.includes("Cần sửa"), false, "Must NOT contain 'Cần sửa' filter tab");
  assert.equal(html.includes("Bỏ qua"), false, "Must NOT contain 'Bỏ qua' filter tab");
});

test("ProductSelectionTable: selection state transitions match user workflow requirements", () => {
  // Simulates AutoSeoPage state management logic with ProductSelectionTable
  let selectedProductIds: string[] = [];

  const handleToggleSelect = (productId: string): void => {
    selectedProductIds = selectedProductIds.includes(productId)
      ? selectedProductIds.filter((id) => id !== productId)
      : [...selectedProductIds, productId];
  };

  const handleSelectAll = (): void => {
    selectedProductIds = mockProducts.map((p) => p.id);
  };

  const handleClearSelection = (): void => {
    selectedProductIds = [];
  };

  const handleApprove = (productId: string): void => {
    if (!selectedProductIds.includes(productId)) {
      selectedProductIds = [...selectedProductIds, productId];
    }
  };

  const handleMarkDraft = (productId: string): void => {
    selectedProductIds = selectedProductIds.filter((id) => id !== productId);
  };

  const handleSkip = (productId: string): void => {
    selectedProductIds = selectedProductIds.filter((id) => id !== productId);
  };

  // 1. Initial state is empty
  assert.equal(selectedProductIds.length, 0);

  // 2. Select product 101 -> count = 1
  handleToggleSelect("gid://shopify/Product/101");
  assert.deepEqual(selectedProductIds, ["gid://shopify/Product/101"]);

  // 3. Select product 102 -> count = 2
  handleToggleSelect("gid://shopify/Product/102");
  assert.deepEqual(selectedProductIds, ["gid://shopify/Product/101", "gid://shopify/Product/102"]);

  // 4. Toggle product 101 again -> unselected, count = 1
  handleToggleSelect("gid://shopify/Product/101");
  assert.deepEqual(selectedProductIds, ["gid://shopify/Product/102"]);

  // 5. Chọn tất cả -> all 3 products selected
  handleSelectAll();
  assert.equal(selectedProductIds.length, 3);
  assert.deepEqual(selectedProductIds, [
    "gid://shopify/Product/101",
    "gid://shopify/Product/102",
    "gid://shopify/Product/103",
  ]);

  // 6. Bỏ chọn -> empty
  handleClearSelection();
  assert.equal(selectedProductIds.length, 0);

  // 7. Duyệt product 101 -> becomes selected
  handleApprove("gid://shopify/Product/101");
  assert.deepEqual(selectedProductIds, ["gid://shopify/Product/101"]);

  // 8. Draft product 101 -> becomes unselected
  handleMarkDraft("gid://shopify/Product/101");
  assert.equal(selectedProductIds.length, 0);

  // 9. Select 102 then Skip -> becomes unselected
  handleToggleSelect("gid://shopify/Product/102");
  assert.deepEqual(selectedProductIds, ["gid://shopify/Product/102"]);
  handleSkip("gid://shopify/Product/102");
  assert.equal(selectedProductIds.length, 0);
});

test("ProductSelectionTable: renders empty state when product list is empty", () => {
  const { html } = renderTable({
    products: [],
    selectedProductIds: [],
  });

  assert.ok(html.includes("Chưa có sản phẩm nào được tải"));
});

test("ProductSelectionTable: status filter ACTIVE shows only ACTIVE products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  const filtered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });

  assert.equal(filtered.length, 2);
  assert.ok(filtered.every((p) => p.status === "ACTIVE"));
  assert.deepEqual(
    filtered.map((p) => p.id),
    ["gid://shopify/Product/101", "gid://shopify/Product/102"],
  );

  const { html } = renderTable({
    products,
    selectedProductIds: [],
    statusFilter: "ACTIVE",
  });
  assert.ok(html.includes("Eco Ceramic Mug"));
  assert.ok(html.includes("Cotton T-Shirt"));
  assert.ok(!html.includes("Handmade Bamboo Bowl"));
  assert.ok(!html.includes("Vintage Denim Jacket"));
});

test("ProductSelectionTable: status filter DRAFT shows only DRAFT products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  const filtered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "DRAFT",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "gid://shopify/Product/103");
  assert.equal(filtered[0]?.status, "DRAFT");

  const { html } = renderTable({
    products,
    selectedProductIds: [],
    statusFilter: "DRAFT",
  });
  assert.ok(!html.includes("Eco Ceramic Mug"));
  assert.ok(!html.includes("Cotton T-Shirt"));
  assert.ok(html.includes("Handmade Bamboo Bowl"));
  assert.ok(!html.includes("Vintage Denim Jacket"));
});

test("ProductSelectionTable: status filter ARCHIVED shows only ARCHIVED products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  const filtered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ARCHIVED",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "gid://shopify/Product/104");
  assert.equal(filtered[0]?.status, "ARCHIVED");

  const { html } = renderTable({
    products,
    selectedProductIds: [],
    statusFilter: "ARCHIVED",
  });
  assert.ok(!html.includes("Eco Ceramic Mug"));
  assert.ok(!html.includes("Cotton T-Shirt"));
  assert.ok(!html.includes("Handmade Bamboo Bowl"));
  assert.ok(html.includes("Vintage Denim Jacket"));
});

test("ProductSelectionTable: status + search filters combine correctly", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Eco Bamboo Straw",
      handle: "eco-bamboo-straw",
      status: "DRAFT",
      images: [],
    },
  ];

  // Search "eco" matches product 101 (ACTIVE) and 104 (DRAFT).
  // With statusFilter ACTIVE, only 101 should remain.
  const filtered = filterAutoSeoProducts(products, {
    searchQuery: "eco",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "gid://shopify/Product/101");
  assert.equal(filtered[0]?.title, "Eco Ceramic Mug");
});

test("ProductSelectionTable: status + decision filters combine correctly", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "DRAFT",
      images: [],
    },
  ];

  const decisions: Record<string, ProductReviewDecision> = {
    "gid://shopify/Product/101": "approved",
    "gid://shopify/Product/102": "needs_edit",
    "gid://shopify/Product/104": "approved",
  };

  // Status ACTIVE + Decision approved => only product 101 (product 104 is approved but DRAFT)
  const filtered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "approved",
    decisions,
    selectedProductIds: [],
  });

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0]?.id, "gid://shopify/Product/101");

  // Status ACTIVE + Decision selected => only selected ACTIVE products
  const filteredSelected = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "selected",
    decisions,
    selectedProductIds: ["gid://shopify/Product/102", "gid://shopify/Product/104"],
  });

  assert.equal(filteredSelected.length, 1);
  assert.equal(filteredSelected[0]?.id, "gid://shopify/Product/102");
});

test("AutoSeo Selection: Select All with no filters selects all visible products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = mockProducts;
  let selectedProductIds: string[] = [];

  const filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds,
  });

  // Batch Select All semantics via selectAllVisibleProducts helper
  selectedProductIds = selectAllVisibleProducts(selectedProductIds, filteredProducts);

  assert.equal(selectedProductIds.length, 3);
  assert.deepEqual(selectedProductIds, [
    "gid://shopify/Product/101",
    "gid://shopify/Product/102",
    "gid://shopify/Product/103",
  ]);
});

test("AutoSeo Selection: Select All under ACTIVE filter selects only ACTIVE visible products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = mockProducts;
  let selectedProductIds: string[] = [];

  const filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds,
  });

  // Batch Select All semantics via selectAllVisibleProducts helper
  selectedProductIds = selectAllVisibleProducts(selectedProductIds, filteredProducts);

  assert.equal(selectedProductIds.length, 2);
  assert.deepEqual(selectedProductIds, [
    "gid://shopify/Product/101",
    "gid://shopify/Product/102",
  ]);
  assert.ok(!selectedProductIds.includes("gid://shopify/Product/103"));
});

test("AutoSeo Selection: Select All preserves selections outside current filter", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = mockProducts;
  // Product 103 (DRAFT) is already selected
  let selectedProductIds: string[] = ["gid://shopify/Product/103"];

  // Filter to ACTIVE (displays 101 and 102)
  const filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds,
  });

  // Batch Select All semantics via selectAllVisibleProducts helper (union semantics)
  selectedProductIds = selectAllVisibleProducts(selectedProductIds, filteredProducts);

  // Both ACTIVE products (101, 102) plus the previously selected DRAFT product (103) are selected
  assert.equal(selectedProductIds.length, 3);
  assert.ok(selectedProductIds.includes("gid://shopify/Product/103"));
  assert.ok(selectedProductIds.includes("gid://shopify/Product/101"));
  assert.ok(selectedProductIds.includes("gid://shopify/Product/102"));
});

test("AutoSeo Selection: Clear Selection under ACTIVE filter removes only visible ACTIVE products", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = mockProducts;
  // Products 101 (ACTIVE) and 103 (DRAFT) are selected
  let selectedProductIds: string[] = [
    "gid://shopify/Product/101",
    "gid://shopify/Product/103",
  ];

  // Filter to ACTIVE (displays 101, 102)
  const filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds,
  });

  // Batch Clear Selection semantics via clearVisibleProductsSelection helper
  selectedProductIds = clearVisibleProductsSelection(selectedProductIds, filteredProducts);

  // Product 101 (visible ACTIVE) is removed, product 103 (DRAFT) remains selected
  assert.ok(!selectedProductIds.includes("gid://shopify/Product/101"));
  assert.ok(selectedProductIds.includes("gid://shopify/Product/103"));
});

test("AutoSeo Selection: Clear Selection preserves selected DRAFT/ARCHIVED products outside filter", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  // 101 (ACTIVE), 103 (DRAFT), 104 (ARCHIVED) are selected
  let selectedProductIds: string[] = [
    "gid://shopify/Product/101",
    "gid://shopify/Product/103",
    "gid://shopify/Product/104",
  ];

  // Filter to ACTIVE
  const filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds,
  });

  // Clear Selection for visible ACTIVE products via clearVisibleProductsSelection helper
  selectedProductIds = clearVisibleProductsSelection(selectedProductIds, filteredProducts);

  // Product 101 removed, but 103 (DRAFT) and 104 (ARCHIVED) remain selected
  assert.equal(selectedProductIds.length, 2);
  assert.deepEqual(selectedProductIds, [
    "gid://shopify/Product/103",
    "gid://shopify/Product/104",
  ]);
});

test("AutoSeo Selection: filtering to 'Đã chọn' then clearing visible products updates correctly", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = mockProducts;
  let selectedProductIds: string[] = [
    "gid://shopify/Product/101",
    "gid://shopify/Product/102",
  ];

  // Filter to "selected"
  let filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "selected",
    decisions: {},
    selectedProductIds,
  });
  assert.equal(filteredProducts.length, 2);

  // Clear visible products via clearVisibleProductsSelection helper
  selectedProductIds = clearVisibleProductsSelection(selectedProductIds, filteredProducts);
  assert.equal(selectedProductIds.length, 0);

  // Re-filtering with updated selection
  filteredProducts = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "all",
    decisionFilter: "selected",
    decisions: {},
    selectedProductIds,
  });
  assert.equal(filteredProducts.length, 0);
});

test("ProductSelectionTable & Toolbar: visible product count is correct", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  const { html: tableHtml } = renderTable({
    products,
    selectedProductIds: [],
    statusFilter: "ACTIVE",
  });
  // 2 active out of 4 total products
  assert.ok(tableHtml.includes("Hiển thị 2 / 4 sản phẩm"));

  // AutoSeoToolbar rendering count badges
  const toolbarHtml = renderToStaticMarkup(
    React.createElement(AutoSeoToolbar, {
      isLoadingProducts: false,
      isRunningAutoSeo: false,
      totalProductsCount: 4,
      selectedCount: 2,
      visibleProductsCount: 2,
      onLoadProducts: () => {},
      onSelectAll: () => {},
      onClearSelection: () => {},
      onRunAutoSeo: () => {},
    }),
  );
  assert.ok(toolbarHtml.includes("Đã chọn:"));
  assert.ok(toolbarHtml.includes("Bỏ chọn"));
  assert.ok(toolbarHtml.includes("Run Auto SEO (2)"));
});

test("ProductSelectionTable: status filter counts reflect total loaded products before filter", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    ...mockProducts,
    {
      id: "gid://shopify/Product/104",
      title: "Vintage Denim Jacket",
      handle: "vintage-denim-jacket",
      status: "ARCHIVED",
      images: [],
    },
  ];

  // When filtered to ACTIVE, the status filter tabs still show counts across ALL products
  const { html } = renderTable({
    products,
    selectedProductIds: [],
    statusFilter: "ACTIVE",
  });

  assert.ok(html.includes("Tất cả (4)"));
  assert.ok(html.includes("Active (2)"));
  assert.ok(html.includes("Draft (1)"));
  assert.ok(html.includes("Archived (1)"));
});

test("AutoSeoToolbar: enables Run Auto SEO and clear action only when items are selected", () => {
  // Case 1: 0 items selected -> Run Auto SEO is disabled, '✕ Bỏ chọn' is omitted
  const toolbarZero = AutoSeoToolbar({
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 4,
    selectedCount: 0,
    visibleProductsCount: 0,
    onLoadProducts: () => {},
    onClearSelection: () => {},
    onRunAutoSeo: () => {},
  });

  const zeroHtml = renderToStaticMarkup(React.createElement(() => toolbarZero));
  assert.ok(zeroHtml.includes("Đã chọn:"));
  assert.ok(!zeroHtml.includes("✕ Bỏ chọn"));
  assert.ok(zeroHtml.includes("disabled"));

  // Case 2: 2 items selected -> Run Auto SEO is enabled and displays count, '✕ Bỏ chọn' is rendered
  let cleared = false;
  const toolbarPositive = AutoSeoToolbar({
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 4,
    selectedCount: 2,
    visibleProductsCount: 3,
    onLoadProducts: () => {},
    onClearSelection: () => {
      cleared = true;
    },
    onRunAutoSeo: () => {},
  });

  const posHtml = renderToStaticMarkup(React.createElement(() => toolbarPositive));
  assert.ok(posHtml.includes("Run Auto SEO (2)"));
  assert.ok(posHtml.includes("✕ Bỏ chọn"));
  assert.ok(posHtml.includes("Đã chọn:"));
});

test("AutoSeoToolbar: enables SEO lại only for selected synced products", () => {
  const disabledHtml = renderToStaticMarkup(React.createElement(AutoSeoToolbar, {
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 2,
    selectedCount: 1,
    reSeoCount: 0,
    onLoadProducts: () => undefined,
    onRunAutoSeo: () => undefined,
    onReSeo: () => undefined,
  }));
  assert.match(disabledHtml, /SEO lại/);
  assert.match(disabledHtml, /<button type="button" disabled="" title="Tạo bản SEO mới/);

  const enabledHtml = renderToStaticMarkup(React.createElement(AutoSeoToolbar, {
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 2,
    selectedCount: 1,
    reSeoCount: 1,
    onLoadProducts: () => undefined,
    onRunAutoSeo: () => undefined,
    onReSeo: () => undefined,
  }));
  assert.match(enabledHtml, /SEO lại \(1\)/);
  assert.match(enabledHtml, /<button type="button" title="Tạo bản SEO mới/);
});

test("filterAutoSeoProducts: matches status case-insensitively ('active' matches 'ACTIVE')", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/201",
      title: "Lowercase Active Product",
      handle: "lowercase-active",
      status: "active",
    },
    {
      id: "gid://shopify/Product/202",
      title: "Mixed Case Draft Product",
      handle: "mixed-draft",
      status: "Draft",
    },
  ];

  const activeFiltered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "ACTIVE",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });
  assert.equal(activeFiltered.length, 1);
  assert.equal(activeFiltered[0]?.id, "gid://shopify/Product/201");

  const draftFiltered = filterAutoSeoProducts(products, {
    searchQuery: "",
    statusFilter: "DRAFT",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });
  assert.equal(draftFiltered.length, 1);
  assert.equal(draftFiltered[0]?.id, "gid://shopify/Product/202");
});

test("filterAutoSeoProducts: safely handles nullish or missing product properties without error", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/301",
      title: undefined as unknown as string,
      handle: undefined as unknown as string,
      status: undefined,
      tags: undefined,
    },
    {
      id: "gid://shopify/Product/302",
      title: "Valid Title",
      handle: "valid-handle",
      status: "ACTIVE",
    },
  ];

  // Should not throw TypeError on search
  const searched = filterAutoSeoProducts(products, {
    searchQuery: "valid",
    statusFilter: "all",
    decisionFilter: "all",
    decisions: {},
    selectedProductIds: [],
  });
  assert.equal(searched.length, 1);
  assert.equal(searched[0]?.id, "gid://shopify/Product/302");
});

test("AutoSeoPage: binds toolbar counts and product selection table correctly", () => {
  let capturedTree: React.ReactElement<{ children: React.ReactNode[] }> | null = null;

  function PageHarness(): React.JSX.Element {
    const tree = AutoSeoPage({
      client: new MockAutoSeoClient(),
      initialProducts: mockProducts,
      initialSelectedProductIds: ["gid://shopify/Product/103"],
    });
    capturedTree = tree as React.ReactElement<{ children: React.ReactNode[] }>;
    return tree;
  }

  const html = renderToStaticMarkup(React.createElement(PageHarness));
  assert.ok(html.includes("Auto SEO Product Selection"));

  const children = React.Children.toArray(capturedTree!.props.children);
  const toolbarElement = children.find(
    (c): c is React.ReactElement<AutoSeoToolbarProps> =>
      React.isValidElement(c) && typeof c.type === "function" && c.type.name === "AutoSeoToolbar",
  );
  assert.ok(toolbarElement, "AutoSeoToolbar must be rendered by AutoSeoPage");
  assert.equal(toolbarElement.props.totalProductsCount, 3);
  assert.equal(toolbarElement.props.selectedCount, 1);
  assert.equal(toolbarElement.props.visibleProductsCount, 3);

  const tableElement = children.find(
    (c): c is React.ReactElement<ProductSelectionTableProps> =>
      React.isValidElement(c) && typeof c.type === "function" && c.type.name === "ProductSelectionTable",
  );
  assert.ok(tableElement, "ProductSelectionTable must be rendered by AutoSeoPage");
  assert.equal(tableElement.props.products.length, 3);
  assert.equal(tableElement.props.statusFilter, "all");
  assert.equal(tableElement.props.filteredProducts?.length, 3);
});

test("AutoSeoPage: renders full page without crashing", () => {
  const dummyClient = new MockAutoSeoClient();

  const html = renderToStaticMarkup(React.createElement(AutoSeoPage, { client: dummyClient }));
  assert.ok(html.includes("Auto SEO Product Selection"));
  assert.ok(html.includes("Quy trình chọn lọc"));
});

test("AutoSeoPage: defaults to empty selection when initialSelectedProductIds is not provided", () => {
  let capturedTree: React.ReactElement<{ children: React.ReactNode[] }> | undefined;

  function PageHarness(): React.JSX.Element {
    const tree = AutoSeoPage({
      client: new MockAutoSeoClient(),
      initialProducts: mockProducts,
    });
    capturedTree = tree as React.ReactElement<{ children: React.ReactNode[] }>;
    return tree;
  }

  renderToStaticMarkup(React.createElement(PageHarness));
  if (capturedTree === undefined) {
    throw new Error("Page must render");
  }

  const children = React.Children.toArray(capturedTree.props.children);
  const toolbarElement = children.find(
    (c): c is React.ReactElement<AutoSeoToolbarProps> =>
      React.isValidElement(c) && typeof c.type === "function" && c.type.name === "AutoSeoToolbar",
  );
  assert.ok(toolbarElement, "AutoSeoToolbar must be rendered");
  assert.equal(toolbarElement.props.totalProductsCount, 3);
  assert.equal(toolbarElement.props.selectedCount, 0, "No products should be selected by default");

  const tableElement = children.find(
    (c): c is React.ReactElement<ProductSelectionTableProps> =>
      React.isValidElement(c) && typeof c.type === "function" && c.type.name === "ProductSelectionTable",
  );
  assert.ok(tableElement, "ProductSelectionTable must be rendered");
  assert.deepEqual(tableElement.props.selectedProductIds, [], "Selected product IDs array must be empty");
});

test("ProductSelectionTable: master checkbox reflects selection state and triggers select all / clear callbacks", () => {
  let selectAllCalled = false;
  let clearSelectionCalled = false;

  // 1. None selected: master checkbox is unchecked, change triggers onSelectAllVisible
  const { captured: unselectedCaptured, html: unselectedHtml } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });
  assert.ok(unselectedHtml.includes("aria-label=\"Chọn hoặc bỏ chọn tất cả sản phẩm đang hiển thị\""));

  // Check master input element in thead
  const rootDivChildren = React.Children.toArray(unselectedCaptured.props.children);
  const tableContainer = assertElement<{ children: React.ReactNode }>(rootDivChildren[1]);
  const table = assertElement<{ children: React.ReactNode[] }>(tableContainer.props.children);
  const tableChildren = React.Children.toArray(table.props.children);
  const thead = assertElement<{ children: React.ReactNode[] }>(tableChildren[0]);
  const theadRow = assertElement<{ children: React.ReactNode[] }>(React.Children.toArray(thead.props.children)[0]);
  const theadCells = React.Children.toArray(theadRow.props.children);
  const masterTh = assertElement<{ children: React.ReactNode }>(theadCells[0]);
  const masterLabel = assertElement<{ children: React.ReactNode }>(masterTh.props.children);
  const masterInput = assertElement<InputProps>(masterLabel.props.children);

  assert.equal(masterInput.props.checked, false, "Master checkbox should be unchecked when 0 items selected");

  // Harness with custom callbacks to verify toggle
  let capturedCallbackTree: React.ReactElement<{ children: React.ReactNode[] }> | null = null;
  function CallbackHarness(props: { selectedIds: readonly string[] }): React.JSX.Element {
    const el = ProductSelectionTable({
      products: mockProducts,
      selectedProductIds: props.selectedIds,
      onToggleSelect: () => {},
      onOpenDetail: () => {},
      onSelectAllVisible: () => {
        selectAllCalled = true;
      },
      onClearVisibleSelection: () => {
        clearSelectionCalled = true;
      },
    }) as React.ReactElement<{ children: React.ReactNode[] }>;
    capturedCallbackTree = el;
    return el;
  }

  // Test triggering select all
  renderToStaticMarkup(React.createElement(CallbackHarness, { selectedIds: [] }));
  const root1 = React.Children.toArray(capturedCallbackTree!.props.children);
  const tc1 = assertElement<{ children: React.ReactNode }>(root1[1]);
  const t1 = assertElement<{ children: React.ReactNode[] }>(tc1.props.children);
  const thead1 = assertElement<{ children: React.ReactNode[] }>(React.Children.toArray(t1.props.children)[0]);
  const tr1 = assertElement<{ children: React.ReactNode[] }>(React.Children.toArray(thead1.props.children)[0]);
  const th1 = assertElement<{ children: React.ReactNode }>(React.Children.toArray(tr1.props.children)[0]);
  const lbl1 = assertElement<{ children: React.ReactNode }>(th1.props.children);
  const input1 = assertElement<InputProps>(lbl1.props.children);

  input1.props.onChange?.();
  assert.equal(selectAllCalled, true, "Clicking master checkbox when unselected should trigger onSelectAllVisible");

  // Test triggering clear selection when all are selected
  renderToStaticMarkup(React.createElement(CallbackHarness, { selectedIds: mockProducts.map(p => p.id) }));
  const root2 = React.Children.toArray(capturedCallbackTree!.props.children);
  const tc2 = assertElement<{ children: React.ReactNode }>(root2[1]);
  const t2 = assertElement<{ children: React.ReactNode[] }>(tc2.props.children);
  const thead2 = assertElement<{ children: React.ReactNode[] }>(React.Children.toArray(t2.props.children)[0]);
  const tr2 = assertElement<{ children: React.ReactNode[] }>(React.Children.toArray(thead2.props.children)[0]);
  const th2 = assertElement<{ children: React.ReactNode }>(React.Children.toArray(tr2.props.children)[0]);
  const lbl2 = assertElement<{ children: React.ReactNode }>(th2.props.children);
  const input2 = assertElement<InputProps>(lbl2.props.children);

  assert.equal(input2.props.checked, true, "Master checkbox should be checked when all items are selected");
  input2.props.onChange?.();
  assert.equal(clearSelectionCalled, true, "Clicking master checkbox when selected should trigger onClearVisibleSelection");
});

test("filterAutoSeoProducts: filters by typeFilter for productType and collectionFilter for collections/tags", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/1",
      title: "Ceramic Mug",
      handle: "ceramic-mug",
      productType: "Kitchenware",
      collections: [{ id: "c1", title: "Dining", handle: "dining" }],
      tags: ["eco"],
    },
    {
      id: "gid://shopify/Product/2",
      title: "Silk Scarf",
      handle: "silk-scarf",
      productType: "Apparel",
      tags: ["fashion", "collection:Accessories"],
    },
    {
      id: "gid://shopify/Product/3",
      title: "Wooden Spoon",
      handle: "wooden-spoon",
      productType: "Kitchenware",
      tags: ["wood"],
    },
  ];

  // Filter by productType "Kitchenware" via typeFilter
  const kitchenware = filterAutoSeoProducts(products, {
    typeFilter: "Kitchenware",
  });
  assert.equal(kitchenware.length, 2);
  assert.deepEqual(kitchenware.map(p => p.id), ["gid://shopify/Product/1", "gid://shopify/Product/3"]);

  // Filter by real Shopify collection "Dining" via collectionFilter
  const dining = filterAutoSeoProducts(products, {
    collectionFilter: "Dining",
  });
  assert.equal(dining.length, 1);
  assert.equal(dining[0]?.id, "gid://shopify/Product/1");

  // Filter by tag collection "Accessories" via collectionFilter
  const accessories = filterAutoSeoProducts(products, {
    collectionFilter: "Accessories",
  });
  assert.equal(accessories.length, 1);
  assert.equal(accessories[0]?.id, "gid://shopify/Product/2");
});

test("filterAutoSeoProducts: filters by Amazon ASIN across tags, variants SKU, barcode, and handle", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/1",
      title: "Stainless Water Bottle",
      handle: "water-bottle-b08xyz1234",
      tags: ["outdoor"],
    },
    {
      id: "gid://shopify/Product/2",
      title: "Yoga Mat",
      handle: "yoga-mat",
      tags: ["asin:B07ABC9999", "fitness"],
    },
    {
      id: "gid://shopify/Product/3",
      title: "Resistance Bands",
      handle: "resistance-bands",
      variants: [
        { id: "var-1", title: "Heavy", sku: "B09ZZZ8888-HVY" },
      ],
    },
  ];

  // Match ASIN in handle
  const asin1 = filterAutoSeoProducts(products, { asinQuery: "B08XYZ1234" });
  assert.equal(asin1.length, 1);
  assert.equal(asin1[0]?.id, "gid://shopify/Product/1");

  // Match ASIN in tags with prefix asin:
  const asin2 = filterAutoSeoProducts(products, { asinQuery: "B07ABC9999" });
  assert.equal(asin2.length, 1);
  assert.equal(asin2[0]?.id, "gid://shopify/Product/2");

  // Match ASIN in variant SKU (case-insensitive)
  const asin3 = filterAutoSeoProducts(products, { asinQuery: "b09zzz8888" });
  assert.equal(asin3.length, 1);
  assert.equal(asin3[0]?.id, "gid://shopify/Product/3");
});

test("filterAutoSeoProducts: filters by upload date range using createdAt", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/1",
      title: "Old Product",
      handle: "old-product",
      createdAt: "2026-01-15T10:00:00Z",
    },
    {
      id: "gid://shopify/Product/2",
      title: "Mid Product",
      handle: "mid-product",
      createdAt: "2026-05-20T14:30:00Z",
    },
    {
      id: "gid://shopify/Product/3",
      title: "New Product",
      handle: "new-product",
      createdAt: "2026-09-01T08:00:00Z",
    },
  ];

  // Filter startDate only
  const afterMay = filterAutoSeoProducts(products, { startDate: "2026-05-01" });
  assert.equal(afterMay.length, 2);
  assert.deepEqual(afterMay.map(p => p.id), ["gid://shopify/Product/2", "gid://shopify/Product/3"]);

  // Filter endDate only
  const beforeMay = filterAutoSeoProducts(products, { endDate: "2026-05-01" });
  assert.equal(beforeMay.length, 1);
  assert.equal(beforeMay[0]?.id, "gid://shopify/Product/1");

  // Filter both startDate and endDate
  const midOnly = filterAutoSeoProducts(products, { startDate: "2026-05-01", endDate: "2026-05-31" });
  assert.equal(midOnly.length, 1);
  assert.equal(midOnly[0]?.id, "gid://shopify/Product/2");
});

test("ProductSelectionTable: renders compact filter bar with separated type and collection dropdowns and advanced filter toggle", () => {
  const productsWithDetails: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/1",
      title: "Eco Mug",
      handle: "eco-mug",
      status: "ACTIVE",
      productType: "Kitchenware",
      collections: [{ id: "c1", title: "Home Goods", handle: "home-goods" }],
      createdAt: "2026-08-01T00:00:00Z",
    },
    {
      id: "gid://shopify/Product/2",
      title: "Linen Shirt",
      handle: "linen-shirt",
      status: "DRAFT",
      productType: "Apparel",
      collections: [{ id: "c2", title: "Summer Style", handle: "summer-style" }],
      createdAt: "2026-08-15T00:00:00Z",
    },
  ];

  const { html } = renderTable({
    products: productsWithDetails,
    selectedProductIds: [],
    asinQuery: "B08",
    eligibilityItems: [
      { productId: "gid://shopify/Product/1", state: "never_processed", reason: "NO_HISTORY" },
    ],
  });

  // Verify compact dropdowns and controls exist in markup
  assert.ok(html.includes("Bộ lọc nâng cao"), "Must render 'Bộ lọc nâng cao' toggle");
  assert.ok(html.includes("Loại SP: Tất cả"), "Must render product type filter option");
  assert.ok(html.includes("Kitchenware"), "Must include productType in type options");
  assert.ok(html.includes("Apparel"), "Must include productType in type options");
  assert.ok(html.includes("Tất cả bộ sưu tập"), "Must render collection filter option");
  assert.ok(html.includes("Home Goods"), "Must include collection in collection options");
  assert.ok(html.includes("Summer Style"), "Must include collection in collection options");
  assert.ok(html.includes("Shopify:"), "Must render Shopify status filter selector");
  assert.ok(html.includes("SEO:"), "Must render SEO status filter selector");
  assert.ok(html.includes("Nhập ASIN"), "Must render ASIN filter input placeholder");
  assert.ok(html.includes("Từ ngày"), "Must render start date filter label");
  assert.ok(html.includes("Đến ngày"), "Must render end date filter label");
});

test("filterAutoSeoProducts: filters products accurately by typeFilter vs collectionFilter", () => {
  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "gid://shopify/Product/1",
      title: "Bedding Set",
      handle: "bedding-set",
      productType: "Bedding",
      collections: [{ id: "c1", title: "Summer Sale", handle: "summer-sale" }],
    },
    {
      id: "gid://shopify/Product/2",
      title: "Fleece Blanket",
      handle: "fleece-blanket",
      productType: "Blanket",
      collections: [{ id: "c1", title: "Summer Sale", handle: "summer-sale" }],
    },
    {
      id: "gid://shopify/Product/3",
      title: "Silk Blanket",
      handle: "silk-blanket",
      productType: "Blanket",
      collections: [{ id: "c2", title: "Luxury Line", handle: "luxury-line" }],
    },
  ];

  // Filter by typeFilter only
  const beddingOnly = filterAutoSeoProducts(products, { typeFilter: "Bedding" });
  assert.equal(beddingOnly.length, 1);
  assert.equal(beddingOnly[0]?.id, "gid://shopify/Product/1");

  const blanketOnly = filterAutoSeoProducts(products, { typeFilter: "Blanket" });
  assert.equal(blanketOnly.length, 2);

  // Filter by collectionFilter only
  const summerSale = filterAutoSeoProducts(products, { collectionFilter: "Summer Sale" });
  assert.equal(summerSale.length, 2);
  assert.deepEqual(summerSale.map(p => p.id), ["gid://shopify/Product/1", "gid://shopify/Product/2"]);

  // Filter by both typeFilter and collectionFilter
  const blanketSummer = filterAutoSeoProducts(products, { typeFilter: "Blanket", collectionFilter: "Summer Sale" });
  assert.equal(blanketSummer.length, 1);
  assert.equal(blanketSummer[0]?.id, "gid://shopify/Product/2");
});

test("ProductSelectionTable: renders storeCollections matching screenshot with count", () => {
  const storeCollections: readonly AutoSeoCollectionOption[] = [
    { id: "c1", title: "Bedding Set", productsCount: 382 },
    { id: "c2", title: "Blankets Bedding", productsCount: 111 },
    { id: "c3", title: "Sports Bedding", productsCount: 144 },
  ];

  const { html } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    storeCollections,
  });

  assert.ok(html.includes("-- Tất cả bộ sưu tập (3) --"));
  assert.ok(html.includes("Bedding Set (382)"));
  assert.ok(html.includes("Blankets Bedding (111)"));
  assert.ok(html.includes("Sports Bedding (144)"));
});

test("filterAutoSeoProducts: filters by storeCollections using smart matching", () => {
  const storeCollections: readonly AutoSeoCollectionOption[] = [
    { id: "c1", title: "Bedding Set", handle: "bedding-set", productsCount: 382 },
    { id: "c2", title: "Blankets Bedding", handle: "blankets-bedding", productsCount: 111 },
  ];

  const products: readonly ShopifyProductForAutoSeoUi[] = [
    {
      id: "p1",
      title: "Dragon Bedding Set",
      handle: "dragon-bedding-set",
      productType: "Bedding",
      tags: ["fantasy", "Bedding Set"],
    },
    {
      id: "p2",
      title: "Cozy Blanket",
      handle: "cozy-blanket",
      productType: "Blanket",
      tags: ["blankets-bedding"],
    },
  ];

  const beddingResults = filterAutoSeoProducts(products, {
    collectionFilter: "c1",
    collections: storeCollections,
  });
  assert.equal(beddingResults.length, 1);
  assert.equal(beddingResults[0]?.id, "p1");

  const blanketResults = filterAutoSeoProducts(products, {
    collectionFilter: "c2",
    collections: storeCollections,
  });
  assert.equal(blanketResults.length, 1);
  assert.equal(blanketResults[0]?.id, "p2");
});

test("extractProductSeoVersion extracts SEO version from tags or returns undefined", () => {
  assert.equal(extractProductSeoVersion(undefined), undefined);
  assert.equal(extractProductSeoVersion([]), undefined);
  assert.equal(extractProductSeoVersion(["rug", "living-room"]), undefined);
  assert.equal(extractProductSeoVersion(["rug", "seo-v1"]), 1);
  assert.equal(extractProductSeoVersion(["SEO-V2", "home"]), 2);
  assert.equal(extractProductSeoVersion(["seo-v15"]), 15);
  assert.equal(extractProductSeoVersion("seo-v3, rug"), 3);
});

test("filterAutoSeoProducts filters correctly by seoVersionFilter", () => {
  const products: ShopifyProductForAutoSeoUi[] = [
    { id: "p0", title: "New Product", handle: "new-product", tags: ["rug"] },
    { id: "p1", title: "Product V1", handle: "prod-v1", tags: ["rug", "seo-v1"] },
    { id: "p2", title: "Product V2", handle: "prod-v2", tags: ["rug", "seo-v2"] },
    { id: "p3", title: "Product V3", handle: "prod-v3", tags: ["rug", "seo-v3"] },
    { id: "p4", title: "Product V4 (direct property)", handle: "prod-v4", seoVersion: 4 },
  ];

  // All
  assert.equal(filterAutoSeoProducts(products, { seoVersionFilter: "all" }).length, 5);

  // v0 (un-SEOed)
  const v0Results = filterAutoSeoProducts(products, { seoVersionFilter: "v0" });
  assert.equal(v0Results.length, 1);
  assert.equal(v0Results[0]?.id, "p0");

  // v1
  const v1Results = filterAutoSeoProducts(products, { seoVersionFilter: "v1" });
  assert.equal(v1Results.length, 1);
  assert.equal(v1Results[0]?.id, "p1");

  // v2
  const v2Results = filterAutoSeoProducts(products, { seoVersionFilter: "v2" });
  assert.equal(v2Results.length, 1);
  assert.equal(v2Results[0]?.id, "p2");

  // v3_plus (v3 and v4)
  const v3Results = filterAutoSeoProducts(products, { seoVersionFilter: "v3_plus" });
  assert.equal(v3Results.length, 2);
  assert.deepEqual(v3Results.map(p => p.id), ["p3", "p4"]);

  // v_any (v1, v2, v3, v4)
  const vAnyResults = filterAutoSeoProducts(products, { seoVersionFilter: "v_any" });
  assert.equal(vAnyResults.length, 4);
  assert.deepEqual(vAnyResults.map(p => p.id), ["p1", "p2", "p3", "p4"]);
});

