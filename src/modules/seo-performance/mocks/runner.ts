import type { PerformanceList, SeoPerformanceClient } from "../types";
import { MOCK_PAGES } from "./data";

export function createMockSeoPerformanceClient(): SeoPerformanceClient {
  let connected = true;
  function list<T>(items: readonly T[], offset = 0): PerformanceList<T> { return { items: structuredClone(items.slice(offset, offset + 50)), total: items.length, nextOffset: offset + 50 < items.length ? offset + 50 : null }; }
  return {
    stores: async () => [{ storeId: "demo", shopDomain: "demo.myshopify.com" }],
    overview: async storeId => ({ enabled: true, configured: true, connected, reconnectRequired: false, mapping: { storeId, property: "sc-domain:demo.example", origin: "https://demo.example", lastSync: "2026-01-01T00:00:00.000Z" }, current: structuredClone(MOCK_PAGES[0].current), previous: structuredClone(MOCK_PAGES[0].previous), startDate: "2025-12-05", endDate: "2026-01-01", jobs: [], notice: "Dữ liệu minh họa · không kết nối Google hoặc Shopify." }),
    properties: async () => [{ siteUrl: "sc-domain:demo.example", permissionLevel: "siteOwner" }],
    connect: async () => { connected = true; return { url: "/seo-performance?storeId=demo" }; }, disconnect: async () => { connected = false; },
    map: async () => {}, start: async () => ({ jobId: "demo-job" }),
    pages: async (_store, filters) => list(MOCK_PAGES.filter(page => (!filters?.kind || page.kind === filters.kind) && (!filters?.search || page.url.includes(filters.search))), filters?.offset),
    queries: async () => list([{ query: "sample blanket", metrics: { clicks: 10, impressions: 1000, ctr: 0.01, position: 8 } }]),
    recommendations: async () => list([]), history: async () => list([]),
    revise: async () => ({ jobId: "demo-revision" }), dismiss: async () => {},
  };
}
