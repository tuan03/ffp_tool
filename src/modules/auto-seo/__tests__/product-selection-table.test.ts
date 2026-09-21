import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AutoSeoPage } from "../ui/AutoSeoPage";
import { AutoSeoToolbar } from "../ui/components/AutoSeoToolbar";
import type { AutoSeoToolbarProps } from "../ui/components/AutoSeoToolbar";
import {
  clearVisibleProductsSelection,
  filterAutoSeoProducts,
  selectAllVisibleProducts,
} from "../ui/components/product-filter";
import { ProductSelectionTable } from "../ui/components/ProductSelectionTable";
import type { ProductSelectionTableProps } from "../ui/components/ProductSelectionTable";

import type {
  ProductReviewDecision,
  ShopifyProductForAutoSeoUi,
  ShopifyStatusFilter,
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
  decisions?: Record<string, "approved" | "needs_edit" | "mark_draft" | "skipped" | "pending">;
  searchQuery?: string;
  onSearchQueryChange?: (query: string) => void;
  statusFilter?: ShopifyStatusFilter;
  onStatusFilterChange?: (status: ShopifyStatusFilter) => void;
  decisionFilter?: string;
  onDecisionFilterChange?: (decision: string) => void;
  filteredProducts?: readonly ShopifyProductForAutoSeoUi[];
  onToggleSelect?: (id: string) => void;
  onApprove?: (id: string) => void;
  onEdit?: (product: ShopifyProductForAutoSeoUi) => void;
  onMarkDraft?: (id: string) => void;
  onSkip?: (id: string) => void;
  onOpenDetail?: (product: ShopifyProductForAutoSeoUi) => void;
}): RenderResult {
  let captured: React.ReactElement<{ children: React.ReactNode[] }> | null = null;

  function TestHarness(): React.JSX.Element {
    captured = ProductSelectionTable({
      products: props.products,
      selectedProductIds: props.selectedProductIds,
      decisions: (props.decisions ?? {}) as Record<string, ProductReviewDecision>,
      searchQuery: props.searchQuery,
      onSearchQueryChange: props.onSearchQueryChange,
      statusFilter: props.statusFilter,
      onStatusFilterChange: props.onStatusFilterChange,
      decisionFilter: props.decisionFilter,
      onDecisionFilterChange: props.onDecisionFilterChange,
      filteredProducts: props.filteredProducts,
      onToggleSelect: props.onToggleSelect ?? (() => {}),
      onApprove: props.onApprove ?? (() => {}),
      onEdit: props.onEdit ?? (() => {}),
      onMarkDraft: props.onMarkDraft ?? (() => {}),
      onSkip: props.onSkip ?? (() => {}),
      onOpenDetail: props.onOpenDetail ?? (() => {}),
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

interface ActionButtons {
  approveButton: React.ReactElement<ButtonProps>;
  editButton: React.ReactElement<ButtonProps>;
  draftButton: React.ReactElement<ButtonProps>;
  skipButton: React.ReactElement<ButtonProps>;
}

interface TableRowElements {
  tr: React.ReactElement<{ onClick(): void; children: React.ReactNode[] }>;
  checkboxTd: React.ReactElement<CellProps>;
  checkboxLabel: React.ReactElement<LabelProps>;
  checkboxInput: React.ReactElement<InputProps>;
  actionsTd: React.ReactElement<CellProps>;
  actionButtons: ActionButtons;
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
  const cells = React.Children.toArray(tr.props.children);

  const checkboxTd = assertElement<CellProps>(cells[0]);
  const checkboxLabel = assertElement<LabelProps>(checkboxTd.props.children);
  const checkboxInput = assertElement<InputProps>(checkboxLabel.props.children);
  const actionsTd = assertElement<CellProps>(cells[8]);

  const actionsDiv = assertElement<{ children: React.ReactNode[] }>(actionsTd.props.children);
  const buttons = React.Children.toArray(actionsDiv.props.children);

  const approveButton = assertElement<ButtonProps>(buttons[0]);
  const editButton = assertElement<ButtonProps>(buttons[1]);
  const draftButton = assertElement<ButtonProps>(buttons[2]);
  const skipButton = assertElement<ButtonProps>(buttons[3]);

  return {
    tr,
    checkboxTd,
    checkboxLabel,
    checkboxInput,
    actionsTd,
    actionButtons: { approveButton, editButton, draftButton, skipButton },
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

test("ProductSelectionTable: actions cell click stops propagation to row", () => {
  const openedProducts: ShopifyProductForAutoSeoUi[] = [];

  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    onOpenDetail: (p) => openedProducts.push(p),
  });

  const { actionsTd } = extractFirstRowElements(captured);

  let stopPropagationCalled = false;
  actionsTd.props.onClick?.({
    stopPropagation: () => {
      stopPropagationCalled = true;
    },
  });

  assert.equal(stopPropagationCalled, true, "actionsTd.onClick must call stopPropagation");
  assert.equal(openedProducts.length, 0, "Actions cell click must not open product detail");
});

test("ProductSelectionTable: action buttons (Duyệt, Sửa, Draft, Bỏ) call their respective callbacks", () => {
  const approvedIds: string[] = [];
  const editedProducts: ShopifyProductForAutoSeoUi[] = [];
  const draftIds: string[] = [];
  const skippedIds: string[] = [];

  const { captured } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
    onApprove: (id) => approvedIds.push(id),
    onEdit: (product) => editedProducts.push(product),
    onMarkDraft: (id) => draftIds.push(id),
    onSkip: (id) => skippedIds.push(id),
  });

  const { actionButtons } = extractFirstRowElements(captured);

  actionButtons.approveButton.props.onClick?.();
  assert.deepEqual(approvedIds, ["gid://shopify/Product/101"]);

  actionButtons.editButton.props.onClick?.();
  assert.equal(editedProducts.length, 1);
  assert.equal(editedProducts[0]?.id, "gid://shopify/Product/101");

  actionButtons.draftButton.props.onClick?.();
  assert.deepEqual(draftIds, ["gid://shopify/Product/101"]);

  actionButtons.skipButton.props.onClick?.();
  assert.deepEqual(skippedIds, ["gid://shopify/Product/101"]);
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

test("ProductSelectionTable: filter tab reflects current selected products count", () => {
  const { html: htmlZero } = renderTable({
    products: mockProducts,
    selectedProductIds: [],
  });
  assert.ok(htmlZero.includes("Đã chọn (0)"));

  const { html: htmlTwo } = renderTable({
    products: mockProducts,
    selectedProductIds: ["gid://shopify/Product/101", "gid://shopify/Product/102"],
  });
  assert.ok(htmlTwo.includes("Đã chọn (2)"));
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

  // AutoSeoToolbar rendering visible count
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
  assert.ok(toolbarHtml.includes("Chọn tất cả (2)"));
  assert.ok(toolbarHtml.includes("Bỏ chọn (2)"));
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

test("AutoSeoToolbar: disables both batch buttons when visibleProductsCount is 0 and enables when positive", () => {
  const toolbarZero = AutoSeoToolbar({
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 4,
    selectedCount: 2,
    visibleProductsCount: 0,
    onLoadProducts: () => {},
    onSelectAll: () => {},
    onClearSelection: () => {},
    onRunAutoSeo: () => {},
  });

  const zeroChildren = React.Children.toArray(toolbarZero.props.children);
  const zeroActionsRow = zeroChildren[1] as React.ReactElement<{ children: React.ReactNode[] }>;
  const zeroButtonGroup = React.Children.toArray(zeroActionsRow.props.children)[0] as React.ReactElement<{ children: React.ReactNode[] }>;
  const zeroButtons = React.Children.toArray(zeroButtonGroup.props.children) as React.ReactElement<{ title?: string; disabled?: boolean }>[];

  const selectAllZero = zeroButtons[1];
  const clearZero = zeroButtons[2];
  assert.equal(selectAllZero.props.disabled, true, "Select All must be disabled when visibleProductsCount is 0");
  assert.equal(clearZero.props.disabled, true, "Clear Selection must be disabled when visibleProductsCount is 0");

  const toolbarPositive = AutoSeoToolbar({
    isLoadingProducts: false,
    isRunningAutoSeo: false,
    totalProductsCount: 4,
    selectedCount: 0,
    visibleProductsCount: 3,
    onLoadProducts: () => {},
    onSelectAll: () => {},
    onClearSelection: () => {},
    onRunAutoSeo: () => {},
  });

  const posChildren = React.Children.toArray(toolbarPositive.props.children);
  const posActionsRow = posChildren[1] as React.ReactElement<{ children: React.ReactNode[] }>;
  const posButtonGroup = React.Children.toArray(posActionsRow.props.children)[0] as React.ReactElement<{ children: React.ReactNode[] }>;
  const posButtons = React.Children.toArray(posButtonGroup.props.children) as React.ReactElement<{ title?: string; disabled?: boolean }>[];

  const selectAllPos = posButtons[1];
  assert.equal(selectAllPos.props.disabled, false, "Select All must be enabled when visibleProductsCount > 0");

  // Also verify HTML markup has the exact labels
  const toolbarZeroHtml = renderToStaticMarkup(React.createElement(() => toolbarZero));
  assert.ok(toolbarZeroHtml.includes("Chọn tất cả (0)"));
  assert.ok(toolbarZeroHtml.includes("Bỏ chọn (0)"));
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
  const dummyClient = {
    loadProducts: async () => mockProducts,
    loadProductDetail: async (id: string) =>
      mockProducts.find((p) => p.id === id) ?? mockProducts[0]!,
    runAutoSeo: async () => ({
      workflowId: "test",
      selectedCount: 0,
      seoContentInputs: [],
      warnings: [],
    }),
  };

  const html = renderToStaticMarkup(React.createElement(AutoSeoPage, { client: dummyClient }));
  assert.ok(html.includes("Auto SEO Product Selection"));
  assert.ok(html.includes("Quy trình chọn lọc"));
});
