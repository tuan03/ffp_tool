import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import type {
  BatchDetailData,
  BenchmarkFilters,
  BenchmarkProductItem,
  BenchmarkSummaryKpis,
  ConnectionsSyncData,
  PageKind,
  PerformanceEvent,
  PerformanceList,
  PerformanceOverview,
  PerformancePage,
  ProductSeoDetailData,
  SearchMetrics,
  SeoPerformanceClient,
  SeoRecommendation,
} from "../types";
import { SearchDashboard } from "./SearchDashboard";
import { BenchmarkKpis } from "./components/BenchmarkKpis";
import { BenchmarkToolbar } from "./components/BenchmarkToolbar";
import { BenchmarkTable } from "./components/BenchmarkTable";
import { ProductSeoDetailModal } from "./components/ProductSeoDetailModal";
import { BatchDetailModal } from "./components/BatchDetailModal";
import { ConnectionsSyncView } from "./components/ConnectionsSyncView";
import { displayDate, JOB_LABELS } from "./presentation";

const control = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-40";
const button = `${control} text-cyan-300 hover:border-cyan-600`;

const opportunityLabels: Readonly<Record<string, string>> = {
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu để đánh giá hiệu suất",
  POSITION_OPPORTUNITY: "Cơ hội cải thiện vị trí 4–20",
  LOW_CTR_VS_PEERS: "CTR thấp hơn nhóm trang tương đồng",
  CLICKS_DECLINING: "Lượt nhấp giảm so với kỳ trước",
  HTTP_ERROR: "Lỗi HTTP",
  NOINDEX: "Có chỉ thị noindex — cần xác nhận chủ đích",
  TITLE_NOT_OBSERVED: "Chưa thấy title trong HTML",
  META_DESCRIPTION_NOT_OBSERVED: "Chưa thấy meta description",
  CANONICAL_NOT_OBSERVED: "Chưa thấy canonical",
  INVALID_JSON_LD: "JSON-LD không hợp lệ",
  AEO_NOT_OBSERVED: "Chưa thấy AEO đã lưu trong HTML công khai",
};

const empty = <T,>(): PerformanceList<T> => ({ items: [], total: 0, nextOffset: null });

export function SeoPerformancePage({ client }: { readonly client: SeoPerformanceClient }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [stores, setStores] = useState<Awaited<ReturnType<SeoPerformanceClient["stores"]>>>([]);
  const storeId = params.get("storeId") || readActiveStoreId(window.localStorage);

  // Top Area Navigation (5 mandatory views)
  const [area, setArea] = useState<"benchmark" | "search-overview" | "website" | "recommendations" | "connections-sync">("benchmark");

  // Overview & legacy states
  const [overview, setOverview] = useState<PerformanceOverview | null>(null);
  const [pages, setPages] = useState(empty<PerformancePage>);
  const [recommendations, setRecommendations] = useState(empty<SeoRecommendation>);
  const [history, setHistory] = useState(empty<PerformanceEvent>);
  const [queries, setQueries] = useState<PerformanceList<{ query: string; metrics: SearchMetrics }> | null>(null);
  const [queryUrl, setQueryUrl] = useState("");
  const [queryOffset, setQueryOffset] = useState(0);
  const [tab, setTab] = useState<"pages" | "recommendations" | "history">("pages");
  const [offset, setOffset] = useState(0);
  const [kind, setKind] = useState<PageKind | "">("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [properties, setProperties] = useState<Awaited<ReturnType<SeoPerformanceClient["properties"]>>>([]);
  const [property, setProperty] = useState("");
  const [origin, setOrigin] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);

  // Benchmark specific states
  const [benchmarkItems, setBenchmarkItems] = useState<readonly BenchmarkProductItem[]>([]);
  const [benchmarkTotal, setBenchmarkTotal] = useState(0);
  const [benchmarkKpis, setBenchmarkKpis] = useState<BenchmarkSummaryKpis | null>(null);
  const [benchmarkFilters, setBenchmarkFilters] = useState<BenchmarkFilters>({
    versionFilter: "all",
    windowDays: 28,
    comparisonMode: "version",
    sortBy: "clicks",
    sortDir: "desc",
  });
  const [benchmarkLoading, setBenchmarkLoading] = useState(false);

  // Modal states
  const [selectedProductDetail, setSelectedProductDetail] = useState<ProductSeoDetailData | null>(null);
  const [selectedBatchDetail, setSelectedBatchDetail] = useState<BatchDetailData | null>(null);
  const [connectionsSyncData, setConnectionsSyncData] = useState<ConnectionsSyncData | null>(null);

  // 1. Load Stores
  useEffect(() => {
    let live = true;
    void client
      .stores()
      .then(value => {
        if (live) setStores(value);
      })
      .catch(() => {
        if (live) setError("Không thể tải danh sách cửa hàng.");
      });
    return () => {
      live = false;
    };
  }, [client]);

  // Sync store param
  useEffect(() => {
    if (!storeId && stores[0]) setParams({ storeId: stores[0].storeId });
  }, [storeId, stores, setParams]);

  // Reset when store changes
  useEffect(() => {
    setOffset(0);
    setOverview(null);
    setPages(empty());
    setRecommendations(empty());
    setHistory(empty());
    setOrigin("");
    setProperty("");
    setConfirmed(false);
    setQueryUrl("");
    setQueries(null);
    setMessage("");
    setStartDate("");
    setEndDate("");
    setSelectedProductDetail(null);
    setSelectedBatchDetail(null);
    setConnectionsSyncData(null);
    setBenchmarkItems([]);
    setBenchmarkTotal(0);
    setBenchmarkKpis(null);
    if (storeId) persistBrowserActiveStoreId(storeId);
  }, [storeId]);

  // 2. Load Overview & Area Data
  useEffect(() => {
    if (!storeId) return;
    let live = true;
    setLoading(true);
    setError("");

    const filters = {
      offset,
      ...(kind ? { kind } : {}),
      search,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {}),
    };

    void (async () => {
      try {
        const summary = await client.overview(storeId, area === "website" ? filters : {});
        if (!live) return;
        setOverview(summary);

        if (area === "website") {
          const result = await client.pages(storeId, filters);
          if (live) setPages(result);
        }
        if (area === "recommendations" && tab === "recommendations") {
          const result = await client.recommendations(storeId, offset);
          if (live) setRecommendations(result);
        }
        if (area === "recommendations" && tab === "history") {
          const result = await client.history(storeId, offset);
          if (live) setHistory(result);
        }
      } catch (failure) {
        if (live) {
          setOverview(null);
          setPages(empty());
          setError(failure instanceof Error ? failure.message : "Không thể tải dữ liệu.");
        }
      } finally {
        if (live) setLoading(false);
      }
    })();

    return () => {
      live = false;
    };
  }, [client, storeId, offset, kind, search, startDate, endDate, tab, area, refresh]);

  // 3. Load Benchmark Data when in 'benchmark' area
  useEffect(() => {
    if (!storeId || area !== "benchmark") return;
    let live = true;
    setBenchmarkLoading(true);

    void client
      .benchmark(storeId, benchmarkFilters)
      .then(res => {
        if (live) {
          setBenchmarkItems(res.items);
          setBenchmarkTotal(res.total);
          setBenchmarkKpis(res.kpis);
        }
      })
      .catch(err => {
        if (live) setError(err instanceof Error ? err.message : "Không thể tải bảng Benchmark.");
      })
      .finally(() => {
        if (live) setBenchmarkLoading(false);
      });

    return () => {
      live = false;
    };
  }, [client, storeId, area, benchmarkFilters, refresh]);

  // 4. Load Connections & Sync Data when in 'connections-sync' area
  useEffect(() => {
    if (!storeId || area !== "connections-sync") return;
    let live = true;

    void client
      .connectionsSync(storeId)
      .then(res => {
        if (live) setConnectionsSyncData(res);
      })
      .catch(err => {
        if (live) setError(err instanceof Error ? err.message : "Không thể tải thông tin kết nối.");
      });

    return () => {
      live = false;
    };
  }, [client, storeId, area, refresh]);

  // Polling for running jobs
  useEffect(() => {
    if (!overview?.jobs.some(job => ["running", "pending"].includes(job.status))) return;
    const timer = setInterval(() => setRefresh(value => value + 1), 10000);
    return () => clearInterval(timer);
  }, [overview]);

  // Load queries for audit
  useEffect(() => {
    if (!queryUrl) return;
    let live = true;
    setQueries(null);
    void client
      .queries(storeId, queryUrl, {
        offset: queryOffset,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {}),
      })
      .then(result => {
        if (live) setQueries(result);
      })
      .catch(() => {
        if (live) setError("Không thể tải truy vấn.");
      });
    return () => {
      live = false;
    };
  }, [client, storeId, queryUrl, queryOffset, startDate, endDate]);

  async function action(run: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await run();
      setMessage(success);
      setRefresh(value => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Thao tác không thành công.");
      throw failure;
    } finally {
      setBusy(false);
    }
  }

  // Handle open Product SEO Detail
  const handleOpenProductDetail = async (product: BenchmarkProductItem) => {
    try {
      const detail = await client.productDetail(storeId, product.productId, {
        windowDays: benchmarkFilters.windowDays,
      });
      setSelectedProductDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải chi tiết sản phẩm.");
    }
  };

  // Handle open Batch Detail
  const handleOpenBatchDetail = async (batchId: string) => {
    try {
      const detail = await client.batchDetail(storeId, batchId);
      setSelectedBatchDetail(detail);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Không thể tải chi tiết batch.");
    }
  };

  // Handle Send to Auto-SEO from Table
  const handleSendToAutoSeoFromTable = async (product: BenchmarkProductItem) => {
    if (
      !window.confirm(
        `Tạo bản thảo yêu cầu Auto-SEO cho sản phẩm "${product.title}"? Dữ liệu đối chứng và snapshot sẽ được gửi an toàn sang Codex Queue.`,
      )
    ) {
      return;
    }
    await action(async () => {
      if (product.action.recommendationId) {
        await client.revise(storeId, product.action.recommendationId);
      } else {
        await client.start(storeId, "crawl");
      }
    }, `Đã tạo yêu cầu Auto-SEO cho "${product.title}". Xem tại tab Đề xuất hoặc SEO Queue.`);
  };

  const selected = tab === "pages" ? pages : tab === "recommendations" ? recommendations : history;

  return (
    <main className="mx-auto w-full min-w-0 max-w-7xl space-y-6 p-4 sm:p-6">
      {/* Top Header */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-cyan-300">SEO Performance Dashboard</h1>
          <p className="mt-1 text-sm text-slate-400">
            SEO Benchmark · Báo cáo Google Search Console & GA4 · Kiểm tra toàn diện website · Đề xuất có dẫn chứng
          </p>
        </div>
        <label className="grid min-w-0 gap-1 text-sm text-slate-400">
          Cửa hàng
          <select
            aria-label="Cửa hàng"
            className={`${control} w-full max-w-sm text-slate-100`}
            value={storeId}
            onChange={event => {
              setOffset(0);
              setParams({ storeId: event.target.value });
            }}
          >
            {stores.map(store => (
              <option key={store.storeId} value={store.storeId}>
                {store.storeId} ({store.shopDomain})
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 p-4 text-rose-300">
          {error}
        </p>
      )}
      {message && <p role="status" className="text-emerald-300">{message}</p>}

      {/* Main 5 Navigation Tabs */}
      <nav aria-label="Khu vực SEO Performance" className="flex flex-wrap gap-2 border-b border-slate-800 pb-3">
        {[
          ["benchmark", "SEO Benchmark"],
          ["search-overview", "Search Overview"],
          ["website", "Kiểm tra website"],
          ["recommendations", "Đề xuất cải thiện"],
          ["connections-sync", "Kết nối & Đồng bộ"],
        ].map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={area === value}
            className={`rounded-lg px-4 py-3 text-sm font-semibold transition-colors ${
              area === value ? "bg-cyan-400 text-slate-950 shadow" : "bg-slate-900 text-slate-400 hover:text-white"
            }`}
            onClick={() => {
              setArea(value as typeof area);
              setOffset(0);
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* VIEW 1: SEO BENCHMARK */}
      {area === "benchmark" && (
        <section aria-label="Màn hình SEO Benchmark" className="space-y-6">
          {benchmarkKpis && (
            <BenchmarkKpis
              kpis={benchmarkKpis}
              isQueryFilterActive={Boolean(benchmarkFilters.query && benchmarkFilters.query.trim().length > 0)}
              onStatusSelect={status => {
                if (status === "v0") {
                  setBenchmarkFilters(prev => ({ ...prev, versionFilter: "v0" }));
                } else {
                  setBenchmarkFilters(prev => ({ ...prev, statusFilter: status }));
                }
              }}
            />
          )}

          <BenchmarkToolbar
            filters={benchmarkFilters}
            onChange={newFilters => setBenchmarkFilters(newFilters)}
            items={benchmarkItems}
            storeId={storeId}
          />

          <BenchmarkTable
            items={benchmarkItems}
            loading={benchmarkLoading}
            sortBy={benchmarkFilters.sortBy}
            sortDir={benchmarkFilters.sortDir}
            onSort={col => {
              setBenchmarkFilters(prev => ({
                ...prev,
                sortBy: col as BenchmarkFilters["sortBy"],
                sortDir: prev.sortBy === col && prev.sortDir === "desc" ? "asc" : "desc",
              }));
            }}
            onSelectProduct={product => void handleOpenProductDetail(product)}
            onSelectBatch={batchId => void handleOpenBatchDetail(batchId)}
            onSendToAutoSeo={product => void handleSendToAutoSeoFromTable(product)}
          />

          <div className="flex items-center justify-between text-xs text-slate-400">
            <span>Hiển thị {benchmarkItems.length} trên tổng số {benchmarkTotal} sản phẩm.</span>
            <span>Quy chuẩn công thức: V1.0 Benchmark Spec (Rule 12.7 & 15.3).</span>
          </div>
        </section>
      )}

      {/* VIEW 2: SEARCH OVERVIEW */}
      {area === "search-overview" && (
        <section aria-label="Màn hình Search Overview" className="space-y-4">
          {overview?.mapping?.storeId === storeId && overview.connected && !overview.reconnectRequired ? (
            <SearchDashboard
              key={storeId}
              client={client}
              storeId={storeId}
              startDate={overview.startDate}
              endDate={overview.endDate}
            />
          ) : (
            <div className="rounded-xl border border-slate-800 p-8 text-center text-slate-400 space-y-3">
              <p>Chưa hoàn tất kết nối Search Console hoặc cần chọn property cho store này.</p>
              <button
                type="button"
                onClick={() => setArea("connections-sync")}
                className="rounded-lg bg-cyan-500 px-4 py-2 text-xs font-semibold text-slate-950"
              >
                Mở Cấu hình Kết nối & Đồng bộ
              </button>
            </div>
          )}
        </section>
      )}

      {/* VIEW 3: KIỂM TRA WEBSITE (AUDIT) */}
      {area === "website" && (
        <section className="space-y-5" aria-label="Kiểm tra website">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Tình trạng SEO của website</h2>
            <p className="mt-1 text-sm text-slate-400">
              Xem bằng chứng nội dung, SEO/AEO và các vấn đề kỹ thuật. Quét website không thay đổi sản phẩm.
            </p>
          </div>

          <section className="flex flex-wrap items-end gap-3">
            <label>
              Từ ngày{" "}
              <input
                type="date"
                className={control}
                value={startDate}
                onChange={event => {
                  setOffset(0);
                  setStartDate(event.target.value);
                }}
              />
            </label>
            <label>
              Đến ngày{" "}
              <input
                type="date"
                className={control}
                value={endDate}
                onChange={event => {
                  setOffset(0);
                  setEndDate(event.target.value);
                }}
              />
            </label>
            <button
              type="button"
              className={button}
              disabled={busy || !overview?.mapping || !overview.connected}
              onClick={() => void action(() => client.start(storeId, "gsc_sync"), "Đã yêu cầu đồng bộ GSC.")}
            >
              Đồng bộ GSC
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || !overview?.integrations?.some(i => i.source === "ga4" && i.status === "CONNECTED")}
              onClick={() => void action(() => client.start(storeId, "ga4_sync"), "Đã yêu cầu đồng bộ GA4.")}
            >
              Đồng bộ GA4
            </button>
            <button
              type="button"
              className={button}
              disabled={busy || !overview?.mapping}
              onClick={() => void action(() => client.start(storeId, "crawl"), "Đã yêu cầu kiểm tra website (tối đa 1.000 URL/lần).")}
            >
              Kiểm tra website
            </button>
            <button type="button" className={button} disabled={busy} onClick={() => setRefresh(v => v + 1)}>
              Làm mới
            </button>
          </section>

          <p className="text-sm text-slate-400">
            Số liệu tham khảo cho đánh giá: {displayDate(overview?.startDate)} → {displayDate(overview?.endDate)} · Đồng bộ: {displayDate(overview?.mapping?.lastSync)}
          </p>

          {overview?.jobs
            .filter(job => job.kind !== "report")
            .slice(0, 3)
            .map(job => (
              <p key={job.id} className="text-sm text-slate-400">
                {JOB_LABELS[job.kind]}: {JOB_LABELS[job.status]} · {job.progress}% {job.error ? `· ${job.error}` : ""}
              </p>
            ))}

          <div className="flex flex-wrap gap-3">
            <label>
              Loại trang{" "}
              <select
                aria-label="Loại trang"
                className={control}
                value={kind}
                onChange={event => {
                  setKind(event.target.value as PageKind | "");
                  setOffset(0);
                }}
              >
                <option value="">Tất cả</option>
                {Object.entries({
                  product: "Sản phẩm",
                  collection: "Bộ sưu tập",
                  blog: "Blog",
                  page: "Trang nội dung",
                  home: "Trang chủ",
                  other: "Khác",
                }).map(([val, lbl]) => (
                  <option key={val} value={val}>
                    {lbl}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tìm URL{" "}
              <input
                className={control}
                value={search}
                onChange={event => {
                  setSearch(event.target.value);
                  setOffset(0);
                }}
              />
            </label>
          </div>

          <div aria-busy={loading} className="space-y-3">
            {loading ? (
              <p role="status">Đang tải…</p>
            ) : error ? null : pages.total === 0 ? (
              <p className="rounded-xl border border-slate-800 p-8 text-slate-400">
                Chưa có trang phù hợp. Thử xóa bộ lọc hoặc bấm Kiểm tra website để thu thập bằng chứng.
              </p>
            ) : (
              pages.items.map(page => (
                <article key={page.url} className="space-y-2 rounded-xl border border-slate-800 p-4">
                  <a href={page.url} target="_blank" rel="noreferrer" className="break-all text-cyan-300">
                    {page.audit?.title || page.url}
                  </a>
                  <p className="break-all text-xs text-slate-500">
                    {page.url} · Kiểm tra: {displayDate(page.checkedAt)}
                  </p>
                  <p>
                    Clicks: {formatMetric(page.current, "clicks")} · Impressions:{" "}
                    {formatMetric(page.current, "impressions")} · CTR: {formatMetric(page.current, "ctr")} · Vị trí:{" "}
                    {formatMetric(page.current, "position")}
                  </p>
                  <p className="text-sm text-amber-200">
                    {page.opportunities.map(code => opportunityLabels[code] ?? code).join(" · ") ||
                      "Chưa phát hiện cơ hội nổi bật; không phải chứng nhận SEO hoàn chỉnh."}
                  </p>
                  {page.audit && (
                    <details>
                      <summary className="cursor-pointer text-sm">Bằng chứng HTML (không chạy JavaScript)</summary>
                      <p>
                        Canonical: {page.audit.canonical ?? "chưa quan sát"} · AEO: {page.audit.aeoVisibility} · Ảnh thiếu
                        alt: {page.audit.missingAltCount}
                      </p>
                      {page.audit.findings.map(finding => (
                        <p key={finding.code} className="text-sm">
                          {finding.status}: {finding.message}
                        </p>
                      ))}
                    </details>
                  )}
                  <button
                    type="button"
                    className={button}
                    onClick={() => {
                      setQueryOffset(0);
                      setQueryUrl(page.url);
                    }}
                  >
                    Xem truy vấn
                  </button>
                </article>
              ))
            )}
          </div>

          <footer className="flex items-center justify-between">
            <p>{pages.total} mục · Trang {offset / 50 + 1}</p>
            <div className="flex gap-3">
              <button
                type="button"
                className={button}
                disabled={loading || offset === 0}
                onClick={() => setOffset(v => Math.max(0, v - 50))}
              >
                Trang trước
              </button>
              <button
                type="button"
                className={button}
                disabled={loading || pages.nextOffset === null}
                onClick={() => {
                  if (pages.nextOffset !== null) setOffset(pages.nextOffset);
                }}
              >
                Trang sau
              </button>
            </div>
          </footer>
        </section>
      )}

      {/* VIEW 4: ĐỀ XUẤT CẢI THIỆN */}
      {area === "recommendations" && (
        <section className="space-y-5" aria-label="Đề xuất cải thiện">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">Đề xuất và lịch sử cải thiện</h2>
            <p className="mt-1 text-sm text-slate-400">
              Xem xét đề xuất trước khi tạo bản sửa. Không tự phê duyệt hoặc xuất bản lên Shopify.
            </p>
          </div>

          <nav aria-label="Đề xuất và lịch sử" className="flex gap-3">
            {[
              ["recommendations", "Đề xuất Codex"],
              ["history", "Lịch sử thay đổi"],
            ].map(([val, lbl]) => (
              <button
                type="button"
                key={val}
                aria-pressed={tab === val}
                className={`${button} ${tab === val ? "border-cyan-500" : ""}`}
                onClick={() => {
                  setTab(val as typeof tab);
                  setOffset(0);
                }}
              >
                {lbl}
              </button>
            ))}
          </nav>

          <div aria-busy={loading} className="space-y-3">
            {loading ? (
              <p role="status">Đang tải…</p>
            ) : error ? null : selected.total === 0 ? (
              <p className="rounded-xl border border-slate-800 p-8 text-slate-400">
                {tab === "recommendations"
                  ? "Chưa có đề xuất. Sau khi kiểm tra website, bạn có thể yêu cầu Codex đánh giá và lưu đề xuất cải thiện."
                  : "Chưa có lịch sử thay đổi cho cửa hàng này."}
              </p>
            ) : tab === "recommendations" ? (
              recommendations.items.map(rec => (
                <article key={rec.id} className="space-y-2 rounded-xl border border-slate-800 p-4">
                  <h3 className="font-semibold text-slate-200">{rec.issue}</h3>
                  <p className="text-sm text-cyan-300">{rec.url}</p>
                  <p className="text-sm text-slate-400">
                    {rec.priority} · Tin cậy: {rec.confidence} · {rec.status} · {rec.actor}
                  </p>
                  <details>
                    <summary className="cursor-pointer text-slate-300">Dẫn chứng và nội dung đề xuất</summary>
                    <p className="whitespace-pre-wrap text-slate-400">{rec.evidence.join("\n")}</p>
                    <p className="mt-3 whitespace-pre-wrap text-slate-200">{rec.proposed}</p>
                    <p className="text-slate-400">Lý do: {rec.rationale}</p>
                    <p className="text-slate-400">Rủi ro: {rec.risk}</p>
                    <p className="text-slate-500">{rec.startDate} → {rec.endDate} · {rec.rulesVersion}</p>
                  </details>
                  {rec.status === "proposed" && (
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className={button}
                        disabled={busy || !/\/products\//.test(rec.url)}
                        onClick={() => {
                          if (window.confirm("Tạo job SEO mới để Codex xử lý qua đủ checkpoint? Chưa đồng bộ Shopify.")) {
                            void action(() => client.revise(storeId, rec.id), "Đã tạo bản sửa trong SEO Queue; chưa xuất bản.");
                          }
                        }}
                      >
                        Tạo bản sửa SEO
                      </button>
                      <button
                        type="button"
                        className={button}
                        disabled={busy}
                        onClick={() => void action(() => client.dismiss(storeId, rec.id), "Đã bỏ qua đề xuất.")}
                      >
                        Bỏ qua
                      </button>
                    </div>
                  )}
                  {rec.jobId && (
                    <Link className="text-cyan-300 text-sm hover:underline" to={`/gpt-seo?storeId=${encodeURIComponent(storeId)}`}>
                      Mở SEO Queue →
                    </Link>
                  )}
                </article>
              ))
            ) : (
              history.items.map(event => (
                <article key={event.id} className="rounded-xl border border-slate-800 p-4">
                  <p className="text-slate-200">{event.event} · {event.createdAt}</p>
                  <details>
                    <summary className="text-slate-400">Chi tiết</summary>
                    <pre className="overflow-auto whitespace-pre-wrap text-xs text-slate-400">
                      {JSON.stringify(event.details, null, 2)}
                    </pre>
                  </details>
                </article>
              ))
            )}
          </div>
        </section>
      )}

      {/* VIEW 5: KẾT NỐI & ĐỒNG BỘ */}
      {area === "connections-sync" && (
        <section aria-label="Màn hình Kết nối & Đồng bộ" className="space-y-6">
          {connectionsSyncData ? (
            <ConnectionsSyncView
              data={connectionsSyncData}
              storeId={storeId}
              onSyncGsc={() => action(() => client.start(storeId, "gsc_sync"), "Đã bắt đầu đồng bộ Google Search Console.")}
              onSyncGa4={() => action(() => client.start(storeId, "ga4_sync"), "Đã bắt đầu đồng bộ Google Analytics 4.")}
              onMapGa4={input =>
                action(() => client.mapGa4(storeId, input), "Đã lưu cấu hình Google Analytics 4 thành công.")
              }
              onBackfill={(source, days) =>
                action(() => client.backfill(storeId, source, days), `Đã khởi động tác vụ Backfill ${source.toUpperCase()} ${days} ngày.`)
              }
              onCrawlWebsite={() => action(() => client.start(storeId, "crawl"), "Đã yêu cầu kiểm tra website.")}
              onReconnect={async () => {
                const conn = await client.connect(storeId);
                window.location.assign(conn.url);
              }}
            />
          ) : (
            <div className="rounded-xl border border-slate-800 p-8 text-center text-slate-400">
              Đang nạp dữ liệu kết nối...
            </div>
          )}

          {/* Fallback Legacy Mapping Config */}
          <details
            key={`${storeId}:${Boolean(overview?.mapping)}`}
            open={!overview?.mapping || overview.reconnectRequired}
            className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-4"
          >
            <summary className="cursor-pointer text-sm font-semibold text-slate-300">
              Cấu hình Mapping Tên miền & Property
            </summary>
            <p className="text-xs text-slate-400">
              {overview?.mapping
                ? `${overview.mapping.origin} → ${overview.mapping.property}`
                : "Chọn property và xác nhận tên miền storefront, không mặc định dùng myshopify.com."}
            </p>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                className={button}
                disabled={busy || !overview?.connected}
                onClick={() =>
                  void action(async () => setProperties(await client.properties(storeId)), "Đã tải danh sách property.")
                }
              >
                Tải lại danh sách property
              </button>
            </div>
            {!overview?.mapping && properties.length > 0 && (
              <div className="flex flex-wrap items-center gap-3 pt-2">
                <label className="text-xs text-slate-400">
                  Property{" "}
                  <select className={control} value={property} onChange={e => setProperty(e.target.value)}>
                    <option value="">Chọn property</option>
                    {properties.map(site => (
                      <option key={site.siteUrl}>{site.siteUrl}</option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Storefront{" "}
                  <input
                    className={control}
                    placeholder="https://shop.example.com"
                    value={origin}
                    onChange={e => setOrigin(e.target.value)}
                  />
                </label>
                <label className="text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={e => setConfirmed(e.target.checked)}
                  />{" "}
                  Đúng tên miền của store đang chọn
                </label>
                <button
                  type="button"
                  className={button}
                  disabled={busy || !confirmed || !property || !origin}
                  onClick={() =>
                    void action(() => client.map(storeId, property, origin), "Đã lưu mapping và bắt đầu đồng bộ.")
                  }
                >
                  Lưu mapping
                </button>
              </div>
            )}
          </details>
        </section>
      )}

      {/* MODAL 1: Product SEO Detail Modal (5 tabs) */}
      {selectedProductDetail && (
        <ProductSeoDetailModal
          data={selectedProductDetail}
          onClose={() => setSelectedProductDetail(null)}
          onSendToAutoSeo={async (_prodId, recId) => {
            if (recId) {
              await client.revise(storeId, recId);
            } else {
              await client.start(storeId, "crawl");
            }
            setRefresh(v => v + 1);
          }}
        />
      )}

      {/* MODAL 2: Batch Detail Modal */}
      {selectedBatchDetail && (
        <BatchDetailModal
          data={selectedBatchDetail}
          onClose={() => setSelectedBatchDetail(null)}
          onSelectProduct={p => {
            setSelectedBatchDetail(null);
            void handleOpenProductDetail(p);
          }}
        />
      )}
    </main>
  );
}

function formatMetric(metrics: SearchMetrics | null | undefined, key: keyof SearchMetrics): string {
  if (!metrics) return "Chưa có dữ liệu";
  return key === "ctr"
    ? `${(metrics.ctr * 100).toFixed(2)}%`
    : key === "position"
      ? metrics.position.toFixed(1)
      : metrics[key].toLocaleString();
}
