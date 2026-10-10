import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SeoBatchToolbar } from "../components/SeoBatchToolbar";
import type { SeoBatchToolbarProps } from "../components/SeoBatchToolbar";

const props: SeoBatchToolbarProps = {
  counts: { pending: 0, ready: 0, syncing: 0, failed: 1, history: 354, synced: 350 },
  workspace: "work", selectedCount: 0, approvableCount: 0, syncableCount: 0, archivableCount: 0, isBusy: false,
  filter: { searchQuery: "", statusFilter: "all", decisionFilter: "all", onlyMockData: false }, viewMode: "cards",
  onWorkspaceChange: () => undefined, onFilterChange: () => undefined, onViewModeChange: () => undefined,
  onSelectAll: () => undefined, onClearSelection: () => undefined, onApproveSelected: () => undefined,
  onSyncSelected: () => undefined, onArchiveSelected: () => undefined,
};
test("toolbar separates whole-store history from work and does not mislabel Auto SEO as needing approval", () => {
  const markup = renderToStaticMarkup(<SeoBatchToolbar {...props} />);
  assert.ok(markup.includes("Cần xử lý (1)"));
  assert.ok(markup.includes("Tất cả (355)"));
  assert.ok(markup.includes("Đã sync (350)"));
  assert.doesNotMatch(markup, /Cần duyệt lại|Auto SEO \(50\)|Hoàn tác|Từ chối|Duyệt nhanh tất cả/);
  assert.match(markup, /Chọn trang này/);
  assert.doesNotMatch(markup, /Sync đã chọn/);
});
test("batch actions use eligible selection counts, not all history or all selected rows", () => {
  const markup = renderToStaticMarkup(<SeoBatchToolbar {...props} selectedCount={5} approvableCount={2} archivableCount={4} />);
  assert.doesNotMatch(markup, /Duyệt/);
  assert.ok(markup.includes("Lưu trữ đã chọn (4)"));
  assert.doesNotMatch(markup, /Sync đã chọn/);
});
