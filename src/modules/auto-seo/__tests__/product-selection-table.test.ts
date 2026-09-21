import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ProductSelectionTable } from "../ui/components/ProductSelectionTable";

import type { ShopifyProductForAutoSeoUi } from "../types";

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
      decisions: props.decisions ?? {},
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
