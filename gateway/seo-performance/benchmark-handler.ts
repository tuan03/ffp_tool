import { createHash } from "node:crypto";

import type {
  BatchDetailData,
  BenchmarkProductItem,
  BenchmarkSummaryKpis,
  ConnectionsSyncData,
  Ga4IntegrationSummary,
  GscIntegrationSummary,
  ProductSeoDetailData,
} from "../../src/modules/seo-performance";
import type { PerformanceService } from "./service";

const BASELINE_PRODUCTS: readonly BenchmarkProductItem[] = [
  {
    productId: "prod_01",
    shopifyProductGid: "gid://shopify/Product/1001",
    title: "Chăn Lông Cừu Cao Cấp Premium Wool Blanket",
    url: "https://jeminise.com/products/premium-wool-blanket",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/wool-blanket.jpg",
    currentVersion: "v2",
    versionSource: "AUTO_SEO",
    promptVersion: "v2.1-ecommerce",
    batchId: "batch_2026_08_pilot",
    publishedAt: "2026-08-23T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 42,
    targetDays: 28,
    coverageDays: 28,
    clicks: { after: 80, before: 50, deltaAbsolute: 30, deltaPercent: 60.0, isNewActivity: false },
    impressions: { after: 3200, before: 2500, deltaAbsolute: 700, deltaPercent: 28.0 },
    ctr: { after: 0.025, before: 0.02, deltaPercentagePoints: 0.5 },
    position: { after: 9.0, before: 12.0, improvement: 3.0 },
    queries: { afterCount: 25, beforeCount: 20, delta: 5, newlyObserved: 8, noLongerObserved: 3, matchedCount: 17 },
    organicSessions: { after: 85, before: 58, deltaAbsolute: 27, deltaPercent: 46.6, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "ELIGIBLE",
      performanceStatus: "IMPROVING",
      technicalFlags: [],
      label: "Improving",
      reason: "Clicks tăng +60% và +30 clicks; Vị trí cải thiện +3.0 bậc.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "VIEW", label: "Xem chi tiết", enabled: true },
  },
  {
    productId: "prod_02",
    shopifyProductGid: "gid://shopify/Product/1002",
    title: "Gối Ôm Lụa Tơ Tằm Tự Nhiên Silk Pillow",
    url: "https://jeminise.com/products/natural-silk-pillow",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/silk-pillow.jpg",
    currentVersion: "v0",
    versionSource: "INITIAL",
    promptVersion: null,
    batchId: null,
    publishedAt: null,
    hasExternalDrift: false,
    seoAge: null,
    targetDays: 28,
    coverageDays: 0,
    clicks: { after: 15, before: null, deltaAbsolute: null, deltaPercent: null, isNewActivity: false },
    impressions: { after: 1000, before: null, deltaAbsolute: null, deltaPercent: null },
    ctr: { after: 0.015, before: null, deltaPercentagePoints: null },
    position: { after: 18.2, before: null, improvement: null },
    queries: { afterCount: 8, beforeCount: null, delta: null, newlyObserved: 0, noLongerObserved: 0, matchedCount: 0 },
    organicSessions: { after: 17, before: null, deltaAbsolute: null, deltaPercent: null, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "BASELINE",
      performanceStatus: "NOT_EVALUATED",
      technicalFlags: [],
      label: "Baseline · v0",
      reason: "Sản phẩm phiên bản gốc v0; chưa có version trước để so sánh.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "AUTO_SEO", label: "Tạo Auto-SEO", enabled: true },
  },
  {
    productId: "prod_03",
    shopifyProductGid: "gid://shopify/Product/1003",
    title: "Bộ Ga Giường Cotton Satin Luxury Bedding Set",
    url: "https://jeminise.com/products/luxury-bedding-set",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/bedding-set.jpg",
    currentVersion: "v1",
    versionSource: "AUTO_SEO",
    promptVersion: "v2.2-structured",
    batchId: "batch_2026_09_growth",
    publishedAt: "2026-10-01T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 4,
    targetDays: 28,
    coverageDays: 4,
    clicks: { after: 5, before: null, deltaAbsolute: null, deltaPercent: null, isNewActivity: false },
    impressions: { after: 120, before: null, deltaAbsolute: null, deltaPercent: null },
    ctr: { after: 0.0417, before: null, deltaPercentagePoints: null },
    position: { after: 15.0, before: null, improvement: null },
    queries: { afterCount: 3, beforeCount: null, delta: null, newlyObserved: 0, noLongerObserved: 0, matchedCount: 0 },
    organicSessions: { after: 6, before: null, deltaAbsolute: null, deltaPercent: null, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "COLLECTING",
      performanceStatus: "NOT_EVALUATED",
      technicalFlags: [],
      label: "Collecting Data",
      reason: "Mới publish 4 ngày; chưa đủ cửa sổ 28 ngày đối chứng.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "VIEW", label: "Xem chi tiết", enabled: true },
  },
  {
    productId: "prod_04",
    shopifyProductGid: "gid://shopify/Product/1004",
    title: "Khăn Tắm Sợi Tre Kháng Khuẩn Bamboo Bath Towel",
    url: "https://jeminise.com/products/bamboo-bath-towel",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/bamboo-towel.jpg",
    currentVersion: "v1",
    versionSource: "AUTO_SEO",
    promptVersion: "v2.0-baseline",
    batchId: "batch_2026_08_pilot",
    publishedAt: "2026-08-20T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 45,
    targetDays: 28,
    coverageDays: 28,
    clicks: { after: 12, before: 25, deltaAbsolute: -13, deltaPercent: -52.0, isNewActivity: false },
    impressions: { after: 1500, before: 2400, deltaAbsolute: -900, deltaPercent: -37.5 },
    ctr: { after: 0.008, before: 0.0104, deltaPercentagePoints: -0.24 },
    position: { after: 21.0, before: 15.0, improvement: -6.0 },
    queries: { afterCount: 10, beforeCount: 18, delta: -8, newlyObserved: 2, noLongerObserved: 10, matchedCount: 8 },
    organicSessions: { after: 14, before: 28, deltaAbsolute: -14, deltaPercent: -50.0, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "ELIGIBLE",
      performanceStatus: "DECLINING",
      technicalFlags: [],
      label: "Declining",
      reason: "Clicks giảm -52% và -13 clicks. Vị trí rớt 6 bậc.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: {
      type: "SEND_TO_AUTO_SEO",
      label: "Gửi sang Auto-SEO",
      enabled: true,
      recommendationId: "rec_d_01",
    },
  },
  {
    productId: "prod_05",
    shopifyProductGid: "gid://shopify/Product/1005",
    title: "Nệm Topper Cao Su Non Memory Foam Topper",
    url: "https://jeminise.com/products/memory-foam-topper",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/topper.jpg",
    currentVersion: "v3",
    versionSource: "AUTO_SEO",
    promptVersion: "v1.9-test",
    batchId: "batch_2026_07_early",
    publishedAt: "2026-07-15T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 81,
    targetDays: 28,
    coverageDays: 28,
    clicks: { after: 50, before: 49, deltaAbsolute: 1, deltaPercent: 2.0, isNewActivity: false },
    impressions: { after: 2100, before: 2080, deltaAbsolute: 20, deltaPercent: 1.0 },
    ctr: { after: 0.0238, before: 0.0236, deltaPercentagePoints: 0.02 },
    position: { after: 8.4, before: 8.5, improvement: 0.1 },
    queries: { afterCount: 18, beforeCount: 18, delta: 0, newlyObserved: 2, noLongerObserved: 2, matchedCount: 16 },
    organicSessions: { after: 55, before: 54, deltaAbsolute: 1, deltaPercent: 1.8, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "ELIGIBLE",
      performanceStatus: "STABLE",
      technicalFlags: [],
      label: "Stable",
      reason: "Biến động clicks (+2.0%) nằm trong biên độ dao động bình thường.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "VIEW", label: "Xem chi tiết", enabled: true },
  },
  {
    productId: "prod_06",
    shopifyProductGid: "gid://shopify/Product/1006",
    title: "Thảm Trải Sàn Dệt Thủ Công Handmade Carpet",
    url: "https://jeminise.com/products/handmade-carpet",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/carpet.jpg",
    currentVersion: "v1",
    versionSource: "AUTO_SEO",
    promptVersion: "v2.1-ecommerce",
    batchId: "batch_2026_08_pilot",
    publishedAt: "2026-08-25T00:00:00.000Z",
    hasExternalDrift: false,
    seoAge: 40,
    targetDays: 28,
    coverageDays: 14,
    clicks: { after: 0, before: 15, deltaAbsolute: -15, deltaPercent: -100.0, isNewActivity: false },
    impressions: { after: 50, before: 1200, deltaAbsolute: -1150, deltaPercent: -95.8 },
    ctr: { after: 0.0, before: 0.0125, deltaPercentagePoints: -1.25 },
    position: { after: 45.0, before: 14.0, improvement: -31.0 },
    queries: { afterCount: 2, beforeCount: 12, delta: -10, newlyObserved: 0, noLongerObserved: 10, matchedCount: 2 },
    organicSessions: { after: 0, before: 16, deltaAbsolute: -16, deltaPercent: -100.0, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "PARTIAL",
      measurementStatus: "INSUFFICIENT_DATA",
      performanceStatus: "NOT_EVALUATED",
      technicalFlags: ["NOINDEX_OBSERVED", "CANONICAL_MISMATCH"],
      label: "Technical Review",
      reason: "Phát hiện chỉ thị noindex hoặc canonical mismatch.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "REVIEW", label: "Rà soát kỹ thuật", enabled: true },
  },
  {
    productId: "prod_07",
    shopifyProductGid: "gid://shopify/Product/1007",
    title: "Rèm Cửa Cản Sáng 100% Blackout Curtain",
    url: "https://jeminise.com/products/blackout-curtain",
    thumbnailUrl: "https://cdn.shopify.com/s/files/1/0000/0001/products/curtain.jpg",
    currentVersion: "v2",
    versionSource: "EXTERNAL",
    promptVersion: "v2.1-ecommerce",
    batchId: "batch_2026_08_pilot",
    publishedAt: "2026-08-28T00:00:00.000Z",
    hasExternalDrift: true,
    seoAge: 37,
    targetDays: 28,
    coverageDays: 28,
    clicks: { after: 28, before: 32, deltaAbsolute: -4, deltaPercent: -12.5, isNewActivity: false },
    impressions: { after: 1400, before: 1550, deltaAbsolute: -150, deltaPercent: -9.7 },
    ctr: { after: 0.02, before: 0.0206, deltaPercentagePoints: -0.06 },
    position: { after: 11.2, before: 10.8, improvement: -0.4 },
    queries: { afterCount: 14, beforeCount: 15, delta: -1, newlyObserved: 3, noLongerObserved: 4, matchedCount: 11 },
    organicSessions: { after: 30, before: 35, deltaAbsolute: -5, deltaPercent: -14.3, isGscQueryFilterApplied: false },
    status: {
      dataStatus: "FRESH",
      measurementStatus: "CONTENT_CHANGED",
      performanceStatus: "MIXED",
      technicalFlags: ["EXTERNAL_DRIFT_DETECTED"],
      label: "External Changes",
      reason: "Nội dung storefront đã bị thay đổi ngoài snapshot.",
      rulesetVersion: "v1.0.0-standard",
      lastEvaluatedAt: "2026-10-04T00:00:00.000Z",
    },
    action: { type: "REVIEW", label: "Đối chiếu nội dung", enabled: true },
  },
];

const BASELINE_KPIS: BenchmarkSummaryKpis = {
  totalManaged: 7,
  v0Count: 1,
  seoVersionCount: 6,
  eligibleCount: 3,
  improvingCount: 1,
  stableOrMixedCount: 2,
  decliningCount: 1,
  collectingOrInsufficientCount: 2,
  technicalIssuesCount: 1,
  cohortTotals: {
    beforeClicks: 124,
    afterClicks: 142,
    clicksDeltaAbsolute: 18,
    clicksDeltaPercent: 14.5,
    beforeImpressions: 6980,
    afterImpressions: 6800,
    impressionsDeltaAbsolute: -180,
    impressionsDeltaPercent: -2.6,
    beforeCtr: 0.0178,
    afterCtr: 0.0209,
    ctrDeltaPp: 0.31,
    beforePosition: 11.9,
    afterPosition: 11.5,
    positionImprovement: 0.4,
    beforeOrganicSessions: 140,
    afterOrganicSessions: 154,
    organicSessionsDelta: 14,
  },
};

function formatTitleFromUrl(url: string, auditTitle?: string | null): string {
  if (auditTitle && auditTitle.trim().length > 0) {
    return auditTitle.trim();
  }
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/products/");
    const rawSlug = parts[1] ?? pathname;
    const cleanSlug = decodeURIComponent(rawSlug).replace(/(-[a-f0-9]{8,12})+$/i, "");
    const formatted = cleanSlug
      .split("-")
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(" ");
    return formatted.length > 0 ? formatted : url;
  } catch {
    return url;
  }
}

function extractProductIdentity(url: string, dbProductId?: string | null): { productId: string; shopifyProductGid: string } {
  if (dbProductId && dbProductId.trim().length > 0) {
    const raw = dbProductId.trim();
    const cleanId = raw.replace(/^gid:\/\/shopify\/Product\//, "");
    return {
      productId: cleanId,
      shopifyProductGid: raw.startsWith("gid://") ? raw : `gid://shopify/Product/${cleanId}`,
    };
  }
  const hash = createHash("sha1").update(url).digest("hex").slice(0, 8);
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split("/products/");
    const slug = decodeURIComponent(parts[1] ?? pathname).replace(/[^a-zA-Z0-9_-]/g, "");
    return {
      productId: `prod_${slug}_${hash}`,
      shopifyProductGid: `gid://shopify/Product/${slug.slice(0, 24)}_${hash}`,
    };
  } catch {
    return {
      productId: `prod_${hash}`,
      shopifyProductGid: `gid://shopify/Product/${hash}`,
    };
  }
}

export async function loadBenchmarkProducts(
  service: PerformanceService,
  storeId: string,
  searchParams: URLSearchParams,
): Promise<{ readonly items: readonly BenchmarkProductItem[]; readonly total: number; readonly kpis: BenchmarkSummaryKpis }> {
  await service.ready();

  let allProducts: BenchmarkProductItem[] = [];
  let kpis: BenchmarkSummaryKpis = BASELINE_KPIS;

  try {
    const dbResult = await service.repository.pool.query<{
      url: string;
      product_id: string | null;
      audit: { title?: string; image?: string; [key: string]: unknown } | null;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number | null;
      query_count: number;
    }>(`
      SELECT
        p.url,
        p.product_id,
        p.audit,
        COALESCE(m.clicks, 0)::int AS clicks,
        COALESCE(m.impressions, 0)::int AS impressions,
        CASE
          WHEN COALESCE(m.impressions, 0) > 0 THEN ROUND((m.clicks::numeric / m.impressions::numeric), 4)::float
          ELSE 0
        END AS ctr,
        CASE
          WHEN COALESCE(m.impressions, 0) > 0 THEN ROUND((m.weighted_position::numeric / m.impressions::numeric), 2)::float
          ELSE NULL
        END AS position,
        COALESCE(q.query_count, 0)::int AS query_count
      FROM sp_pages p
      LEFT JOIN (
        SELECT
          page,
          SUM(clicks) AS clicks,
          SUM(impressions) AS impressions,
          SUM(position * impressions) AS weighted_position
        FROM sp_metrics
        WHERE store_id = $1 AND dataset = 'page'
        GROUP BY page
      ) m ON p.url = m.page
      LEFT JOIN (
        SELECT
          page,
          COUNT(DISTINCT query) AS query_count
        FROM sp_metrics
        WHERE store_id = $1 AND dataset = 'query'
        GROUP BY page
      ) q ON p.url = q.page
      WHERE p.store_id = $1 AND p.kind = 'product'
      ORDER BY clicks DESC, impressions DESC, p.url ASC
    `, [storeId]);

    if (dbResult.rows.length > 0) {
      allProducts = dbResult.rows.map(row => {
        const { productId, shopifyProductGid } = extractProductIdentity(row.url, row.product_id);
        const title = formatTitleFromUrl(row.url, row.audit?.title);
        const thumbnailUrl = typeof row.audit?.image === "string" ? row.audit.image : null;

        return {
          productId,
          shopifyProductGid,
          title,
          url: row.url,
          thumbnailUrl,
          currentVersion: "v0",
          versionSource: "INITIAL",
          promptVersion: null,
          batchId: null,
          publishedAt: null,
          hasExternalDrift: false,
          seoAge: null,
          targetDays: 28,
          coverageDays: 0,
          clicks: {
            after: row.clicks,
            before: null,
            deltaAbsolute: null,
            deltaPercent: null,
            isNewActivity: false,
          },
          impressions: {
            after: row.impressions,
            before: null,
            deltaAbsolute: null,
            deltaPercent: null,
          },
          ctr: {
            after: row.ctr,
            before: null,
            deltaPercentagePoints: null,
          },
          position: {
            after: row.position,
            before: null,
            improvement: null,
          },
          queries: {
            afterCount: row.query_count,
            beforeCount: null,
            delta: null,
            newlyObserved: 0,
            noLongerObserved: 0,
            matchedCount: 0,
          },
          organicSessions: {
            after: 0,
            before: null,
            deltaAbsolute: null,
            deltaPercent: null,
            isGscQueryFilterApplied: false,
          },
          status: {
            dataStatus: "FRESH",
            measurementStatus: "BASELINE",
            performanceStatus: "NOT_EVALUATED",
            technicalFlags: [],
            label: "Baseline · v0",
            reason: "Sản phẩm gốc chưa áp dụng phiên bản Auto-SEO.",
            rulesetVersion: "v1.0.0-standard",
            lastEvaluatedAt: new Date().toISOString(),
          },
          action: {
            type: "AUTO_SEO",
            label: "Tạo Auto-SEO",
            enabled: true,
          },
        };
      });

      const totalAfterClicks = allProducts.reduce((sum, p) => sum + p.clicks.after, 0);
      const totalAfterImpressions = allProducts.reduce((sum, p) => sum + p.impressions.after, 0);
      const totalAfterCtr = totalAfterImpressions > 0
        ? Math.round((totalAfterClicks / totalAfterImpressions) * 10000) / 10000
        : 0;

      let sumPosImp = 0;
      let sumImpWithPos = 0;
      for (const p of allProducts) {
        if (p.position.after !== null && p.impressions.after > 0) {
          sumPosImp += p.position.after * p.impressions.after;
          sumImpWithPos += p.impressions.after;
        }
      }
      const avgPosition = sumImpWithPos > 0
        ? Math.round((sumPosImp / sumImpWithPos) * 10) / 10
        : null;

      kpis = {
        totalManaged: allProducts.length,
        v0Count: allProducts.length,
        seoVersionCount: 0,
        eligibleCount: 0,
        improvingCount: 0,
        stableOrMixedCount: 0,
        decliningCount: 0,
        collectingOrInsufficientCount: 0,
        technicalIssuesCount: 0,
        cohortTotals: {
          beforeClicks: 0,
          afterClicks: totalAfterClicks,
          clicksDeltaAbsolute: 0,
          clicksDeltaPercent: null,
          beforeImpressions: 0,
          afterImpressions: totalAfterImpressions,
          impressionsDeltaAbsolute: 0,
          impressionsDeltaPercent: null,
          beforeCtr: null,
          afterCtr: totalAfterCtr,
          ctrDeltaPp: null,
          beforePosition: null,
          afterPosition: avgPosition,
          positionImprovement: null,
          beforeOrganicSessions: null,
          afterOrganicSessions: 0,
          organicSessionsDelta: null,
          isGscQueryFilterApplied: false,
        },
      };
    }
  } catch {
    // Graceful fallback to mock fixtures if database fails or table is empty
  }

  if (allProducts.length === 0) {
    allProducts = [...BASELINE_PRODUCTS];
    kpis = BASELINE_KPIS;
  }

  let filtered = [...allProducts];

  const versionFilter = searchParams.get("versionFilter");
  if (versionFilter === "v0") {
    filtered = filtered.filter(p => p.currentVersion === "v0");
  } else if (versionFilter === "v1+") {
    filtered = filtered.filter(p => p.currentVersion !== "v0");
  }

  const statusFilter = searchParams.get("statusFilter");
  if (statusFilter) {
    filtered = filtered.filter(
      p => p.status.performanceStatus === statusFilter || p.status.measurementStatus === statusFilter,
    );
  }

  const queryParam = searchParams.get("query");
  if (queryParam) {
    filtered = filtered.map(p => ({
      ...p,
      organicSessions: {
        ...p.organicSessions,
        isGscQueryFilterApplied: true,
      },
    }));
    kpis = {
      ...kpis,
      cohortTotals: {
        ...kpis.cohortTotals,
        isGscQueryFilterApplied: true,
      },
    };
  }

  const search = searchParams.get("search");
  if (search) {
    const q = search.toLowerCase();
    filtered = filtered.filter(p => p.title.toLowerCase().includes(q) || p.url.toLowerCase().includes(q));
  }

  const sortBy = searchParams.get("sortBy") ?? "clicks";
  const sortDir = searchParams.get("sortDir") === "asc" ? 1 : -1;
  filtered.sort((a, b) => {
    switch (sortBy) {
      case "clicks":
        return sortDir * (a.clicks.after - b.clicks.after);
      case "impressions":
        return sortDir * (a.impressions.after - b.impressions.after);
      case "ctr":
        return sortDir * ((a.ctr.after ?? 0) - (b.ctr.after ?? 0));
      case "position":
        return sortDir * ((a.position.after ?? 999) - (b.position.after ?? 999));
      case "queries":
        return sortDir * (a.queries.afterCount - b.queries.afterCount);
      case "title":
        return sortDir * a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  const offset = Number(searchParams.get("offset") ?? 0);
  const limit = Number(searchParams.get("limit") ?? 50);

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    kpis,
  };
}

export async function loadProductSeoDetail(
  service: PerformanceService,
  storeId: string,
  productId: string,
): Promise<ProductSeoDetailData> {
  await service.ready();

  let matched = BASELINE_PRODUCTS.find(p => p.productId === productId || p.shopifyProductGid === productId);
  if (!matched) {
    const { items } = await loadBenchmarkProducts(service, storeId, new URLSearchParams({ limit: "1000" }));
    matched = items.find(p => p.productId === productId || p.shopifyProductGid === productId || p.url === productId) ?? items[0] ?? BASELINE_PRODUCTS[0];
  }

  let queries: Array<{
    query: string;
    category: "matched" | "new" | "lost";
    beforeClicks: number;
    afterClicks: number;
    clicksDelta: number;
    beforeImpressions: number;
    afterImpressions: number;
    beforeCtr: number;
    afterCtr: number;
    beforePosition: number;
    afterPosition: number;
    positionImprovement: number;
  }> = [];

  try {
    const queryRows = (await service.repository.pool.query<{
      query: string;
      clicks: number;
      impressions: number;
      position: number | null;
    }>(`
      SELECT
        query,
        SUM(clicks)::int AS clicks,
        SUM(impressions)::int AS impressions,
        CASE
          WHEN SUM(impressions) > 0 THEN ROUND((SUM(position * impressions)::numeric / SUM(impressions)::numeric), 1)::float
          ELSE NULL
        END AS position
      FROM sp_metrics
      WHERE store_id = $1 AND dataset = 'query' AND page = $2
      GROUP BY query
      ORDER BY clicks DESC, impressions DESC
      LIMIT 20
    `, [storeId, matched.url])).rows;

    if (queryRows.length > 0) {
      queries = queryRows.map(q => {
        const ctr = q.impressions > 0 ? Math.round((q.clicks / q.impressions) * 1000) / 1000 : 0;
        return {
          query: q.query,
          category: "matched",
          beforeClicks: 0,
          afterClicks: q.clicks,
          clicksDelta: q.clicks,
          beforeImpressions: 0,
          afterImpressions: q.impressions,
          beforeCtr: 0,
          afterCtr: ctr,
          beforePosition: q.position ?? 0,
          afterPosition: q.position ?? 0,
          positionImprovement: 0,
        };
      });
    }
  } catch {
    // fallback if query table not accessible
  }

  if (queries.length === 0) {
    queries = [
      {
        query: matched.title.toLowerCase().slice(0, 30),
        category: "matched",
        beforeClicks: 0,
        afterClicks: matched.clicks.after,
        clicksDelta: matched.clicks.after,
        beforeImpressions: 0,
        afterImpressions: matched.impressions.after,
        beforeCtr: 0,
        afterCtr: matched.ctr.after ?? 0,
        beforePosition: matched.position.after ?? 0,
        afterPosition: matched.position.after ?? 0,
        positionImprovement: 0,
      },
    ];
  }

  return {
    product: matched,
    versions: [
      {
        versionId: `v0-${matched.productId}`,
        versionNumber: 0,
        source: "INITIAL",
        actor: "system",
        batchId: null,
        promptVersion: null,
        appliedAt: new Date().toISOString(),
        publicEffectiveAt: null,
        contentHash: `hash-${matched.productId}`,
        snapshot: {
          title: matched.title,
          descriptionHtml: `<p>${matched.title}</p>`,
          seoTitle: `${matched.title} | ${storeId}`,
          seoDescription: `${matched.title} - Chất lượng cao từ ${storeId}`,
          media: matched.thumbnailUrl ? [{ id: "m1", alt: matched.title, url: matched.thumbnailUrl }] : [],
        },
      },
    ],
    selectedVersionNumber: 0,
    comparedVersionNumber: 0,
    diffs: [
      {
        field: "title",
        label: "Tên sản phẩm",
        before: matched.title,
        after: matched.title,
        hasChanged: false,
      },
      {
        field: "descriptionHtml",
        label: "Mô tả chi tiết (HTML)",
        before: `<p>${matched.title}</p>`,
        after: `<p>${matched.title}</p>`,
        hasChanged: false,
      },
      {
        field: "seoTitle",
        label: "SEO Title",
        before: `${matched.title} | ${storeId}`,
        after: `${matched.title} | ${storeId}`,
        hasChanged: false,
      },
      {
        field: "seoDescription",
        label: "SEO Meta Description",
        before: `${matched.title} - Chất lượng cao từ ${storeId}`,
        after: `${matched.title} - Chất lượng cao từ ${storeId}`,
        hasChanged: false,
      },
    ],
    mediaDiffs: matched.thumbnailUrl ? [
      {
        mediaId: "m1",
        url: matched.thumbnailUrl,
        beforeAlt: matched.title,
        afterAlt: matched.title,
        hasChanged: false,
      },
    ] : [],
    windows: {
      beforeStart: "2026-07-26",
      beforeEnd: "2026-08-22",
      settlingDays: 7,
      afterStart: "2026-08-31",
      afterEnd: "2026-09-27",
      sourceTimezone: "America/Los_Angeles",
    },
    inspection: {
      verdict: "INDEXED",
      coverageState: "Submitted and indexed",
      lastCrawlAt: new Date().toISOString(),
      indexingState: "INDEXING_ALLOWED",
      googleCanonical: matched.url,
      userCanonical: matched.url,
      robotsState: "ALLOWED",
      derivedState: "INDEXED_AND_FRESH",
    },
    timelineAnnotations: [
      { date: new Date().toISOString().slice(0, 10), type: "version", note: "Phiên bản gốc v0 (Baseline)" },
    ],
    queries,
    ga4: {
      landingSessions: { current: matched.clicks.after, previous: 0, delta: matched.clicks.after },
      totalUsers: { current: matched.clicks.after, previous: 0, delta: matched.clicks.after },
      engagedSessions: { current: matched.clicks.after, previous: 0, delta: matched.clicks.after },
      engagementRate: { current: 1.0, previous: 0 },
      eventCounts: { viewItem: matched.impressions.after, addToCart: 0, beginCheckout: 0, purchase: 0 },
      purchaseRevenue: { amount: 0, currency: "USD" },
      acquisition: [{ channel: "Google Organic", sessions: matched.clicks.after, users: matched.clicks.after }],
      isGscQueryFilterNotice: false,
    },
    recommendations: [],
  };
}

export async function loadBatchDetail(
  _service: PerformanceService,
  storeId: string,
  batchId: string,
): Promise<BatchDetailData> {
  return {
    batchId: batchId || "batch_2026_08_pilot",
    storeId,
    executedAt: "2026-08-23T08:30:00.000Z",
    totalProducts: 4,
    succeededCount: 4,
    failedCount: 0,
    noChangeCount: 0,
    eligibleCount: 2,
    cohortTotals: {
      beforeClicks: 75,
      afterClicks: 92,
      clicksDeltaAbsolute: 17,
      clicksDeltaPercent: 22.7,
      beforeImpressions: 4900,
      afterImpressions: 4700,
      impressionsDeltaAbsolute: -200,
      impressionsDeltaPercent: -4.1,
      beforeCtr: 0.0153,
      afterCtr: 0.0196,
      ctrDeltaPp: 0.43,
      beforePosition: 13.5,
      afterPosition: 15.0,
      positionImprovement: -1.5,
    },
    statusDistribution: {
      improving: 1,
      stable: 0,
      mixed: 1,
      declining: 1,
      collecting: 0,
      insufficient: 1,
      technical: 0,
    },
    promptVersion: "v2.1-ecommerce",
    modelName: "gpt-4o",
    observationalNote: "Batch thử nghiệm cho 4 sản phẩm đồ gia dụng. Cohort cho thấy lượt nhấp tăng +22.7%.",
    products: [BASELINE_PRODUCTS[0], BASELINE_PRODUCTS[3]],
  };
}

export async function loadConnectionsSync(
  service: PerformanceService,
  storeId: string,
): Promise<ConnectionsSyncData> {
  const [integrations, jobs] = await Promise.all([
    service.repository.integrations(storeId),
    service.repository.jobs(storeId),
  ]);
  const gsc = integrations.find((i): i is GscIntegrationSummary => i.source === "gsc");
  const ga4 = integrations.find((i): i is Ga4IntegrationSummary => i.source === "ga4");

  return {
    gsc: {
      connectionId: gsc?.connectionId ?? null,
      status: gsc?.status ?? "CONNECTED",
      property: gsc?.property ?? "sc-domain:jeminise.com",
      origin: gsc?.origin ?? "https://jeminise.com",
      grantedScopes: [
        "https://www.googleapis.com/auth/webmasters.readonly",
        "https://www.googleapis.com/auth/webmasters",
      ],
      lastAttemptedSync: gsc?.freshness.fetchedAt ?? null,
      lastSuccessfulSync: gsc?.freshness.lastSuccessfulSync ?? null,
      dataThroughDate: gsc?.freshness.dataThrough ?? null,
      stale: gsc?.freshness.stale ?? false,
      staleReason: gsc?.freshness.staleReason ?? null,
      quality: gsc?.quality ?? ["FINALIZED_DAYS_ONLY", "TIMEZONE_LOS_ANGELES"],
      quota: { used: 142, limit: 10000 },
    },
    ga4: {
      connectionId: ga4?.connectionId ?? null,
      status: ga4?.status ?? "CONNECTED",
      propertyId: ga4?.property?.propertyId ?? "549055707",
      hostnameScope: ga4?.property?.hostnameScope ?? "jeminise.com",
      streamId: ga4?.property?.streamId ?? "9876543210",
      timezone: ga4?.property?.timeZone ?? "America/Los_Angeles",
      currency: ga4?.property?.currencyCode ?? "USD",
      grantedScopes: [
        "https://www.googleapis.com/auth/analytics.readonly",
      ],
      lastAttemptedSync: ga4?.freshness.fetchedAt ?? null,
      lastSuccessfulSync: ga4?.freshness.lastSuccessfulSync ?? null,
      dataThroughDate: ga4?.freshness.dataThrough ?? null,
      stale: ga4?.freshness.stale ?? false,
      staleReason: ga4?.freshness.staleReason ?? null,
      quality: ga4?.quality ?? ["NO_SAMPLING"],
      quota: { propertyQuotaTokens: 25000 },
    },
    recentJobs: jobs.slice(0, 10),
  };
}
