import { useEffect, useState } from "react";

import type { SearchMetrics, SearchReport, SearchReportFilters, SearchReportView, SeoPerformanceClient } from "../types";

const control = "rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-40";
const metrics = ["clicks", "impressions", "ctr", "position"] as const;
function format(value: number | null | undefined, metric: keyof SearchMetrics): string {
  return value == null ? "—" : metric === "ctr" ? `${(value * 100).toFixed(2)}%` : metric === "position" ? value.toFixed(2) : value.toLocaleString();
}
export function SearchDashboard({ client, storeId, startDate, endDate }: { readonly client: SeoPerformanceClient; readonly storeId: string; readonly startDate: string; readonly endDate: string }): React.JSX.Element {
  const [draft, setDraft] = useState<SearchReportFilters>({ startDate, endDate });
  const [filters, setFilters] = useState<SearchReportFilters>({ startDate, endDate });
  const [view, setView] = useState<SearchReportView>({ dimension: "query", order: "top", metric: "clicks", offset: 0 });
  const [report, setReport] = useState<SearchReport | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let live = true; let timer: ReturnType<typeof setTimeout> | undefined;
    setReport(null); setError("");
    async function load(): Promise<void> {
      try {
        const value = await client.report(storeId, filters, view);
        if (!live) return;
        setReport(value);
        if (value.status === "pending" || value.status === "running") timer = setTimeout(() => void load(), 4000);
      } catch (failure) { if (live) { setReport(null); setError(failure instanceof Error ? failure.message : "Không thể tải báo cáo."); } }
    }
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [client, storeId, filters, view, refresh]);
  return <section className="space-y-5 rounded-xl border border-cyan-900 p-5" aria-label="Dashboard Search Console">
    <h2 className="text-xl font-semibold text-cyan-300">Dashboard Google Search Console</h2>
    <form className="flex flex-wrap items-end gap-3" onSubmit={event => {
      event.preventDefault();
      const days = (Date.parse(draft.endDate) - Date.parse(draft.startDate)) / 86400000 + 1;
      if (!(days >= 1 && days <= 90)) { setError("Chọn kỳ từ 1–90 ngày, ngày bắt đầu không sau ngày kết thúc."); return; }
      setFilters({ ...draft }); setView(previous => ({ ...previous, offset: 0 }));
    }}>
      <label className="grid gap-1">Từ ngày<input required type="date" className={control} value={draft.startDate} max={draft.endDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label>
      <label className="grid gap-1">Đến ngày<input required type="date" className={control} value={draft.endDate} min={draft.startDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
      <label className="grid gap-1">Country<input className={control} placeholder="usa, vnm…" pattern="[a-zA-Z]{3}" maxLength={3} value={draft.country ?? ""} onChange={event => setDraft({ ...draft, country: event.target.value || undefined })} /></label>
      <label className="grid gap-1">Device<select className={control} value={draft.device ?? ""} onChange={event => setDraft({ ...draft, device: event.target.value as SearchReportFilters["device"] || undefined })}><option value="">Tất cả</option>{["DESKTOP", "MOBILE", "TABLET"].map(value => <option key={value}>{value}</option>)}</select></label>
      <label className="grid gap-1">Query chứa<input className={control} maxLength={1000} value={draft.query ?? ""} onChange={event => setDraft({ ...draft, query: event.target.value })} /></label>
      <label className="grid gap-1">Page chứa<input className={control} maxLength={1000} value={draft.page ?? ""} onChange={event => setDraft({ ...draft, page: event.target.value })} /></label>
      <button type="submit" className={control}>Áp dụng bộ lọc</button>
      <button type="button" className={control} onClick={() => setRefresh(value => value + 1)}>Làm mới trạng thái</button>
    </form>
    <p className="text-sm text-slate-400">Bộ lọc áp dụng cho toàn bộ KPI, biểu đồ và bảng bên dưới. Store/property theo lựa chọn phía trên. Kỳ hiện tại: {filters.startDate} → {filters.endDate}. Kỳ tối đa 90 ngày; ngày kết thúc tối đa hôm nay trừ 3 ngày theo giờ Google.</p>
    {error && <p role="alert" className="text-rose-300">{error}</p>}
    {!error && !report && <p role="status">Đang tải báo cáo…</p>}
    {report && <>
      <p className="text-sm text-slate-400">{report.property} · Kỳ trước: {report.previousStart} → {report.previousEnd} · Cache: {report.fetchedAt ?? "chưa có"}</p>
      {report.status !== "done" && <p role="status" className={report.error ? "text-rose-300" : "text-cyan-300"}>Báo cáo: {report.status} · {report.progress}% {report.error ? `· ${report.error}. Chưa có báo cáo hoàn chỉnh.` : "· Dữ liệu sẽ hiện khi hoàn thành."}</p>}
      {report.stale && <p className="text-amber-300">Dữ liệu chưa được xác minh mới; xem trạng thái kết nối/đồng bộ. {report.error}</p>}
      {report.status === "done" && <>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(metric => <article key={metric} className="rounded-xl bg-slate-900 p-4"><h3>{metric}</h3><p className="text-2xl text-cyan-300">{format(report.current?.[metric], metric)}</p><p className="text-sm text-slate-400">Kỳ trước: {format(report.previous?.[metric], metric)}</p><p className="text-sm">Δ {report.current && report.previous ? format(report.current[metric] - report.previous[metric], metric) : "—"}{metric === "ctr" ? " (điểm %)" : metric === "position" ? " (âm = tốt hơn)" : ""}</p></article>)}</div>
        {!report.current && <p>Google không trả dòng tổng cho kỳ/bộ lọc này; không thay bằng số liệu kỳ trước.</p>}
        <Timeline report={report} />
        <div className="flex flex-wrap gap-3"><label>Chiều dữ liệu <select className={control} value={view.dimension} onChange={event => setView({ ...view, dimension: event.target.value as SearchReportView["dimension"], offset: 0 })}>{[["query", "Top Queries"], ["page", "Top Pages"], ["country", "Country"], ["device", "Device"], ["date", "Date"]].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Xếp hạng <select className={control} value={view.order} onChange={event => setView({ ...view, order: event.target.value as SearchReportView["order"], offset: 0 })}><option value="top">Top</option><option value="growing">Tăng / cải thiện</option><option value="declining">Giảm / suy giảm</option></select></label><label>Chỉ số <select className={control} value={view.metric} onChange={event => setView({ ...view, metric: event.target.value as keyof SearchMetrics, offset: 0 })}>{metrics.map(metric => <option key={metric}>{metric}</option>)}</select></label></div>
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><caption className="py-2 text-left text-slate-400">{report.rows.total} dòng API trả về · Hiện tại / kỳ trước / thay đổi</caption><thead><tr><th scope="col">{view.dimension}</th>{metrics.map(metric => <th className="p-2" scope="col" key={metric}>{metric}</th>)}</tr></thead><tbody>{report.rows.items.map(row => <tr key={row.key} className="border-t border-slate-800"><th scope="row" className="max-w-80 break-words py-3 font-normal">{row.key}</th>{metrics.map(metric => <td className="whitespace-nowrap p-2" key={metric}>{format(row.current?.[metric], metric)} / {format(row.previous?.[metric], metric)}<br /><span className="text-slate-400">Δ {format(row.delta[metric], metric)}</span></td>)}</tr>)}</tbody></table>{!report.rows.total && <p>Không có dòng dữ liệu cho bộ lọc này.</p>}</div>
        <div className="flex gap-3"><button type="button" className={control} disabled={!view.offset} onClick={() => setView({ ...view, offset: Math.max(0, (view.offset ?? 0) - 50) })}>Trang trước</button><button type="button" className={control} disabled={report.rows.nextOffset === null} onClick={() => setView({ ...view, offset: report.rows.nextOffset ?? 0 })}>Trang sau</button></div>
      </>}
      {report.limited && <p role="alert" className="text-amber-300">Đã chạm giới hạn 100.000 dòng/chiều/kỳ của FFP. Bảng không đầy đủ; hãy thu hẹp kỳ hoặc bộ lọc.</p>}
    </>}
    <p className="text-sm text-amber-300">Web Search · finalized · America/Los_Angeles. Google chỉ trả các dòng hàng đầu, có thể ẩn truy vấn vì riêng tư; phân trang không khôi phục dữ liệu Google không cung cấp. Tăng/giảm chỉ phản ánh các dòng trả về, không chứng minh truy vấn vắng mặt không có traffic. Tổng KPI lấy riêng, không cộng bảng keyword/page. Cache tối đa 24 giờ.</p>
  </section>;
}
function Timeline({ report }: { readonly report: SearchReport }): React.JSX.Element {
  const points = report.timeline;
  return <div className="grid gap-4 md:grid-cols-2">{(["clicks", "impressions"] as const).map(metric => {
    const max = Math.max(1, ...points.flatMap(row => [row.current?.[metric] ?? 0, row.previous?.[metric] ?? 0]));
    const days = Math.max(1, (Date.parse(report.filters.endDate) - Date.parse(report.filters.startDate)) / 86400000);
    return <figure key={metric} className="rounded-lg bg-slate-900 p-3"><figcaption>{metric} theo ngày · xanh: hiện tại · tím: kỳ trước</figcaption><svg viewBox="0 0 600 180" role="img" aria-label={`${metric} theo ngày; bảng Date cung cấp số liệu`}><text x="0" y="15" fill="#94a3b8" fontSize="12">{max}</text>{points.map((row, index) => {
      const x = 30 + (Date.parse(row.key) - Date.parse(report.filters.startDate)) / 86400000 / days * 550;
      const previous = points[index - 1];
      return <g key={row.key}>{(["current", "previous"] as const).map(period => {
        const value = row[period]; const previousValue = previous?.[period];
        const color = period === "current" ? "#22d3ee" : "#c084fc";
        if (!value) return null;
        return <g key={period}>{previousValue && Date.parse(row.key) - Date.parse(previous.key) === 86400000 && <line x1={30 + (Date.parse(previous.key) - Date.parse(report.filters.startDate)) / 86400000 / days * 550} y1={160 - previousValue[metric] / max * 130} x2={x} y2={160 - value[metric] / max * 130} stroke={color} />}<circle cx={x} cy={160 - value[metric] / max * 130} r="3" fill={color}><title>{row.key}: {period} {value[metric]}</title></circle></g>;
      })}</g>;
    })}<text x="20" y="178" fill="#94a3b8" fontSize="11">{report.filters.startDate}</text><text x="500" y="178" fill="#94a3b8" fontSize="11">{report.filters.endDate}</text></svg></figure>;
  })}</div>;
}
