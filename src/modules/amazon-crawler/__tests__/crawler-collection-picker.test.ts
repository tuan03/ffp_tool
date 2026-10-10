import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { CrawlerCollectionPicker } from "../ui/components/CrawlerCollectionPicker";

const collections = [
  { id: "one", title: "A long collection title for everyday product selection", productsCount: 7 },
  { id: "two", title: "Another collection", productsCount: 0 },
] as const;

function renderPicker({ isLoading = false, hasCollections = true } = {}): string {
  return renderToStaticMarkup(createElement(CrawlerCollectionPicker, {
    collections: hasCollections ? collections : [],
    selectedIds: ["one"],
    isLoading,
    onToggle: () => {},
    onSelectAll: () => {},
    onClear: () => {},
  }));
}

test("collection picker shows a searchable checklist and complete selected titles", () => {
  const markup = renderPicker();
  assert.match(markup, /type="search"/);
  assert.match(markup, /Tìm collection/);
  assert.match(markup, /Bỏ collection A long collection title for everyday product selection/);
  assert.match(markup, /aria-label="A long collection title for everyday product selection"[^>]*checked=""/);
  assert.match(markup, /Chọn tất cả \(2\)/);
  assert.match(markup, /max-h-52/);
  assert.doesNotMatch(markup, /truncate|<select/);
});

test("collection picker hides previous store choices and disables selection while loading", () => {
  const markup = renderPicker({ isLoading: true });
  assert.match(markup, /Đang tải collections/);
  assert.match(markup, /<button[^>]*disabled=""/);
  assert.match(markup, /type="search"[^>]*disabled=""/);
  assert.doesNotMatch(markup, /type="checkbox"|Bỏ collection A long/);
});

test("empty collection picker provides guidance instead of an empty selector", () => {
  const markup = renderPicker({ hasCollections: false });
  assert.match(markup, /Chưa có collection để chọn/);
  assert.match(markup, /Chọn tất cả \(0\)/);
  assert.doesNotMatch(markup, /type="checkbox"/);
});
