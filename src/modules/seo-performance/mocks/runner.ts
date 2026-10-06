import type {
  BenchmarkFilters,
  BenchmarkProductItem,
  BenchmarkSummaryKpis,
  PerformanceList,
  ProductSeoDetailData,
  SeoPerformanceClient,
} from "../types";
import {
  MOCK_BATCH_DETAIL,
  MOCK_BENCHMARK_PRODUCTS,
  MOCK_CONNECTIONS_SYNC,
  MOCK_PAGES,
  MOCK_PRODUCT_DETAIL_PRODUCT_A,
  MOCK_SUMMARY_KPIS,
} from "./data";

export function createMockSeoPerformanceClient(): SeoPerformanceClient {
  let connected = true;
  function list<T>(items: readonly T[], offset = 0): PerformanceList<T> {
    return {
      items: structuredClone(items.slice(offset, offset + 50)),
      total: items.length,
      nextOffset: offset + 50 < items.length ? offset + 50 : null,
    };
  }

  return {
    report: async (_storeId, filters, view = {}) => {
      const days = (Date.parse(filters.endDate) - Date.parse(filters.startDate)) / 86400000 + 1;
      const previousStart = new Date(Date.parse(filters.startDate) - days * 86400000).toISOString().slice(0, 10);
      const previousEnd = new Date(Date.parse(filters.startDate) - 86400000).toISOString().slice(0, 10);
      const current = { clicks: 10, impressions: 100, ctr: 0.1, position: 8 };
      const previous = { clicks: 5, impressions: 100, ctr: 0.05, position: 10 };
      const delta = { clicks: 5, impressions: 0, ctr: 0.05, position: -2 };
      const key = view.dimension === "page"
        ? "https://jeminise.com/products/premium-wool-blanket"
        : view.dimension === "country"
          ? "usa"
          : view.dimension === "device"
            ? "MOBILE"
            : view.dimension === "date"
              ? filters.startDate
              : "sample blanket";
      const matches = (!filters.country || filters.country.toLowerCase() === "usa") &&
        (!filters.device || filters.device === "MOBILE") &&
        (!filters.query || "sample blanket".includes(filters.query.toLowerCase())) &&
        (!filters.page || "https://jeminise.com/products/premium-wool-blanket".includes(filters.page.toLowerCase()));

      return {
        jobId: "demo-report",
        status: "done",
        progress: 100,
        error: null,
        fetchedAt: "2026-10-04T00:00:00.000Z",
        stale: false,
        property: "sc-domain:jeminise.com",
        filters: structuredClone(filters),
        previousStart,
        previousEnd,
        current: matches ? current : null,
        previous: matches ? previous : null,
        timeline: matches ? [{ key: filters.startDate, current, previous, delta }] : [],
        rows: list(matches && view.order !== "declining" ? [{ key, current, previous, delta }] : [], view.offset),
        limited: false,
      };
    },
    stores: async () => [{ storeId: "jeminise", shopDomain: "b6-theme-test.myshopify.com" }],
    integrations: async () => [
      {
        source: "gsc",
        status: connected ? "CONNECTED" : "DISCONNECTED",
        connectionId: connected ? "demo-google" : null,
        mappingRevision: 1,
        origin: "https://jeminise.com",
        property: "sc-domain:jeminise.com",
        freshness: {
          dataThrough: "2026-10-01",
          fetchedAt: "2026-10-04T12:00:00.000Z",
          lastSuccessfulSync: "2026-10-04T12:02:15.000Z",
          stale: false,
          staleReason: null,
        },
        quality: ["FINALIZED_DAYS_ONLY", "TIMEZONE_LOS_ANGELES"],
      },
      {
        source: "ga4",
        status: connected ? "CONNECTED" : "DISCONNECTED",
        connectionId: connected ? "demo-google" : null,
        mappingRevision: 1,
        origin: "https://jeminise.com",
        property: {
          propertyId: "549055707",
          streamId: "9876543210",
          hostnameScope: "jeminise.com",
          timeZone: "America/Los_Angeles",
          currencyCode: "USD",
        },
        freshness: {
          dataThrough: "2026-10-03",
          fetchedAt: "2026-10-04T12:00:00.000Z",
          lastSuccessfulSync: "2026-10-04T12:01:45.000Z",
          stale: false,
          staleReason: null,
        },
        quality: ["NO_SAMPLING"],
      },
    ],
    overview: async storeId => ({
      enabled: true,
      configured: true,
      connected,
      reconnectRequired: false,
      mapping: {
        storeId,
        property: "sc-domain:jeminise.com",
        origin: "https://jeminise.com",
        lastSync: "2026-10-04T12:02:15.000Z",
      },
      current: structuredClone(MOCK_PAGES[0].current),
      previous: structuredClone(MOCK_PAGES[0].previous),
      startDate: "2026-09-01",
      endDate: "2026-09-28",
      jobs: [],
      notice: "Dữ liệu minh họa theo chuẩn FFP SEO Benchmark.",
    }),
    properties: async () => [{ siteUrl: "sc-domain:jeminise.com", permissionLevel: "siteOwner" }],
    connect: async () => { connected = true; return { url: "/seo-performance?storeId=jeminise" }; },
    disconnect: async () => { connected = false; },
    map: async () => {},
    mapGa4: async () => ({ ok: true }),
    start: async () => ({ jobId: "demo-job" }),
    pages: async (_store, filters) => list(
      MOCK_PAGES.filter(page => (!filters?.kind || page.kind === filters.kind) && (!filters?.search || page.url.includes(filters.search))),
      filters?.offset,
    ),
    queries: async () => list([{ query: "chan long cuu cao cap", metrics: { clicks: 42, impressions: 1100, ctr: 0.0382, position: 4.1 } }]),
    recommendations: async () => list([]),
    history: async () => list([]),
    revise: async () => ({ jobId: "demo-revision" }),
    dismiss: async () => {},

    benchmark: async (_storeId, filters: BenchmarkFilters = {}) => {
      let filtered = [...MOCK_BENCHMARK_PRODUCTS];

      if (filters.versionFilter === "v0") {
        filtered = filtered.filter(item => item.currentVersion === "v0");
      } else if (filters.versionFilter === "v1+") {
        filtered = filtered.filter(item => item.currentVersion !== "v0");
      }

      if (filters.statusFilter) {
        filtered = filtered.filter(item => item.status.performanceStatus === filters.statusFilter || item.status.measurementStatus === filters.statusFilter);
      }

      if (filters.batchId) {
        filtered = filtered.filter(item => item.batchId === filters.batchId);
      }

      if (filters.search) {
        const query = filters.search.toLowerCase();
        filtered = filtered.filter(item => item.title.toLowerCase().includes(query) || item.url.toLowerCase().includes(query));
      }

      if (filters.query) {
        // Query filter: mark organicSessions warning if GSC query is filtered
        filtered = filtered.map(item => ({
          ...item,
          organicSessions: {
            ...item.organicSessions,
            isGscQueryFilterApplied: true,
          },
        }));
      }

      // Sorting
      if (filters.sortBy) {
        const dir = filters.sortDir === "desc" ? -1 : 1;
        filtered.sort((a, b) => {
          switch (filters.sortBy) {
            case "clicks":
              return dir * ((a.clicks.after) - (b.clicks.after));
            case "impressions":
              return dir * ((a.impressions.after) - (b.impressions.after));
            case "ctr":
              return dir * ((a.ctr.after ?? 0) - (b.ctr.after ?? 0));
            case "position":
              return dir * ((a.position.after ?? 999) - (b.position.after ?? 999));
            case "queries":
              return dir * ((a.queries.afterCount) - (b.queries.afterCount));
            case "sessions":
              return dir * ((a.organicSessions.after ?? 0) - (b.organicSessions.after ?? 0));
            case "age":
              return dir * ((a.seoAge ?? 0) - (b.seoAge ?? 0));
            case "title":
              return dir * a.title.localeCompare(b.title);
            case "status":
              return dir * a.status.label.localeCompare(b.status.label);
            default:
              return 0;
          }
        });
      }

      const offset = filters.offset ?? 0;
      const limit = filters.limit ?? 20;
      const paginated = filtered.slice(offset, offset + limit);

      const baseKpis = structuredClone(MOCK_SUMMARY_KPIS);
      const kpis: BenchmarkSummaryKpis = filters.query
        ? {
            ...baseKpis,
            cohortTotals: {
              ...baseKpis.cohortTotals,
              isGscQueryFilterApplied: true,
            },
          }
        : baseKpis;

      return {
        items: structuredClone(paginated),
        total: filtered.length,
        kpis,
      };
    },

    productDetail: async (_storeId, productId, options) => {
      // Find matching product or return Product A mock
      const matched = MOCK_BENCHMARK_PRODUCTS.find(p => p.productId === productId || p.shopifyProductGid === productId);
      const detail: ProductSeoDetailData = {
        ...MOCK_PRODUCT_DETAIL_PRODUCT_A,
        product: matched ? structuredClone(matched) : MOCK_PRODUCT_DETAIL_PRODUCT_A.product,
        windows: {
          ...MOCK_PRODUCT_DETAIL_PRODUCT_A.windows,
          settlingDays: 7,
        },
      };
      if (options?.windowDays) {
        // Adjust target window if requested
        return {
          ...detail,
          product: {
            ...detail.product,
            targetDays: options.windowDays,
          },
        };
      }
      return structuredClone(detail);
    },

    batchDetail: async (_storeId, batchId) => {
      return {
        ...structuredClone(MOCK_BATCH_DETAIL),
        batchId: batchId || MOCK_BATCH_DETAIL.batchId,
      };
    },

    connectionsSync: async () => {
      return structuredClone(MOCK_CONNECTIONS_SYNC);
    },

    backfill: async (_storeId, source, days = 28) => {
      return {
        jobId: `job-backfill-${source}-${days}d-${Date.now()}`,
      };
    },
  };
}
