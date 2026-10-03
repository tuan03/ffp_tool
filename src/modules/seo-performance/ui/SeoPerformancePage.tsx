import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { persistBrowserActiveStoreId, readActiveStoreId } from "../../../shared/active-store";
import type { PageKind, PerformanceList, PerformancePage, PerformanceOverview, SeoPerformanceClient, SeoRecommendation, PerformanceEvent, SearchMetrics } from "../types";
import { SearchDashboard } from "./SearchDashboard";

const control = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm disabled:opacity-40";
const button = `${control} text-cyan-300 hover:border-cyan-600`;
const opportunityLabels: Readonly<Record<string, string>> = {
  INSUFFICIENT_DATA: "Chưa đủ dữ liệu để đánh giá hiệu suất", POSITION_OPPORTUNITY: "Cơ hội cải thiện vị trí 4–20",
  LOW_CTR_VS_PEERS: "CTR thấp hơn nhóm trang tương đồng", CLICKS_DECLINING: "Lượt nhấp giảm so với kỳ trước",
  HTTP_ERROR: "Lỗi HTTP", NOINDEX: "Có chỉ thị noindex — cần xác nhận chủ đích", TITLE_NOT_OBSERVED: "Chưa thấy title trong HTML",
  META_DESCRIPTION_NOT_OBSERVED: "Chưa thấy meta description", CANONICAL_NOT_OBSERVED: "Chưa thấy canonical",
  INVALID_JSON_LD: "JSON-LD không hợp lệ", AEO_NOT_OBSERVED: "Chưa thấy AEO đã lưu trong HTML công khai",
};
const empty = <T,>(): PerformanceList<T> => ({ items: [], total: 0, nextOffset: null });
export function SeoPerformancePage({ client }: { readonly client: SeoPerformanceClient }): React.JSX.Element {
  const [params, setParams] = useSearchParams();
  const [stores, setStores] = useState<Awaited<ReturnType<SeoPerformanceClient["stores"]>>>([]);
  const storeId = params.get("storeId") || readActiveStoreId(window.localStorage);
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
  useEffect(() => {
    let live = true;
    void client.stores().then(value => { if (live) setStores(value); }).catch(() => { if (live) setError("Không thể tải danh sách cửa hàng."); });
    return () => { live = false; };
  }, [client]);
  useEffect(() => {
    if (!storeId && stores[0]) setParams({ storeId: stores[0].storeId });
  }, [storeId, stores, setParams]);
  useEffect(() => {
    setOffset(0); setOverview(null); setPages(empty()); setRecommendations(empty()); setHistory(empty()); setOrigin(""); setProperty(""); setConfirmed(false); setQueryUrl(""); setQueries(null);
    if (storeId) persistBrowserActiveStoreId(storeId);
  }, [storeId]);
  useEffect(() => {
    if (!storeId) return;
    let live = true;
    setLoading(true); setError("");
    const filters = { offset, ...(kind ? { kind } : {}), search, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) };
    void (async () => {
      try {
        const summary = await client.overview(storeId, filters);
        if (!live) return;
        setOverview(summary);
        if (tab === "pages") { const result = await client.pages(storeId, filters); if (live) setPages(result); }
        if (tab === "recommendations") { const result = await client.recommendations(storeId, offset); if (live) setRecommendations(result); }
        if (tab === "history") { const result = await client.history(storeId, offset); if (live) setHistory(result); }
      } catch (failure) { if (live) { setOverview(null); setPages(empty()); setError(failure instanceof Error ? failure.message : "Không thể tải dữ liệu."); } }
      finally { if (live) setLoading(false); }
    })();
    return () => { live = false; };
  }, [client, storeId, offset, kind, search, startDate, endDate, tab, refresh]);
  useEffect(() => {
    if (!overview?.jobs.some(job => ["running", "pending"].includes(job.status))) return;
    const timer = setInterval(() => setRefresh(value => value + 1), 10000);
    return () => clearInterval(timer);
  }, [overview]);
  useEffect(() => {
    if (!queryUrl) return;
    let live = true;
    setQueries(null);
    void client.queries(storeId, queryUrl, { offset: queryOffset, ...(startDate ? { startDate } : {}), ...(endDate ? { endDate } : {}) }).then(result => { if (live) setQueries(result); }).catch(() => { if (live) setError("Không thể tải truy vấn."); });
    return () => { live = false; };
  }, [client, storeId, queryUrl, queryOffset, startDate, endDate]);
  async function action(run: () => Promise<unknown>, success: string): Promise<void> {
    setBusy(true); setError(""); setMessage("");
    try { await run(); setMessage(success); setRefresh(value => value + 1); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Thao tác không thành công."); }
    finally { setBusy(false); }
  }
  const selected = tab === "pages" ? pages : tab === "recommendations" ? recommendations : history;
  return <main className="mx-auto w-full max-w-7xl space-y-6 p-6">
    <header className="flex flex-wrap items-center justify-between gap-4"><div><h1 className="text-2xl font-bold text-cyan-300">SEO Performance</h1><p className="mt-1 text-sm text-slate-400">Hiệu suất Google · kiểm tra toàn website · đề xuất có dẫn chứng</p></div>
      <label>Cửa hàng <select className={control} value={storeId} onChange={event => { setOffset(0); setParams({ storeId: event.target.value }); }}>{stores.map(store => <option key={store.storeId} value={store.storeId}>{store.storeId} ({store.shopDomain})</option>)}</select></label>
    </header>
    {error && <p role="alert" className="rounded-lg border border-rose-800 bg-rose-950/30 p-4 text-rose-300">{error}</p>}
    {message && <p role="status" className="text-emerald-300">{message}</p>}
    <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900/50 p-5"><h2 className="font-semibold">Kết nối Search Console</h2>
      <p className="text-sm text-slate-400">{overview?.mapping ? `${overview.mapping.origin} → ${overview.mapping.property}` : "Chọn property và xác nhận tên miền storefront, không mặc định dùng myshopify.com."}</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className={button} disabled={busy || !overview?.configured} onClick={() => void action(async () => { const connection = await client.connect(); window.location.assign(connection.url); }, "")}>{overview?.connected ? "Kết nối lại Google" : "Kết nối Google"}</button>
        <button type="button" className={button} disabled={busy || !overview?.connected} onClick={() => void action(async () => setProperties(await client.properties()), "Đã tải danh sách property.")}>Tải property</button>
        <button type="button" className={button} disabled={busy || !overview?.connected} onClick={() => { if (window.confirm("Ngắt kết nối Google sẽ dừng đồng bộ cho tất cả store. Dữ liệu đã lưu được giữ lại. Tiếp tục?")) void action(() => client.disconnect(), "Đã ngắt kết nối."); }}>Ngắt kết nối</button>
      </div>
      {overview && !overview.configured && <p className="text-amber-300">Cần cấu hình GSC_CLIENT_ID, GSC_CLIENT_SECRET, GSC_REDIRECT_URI và khóa mã hóa trên Gateway.</p>}
      {overview?.reconnectRequired && <p className="text-amber-300">Quyền Google đã hết hiệu lực. Hãy kết nối lại; số liệu bên dưới có thể đã cũ.</p>}
      {!overview?.mapping && properties.length > 0 && <div className="flex flex-wrap items-center gap-3">
        <label>Property <select className={control} value={property} onChange={event => setProperty(event.target.value)}><option value="">Chọn property</option>{properties.map(site => <option key={site.siteUrl}>{site.siteUrl}</option>)}</select></label>
        <label>Storefront <input className={control} placeholder="https://shop.example.com" value={origin} onChange={event => setOrigin(event.target.value)} /></label>
        <label className="text-sm"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} /> Đúng tên miền của store đang chọn</label>
        <button type="button" className={button} disabled={busy || !confirmed || !property || !origin} onClick={() => void action(() => client.map(storeId, property, origin), "Đã lưu mapping và bắt đầu đồng bộ.")}>Lưu mapping</button>
      </div>}
    </section>
    {overview?.mapping && overview.connected && !overview.reconnectRequired && <SearchDashboard key={storeId} client={client} storeId={storeId} startDate={overview.startDate} endDate={overview.endDate} />}
    <h2 className="font-semibold">Dữ liệu kiểm tra website và đánh giá SEO (bộ lọc riêng)</h2>
    <section className="flex flex-wrap items-end gap-3">
      <label>Từ ngày <input type="date" className={control} value={startDate} onChange={event => { setOffset(0); setStartDate(event.target.value); }} /></label>
      <label>Đến ngày <input type="date" className={control} value={endDate} onChange={event => { setOffset(0); setEndDate(event.target.value); }} /></label>
      <button type="button" className={button} disabled={busy || !overview?.mapping || !overview.connected} onClick={() => void action(() => client.start(storeId, "sync"), "Đã yêu cầu đồng bộ nền.")}>Đồng bộ Google</button>
      <button type="button" className={button} disabled={busy || !overview?.mapping} onClick={() => void action(() => client.start(storeId, "crawl"), "Đã yêu cầu kiểm tra website (tối đa 1.000 URL/lần).")}>Kiểm tra website</button>
      <button type="button" className={button} disabled={busy} onClick={() => setRefresh(value => value + 1)}>Làm mới</button>
    </section>
    <p className="text-sm text-slate-400">{overview?.startDate} → {overview?.endDate} · So sánh kỳ trước cùng độ dài · Đồng bộ: {overview?.mapping?.lastSync ?? "chưa có"}</p>
    <p className="text-sm text-amber-200/80">{overview?.notice}</p>
    {overview?.jobs.map(job => <p key={job.id} className="text-sm text-slate-400">{job.kind}: {job.status} · {job.progress}% {job.error ? `· ${job.error}` : ""}</p>)}
    <nav className="flex gap-3">{([['pages', 'Trang & tình trạng SEO'], ['recommendations', 'Đề xuất Codex'], ['history', 'Lịch sử thay đổi']] as const).map(([value, label]) => <button type="button" className={`${button} ${tab === value ? "border-cyan-500" : ""}`} key={value} onClick={() => { setTab(value); setOffset(0); }}>{label}</button>)}</nav>
    {tab === "pages" && <div className="flex gap-3"><label>Loại trang <select className={control} value={kind} onChange={event => { setKind(event.target.value as PageKind | ""); setOffset(0); }}><option value="">Tất cả</option>{["product", "collection", "blog", "page", "home", "other"].map(value => <option key={value}>{value}</option>)}</select></label><label>Tìm URL <input className={control} value={search} onChange={event => { setSearch(event.target.value); setOffset(0); }} /></label></div>}
    <div aria-busy={loading} className="space-y-3">
      {loading ? <p role="status">Đang tải…</p> : error ? null : selected.total === 0 ? <p className="rounded-xl border border-slate-800 p-8 text-slate-400">Chưa có dữ liệu cho bộ lọc này. Nếu mới kết nối, hãy đợi đồng bộ hoặc chạy kiểm tra website.</p> : tab === "pages" ? pages.items.map(page => <article key={page.url} className="space-y-2 rounded-xl border border-slate-800 p-4">
        <a href={page.url} target="_blank" rel="noreferrer" className="break-all text-cyan-300">{page.audit?.title || page.url}</a><p className="text-xs text-slate-500">{page.url} · {page.kind} · Kiểm tra: {page.checkedAt ?? "chưa kiểm tra"}</p>
        <p>Clicks: {formatMetric(page.current, "clicks")} · Impressions: {formatMetric(page.current, "impressions")} · CTR: {formatMetric(page.current, "ctr")} · Vị trí: {formatMetric(page.current, "position")}</p>
        <p className="text-sm text-amber-200">{page.opportunities.map(code => opportunityLabels[code] ?? code).join(" · ") || "Chưa phát hiện cơ hội nổi bật; không phải chứng nhận SEO hoàn chỉnh."}</p>
        {page.audit && <details><summary className="cursor-pointer text-sm">Bằng chứng HTML (không chạy JavaScript)</summary><p>Canonical: {page.audit.canonical ?? "chưa quan sát"} · AEO: {page.audit.aeoVisibility} · Ảnh thiếu alt: {page.audit.missingAltCount}</p>{page.audit.findings.map(finding => <p key={finding.code} className="text-sm">{finding.status}: {finding.message}</p>)}</details>}
        <button type="button" className={button} onClick={() => { setQueryOffset(0); setQueryUrl(page.url); }}>Xem truy vấn</button>
      </article>) : tab === "recommendations" ? recommendations.items.map(recommendation => <article key={recommendation.id} className="space-y-2 rounded-xl border border-slate-800 p-4">
        <h3 className="font-semibold">{recommendation.issue}</h3><p className="text-sm text-cyan-300">{recommendation.url}</p><p className="text-sm text-slate-400">{recommendation.priority} · Tin cậy: {recommendation.confidence} · {recommendation.status} · {recommendation.actor}</p>
        <details><summary className="cursor-pointer">Dẫn chứng và nội dung đề xuất</summary><p className="whitespace-pre-wrap">{recommendation.evidence.join("\n")}</p><p className="mt-3 whitespace-pre-wrap">{recommendation.proposed}</p><p>Lý do: {recommendation.rationale}</p><p>Rủi ro: {recommendation.risk}</p><p>{recommendation.startDate} → {recommendation.endDate} · {recommendation.rulesVersion}</p></details>
        {recommendation.status === "proposed" && <div className="flex gap-3"><button type="button" className={button} disabled={busy || !/\/products\//.test(recommendation.url)} onClick={() => { if (window.confirm("Tạo job SEO mới để Codex xử lý qua đủ checkpoint? Chưa đồng bộ Shopify.")) void action(() => client.revise(storeId, recommendation.id), "Đã tạo bản sửa trong SEO Queue; chưa xuất bản."); }}>Tạo bản sửa SEO</button><button type="button" className={button} disabled={busy} onClick={() => void action(() => client.dismiss(storeId, recommendation.id), "Đã bỏ qua đề xuất.")}>Bỏ qua</button></div>}
        {recommendation.jobId && <Link className="text-cyan-300" to={`/gpt-seo?storeId=${encodeURIComponent(storeId)}`}>Mở SEO Queue →</Link>}
        {!/\/products\//.test(recommendation.url) && <p className="text-sm text-slate-400">Công việc thủ công: giao nội dung này cho người phụ trách website; không tự sửa theme/blog/collection.</p>}
      </article>) : history.items.map(event => <article key={event.id} className="rounded-xl border border-slate-800 p-4"><p>{event.event} · {event.createdAt}</p><details><summary>Chi tiết</summary><pre className="overflow-auto whitespace-pre-wrap text-xs text-slate-400">{JSON.stringify(event.details, null, 2)}</pre></details></article>)}
    </div>
    <footer className="flex items-center justify-between"><p>{selected.total} mục · Trang {offset / 50 + 1}</p><div className="flex gap-3"><button type="button" className={button} disabled={loading || offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Trang trước</button><button type="button" className={button} disabled={loading || selected.nextOffset === null} onClick={() => { if (selected.nextOffset !== null) setOffset(selected.nextOffset); }}>Trang sau</button></div></footer>
    {queryUrl && <section className="space-y-2 rounded-xl border border-cyan-900 p-4"><div className="flex justify-between"><h2>Truy vấn: {queryUrl}</h2><button type="button" className={button} onClick={() => setQueryUrl("")}>Đóng</button></div>{queries === null ? <p>Đang tải…</p> : queries.items.length === 0 ? <p>Chưa có truy vấn được Google trả về cho trang/kỳ này.</p> : queries.items.map(row => <p key={row.query}>{row.query} · {row.metrics.clicks} clicks · {row.metrics.impressions} impressions · {formatMetric(row.metrics, "position")}</p>)}<button type="button" className={button} disabled={!queryOffset} onClick={() => setQueryOffset(value => Math.max(0, value - 50))}>Trước</button><button type="button" className={button} disabled={queries?.nextOffset == null} onClick={() => { if (queries?.nextOffset != null) setQueryOffset(queries.nextOffset); }}>Sau</button></section>}
    <p className="text-sm text-slate-500">Codex đọc qua MCP khi bạn yêu cầu; FFP không tự gọi AI chạy nền. Đề xuất phải qua người duyệt, không có quyền publish trong MCP.</p>
  </main>;
}
function formatMetric(metrics: SearchMetrics | null | undefined, key: keyof SearchMetrics): string { if (!metrics) return "Chưa có dữ liệu"; return key === "ctr" ? `${(metrics.ctr * 100).toFixed(2)}%` : key === "position" ? metrics.position.toFixed(1) : metrics[key].toLocaleString(); }
