import type {
  BatchDetailData,
  BenchmarkProductItem,
  BenchmarkSummaryKpis,
  ConnectionsSyncData,
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

export async function loadBenchmarkProducts(
  _service: PerformanceService,
  _storeId: string,
  searchParams: URLSearchParams,
): Promise<{ readonly items: readonly BenchmarkProductItem[]; readonly total: number; readonly kpis: BenchmarkSummaryKpis }> {
  let filtered = [...BASELINE_PRODUCTS];

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
      case "title":
        return sortDir * a.title.localeCompare(b.title);
      default:
        return 0;
    }
  });

  const offset = Number(searchParams.get("offset") ?? 0);
  const limit = Number(searchParams.get("limit") ?? 20);

  const kpis: BenchmarkSummaryKpis = queryParam
    ? {
        ...BASELINE_KPIS,
        cohortTotals: {
          ...BASELINE_KPIS.cohortTotals,
          isGscQueryFilterApplied: true,
        },
      }
    : BASELINE_KPIS;

  return {
    items: filtered.slice(offset, offset + limit),
    total: filtered.length,
    kpis,
  };
}

export async function loadProductSeoDetail(
  _service: PerformanceService,
  _storeId: string,
  productId: string,
): Promise<ProductSeoDetailData> {
  const matched = BASELINE_PRODUCTS.find(p => p.productId === productId || p.shopifyProductGid === productId) ?? BASELINE_PRODUCTS[0];
  return {
    product: matched,
    versions: [
      {
        versionId: "v2-uuid",
        versionNumber: 2,
        source: "AUTO_SEO",
        actor: "codex-agent",
        batchId: "batch_2026_08_pilot",
        promptVersion: "v2.1-ecommerce",
        appliedAt: "2026-08-23T00:00:00.000Z",
        publicEffectiveAt: "2026-08-23T00:00:00.000Z",
        contentHash: "hash-v2-abc12345",
        snapshot: {
          title: matched.title,
          descriptionHtml: "<p>Chăn lông cừu tự nhiên mềm mại, giữ ấm vượt trội trong mùa đông lạnh giá.</p>",
          seoTitle: `${matched.title} | Jeminise`,
          seoDescription: "Chăn lông cừu tự nhiên đạt chứng nhận Oeko-Tex an toàn cho da.",
          media: [{ id: "m1", alt: "Chăn lông cừu gập gọn", url: matched.thumbnailUrl ?? "" }],
        },
      },
    ],
    selectedVersionNumber: 2,
    comparedVersionNumber: 1,
    diffs: [
      {
        field: "title",
        label: "Tên sản phẩm",
        before: "Chăn Lông Cừu",
        after: matched.title,
        hasChanged: true,
      },
      {
        field: "descriptionHtml",
        label: "Mô tả chi tiết (HTML)",
        before: "<p>Chăn dày ấm.</p>",
        after: "<p>Chăn lông cừu tự nhiên mềm mại, giữ ấm vượt trội trong mùa đông lạnh giá.</p>",
        hasChanged: true,
      },
      {
        field: "seoTitle",
        label: "SEO Title",
        before: "Chăn Lông Cừu",
        after: `${matched.title} | Jeminise`,
        hasChanged: true,
      },
      {
        field: "seoDescription",
        label: "SEO Meta Description",
        before: "Chăn lông cừu chất lượng.",
        after: "Chăn lông cừu tự nhiên đạt chứng nhận Oeko-Tex an toàn cho da.",
        hasChanged: true,
      },
    ],
    mediaDiffs: [
      {
        mediaId: "m1",
        url: matched.thumbnailUrl ?? "",
        beforeAlt: "(không có alt)",
        afterAlt: "Chăn lông cừu gập gọn",
        hasChanged: true,
      },
    ],
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
      lastCrawlAt: "2026-09-02T14:32:00.000Z",
      indexingState: "INDEXING_ALLOWED",
      googleCanonical: matched.url,
      userCanonical: matched.url,
      robotsState: "ALLOWED",
      derivedState: "INDEXED_AND_FRESH",
    },
    timelineAnnotations: [
      { date: "2026-08-23", type: "version", note: "Publish version v2 qua Auto-SEO" },
      { date: "2026-09-02", type: "version", note: "Google Search Console recrawl quan sát được" },
    ],
    queries: [
      {
        query: "chan long cuu cao cap",
        category: "matched",
        beforeClicks: 24,
        afterClicks: 42,
        clicksDelta: 18,
        beforeImpressions: 800,
        afterImpressions: 1100,
        beforeCtr: 0.03,
        afterCtr: 0.0382,
        beforePosition: 6.8,
        afterPosition: 4.1,
        positionImprovement: 2.7,
      },
    ],
    ga4: {
      landingSessions: { current: 85, previous: 58, delta: 27 },
      totalUsers: { current: 72, previous: 50, delta: 22 },
      engagedSessions: { current: 68, previous: 41, delta: 27 },
      engagementRate: { current: 0.8, previous: 0.7069 },
      eventCounts: { viewItem: 142, addToCart: 31, beginCheckout: 16, purchase: 9 },
      purchaseRevenue: { amount: 1125.0, currency: "USD" },
      acquisition: [{ channel: "Google Organic", sessions: 85, users: 72 }],
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
  const gsc = integrations.find(i => i.source === "gsc");
  const ga4 = integrations.find(i => i.source === "ga4");

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
      lastAttemptedSync: gsc?.freshness.fetchedAt ?? new Date().toISOString(),
      lastSuccessfulSync: gsc?.freshness.lastSuccessfulSync ?? new Date().toISOString(),
      dataThroughDate: gsc?.freshness.dataThrough ?? "2026-10-01",
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
      lastAttemptedSync: ga4?.freshness.fetchedAt ?? new Date().toISOString(),
      lastSuccessfulSync: ga4?.freshness.lastSuccessfulSync ?? new Date().toISOString(),
      dataThroughDate: ga4?.freshness.dataThrough ?? "2026-10-03",
      stale: ga4?.freshness.stale ?? false,
      staleReason: ga4?.freshness.staleReason ?? null,
      quality: ga4?.quality ?? ["NO_SAMPLING"],
      quota: { propertyQuotaTokens: 25000 },
    },
    recentJobs: jobs.slice(0, 10),
  };
}
