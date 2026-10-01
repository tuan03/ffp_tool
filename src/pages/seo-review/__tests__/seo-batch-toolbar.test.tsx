import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import { SeoBatchToolbar } from "../components/SeoBatchToolbar";

test("SEO batch toolbar exposes approve-all and quick Shopify sync actions", () => {
  const markup = renderToStaticMarkup(
    <SeoBatchToolbar
      totalCount={100}
      pendingCount={100}
      approvedUnsyncedCount={0}
      selectedCount={0}
      filter={{ searchQuery: "", statusFilter: "all", decisionFilter: "all", onlyMockData: false }}
      viewMode="cards"
      onFilterChange={() => undefined}
      onViewModeChange={() => undefined}
      onSelectAll={() => undefined}
      onClearSelection={() => undefined}
      onApproveSelected={() => undefined}
      onApproveAllPending={() => undefined}
      onRejectSelected={() => undefined}
      onSyncAllApproved={() => undefined}
      onExportApprovedJson={() => undefined}
      onClearAll={() => undefined}
    />,
  );

  assert.match(markup, /Duyệt nhanh tất cả \(100\)/);
  assert.match(markup, /Đồng bộ nhanh lên Shopify \(0\)/);
});
