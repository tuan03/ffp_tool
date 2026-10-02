import type { PerformancePage } from "../types";

export const MOCK_PAGES: readonly PerformancePage[] = [{ url: "https://demo.example/products/sample-blanket", kind: "product", productId: "demo-1", snapshotId: "demo-snapshot", checkedAt: "2026-01-01T00:00:00.000Z", audit: null, current: { clicks: 10, impressions: 1000, ctr: 0.01, position: 8 }, previous: { clicks: 14, impressions: 900, ctr: 14 / 900, position: 9 }, opportunities: ["POSITION_OPPORTUNITY"] }];
