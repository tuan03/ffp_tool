import { useEffect, useState } from "react";

import type { SearchMetrics, SearchReport, SearchReportFilters, SearchReportView, SeoPerformanceClient } from "../types";
import { displayDate, formatMetric as format, JOB_LABELS, METRIC_LABELS, metricChange, presetPeriod } from "./presentation";

const control = "min-w-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-blue-300 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:ring-1 focus:ring-blue-300 disabled:opacity-40";
const metrics = ["clicks", "impressions", "ctr", "position"] as const;
const dimensions = [["query", "Từ khóa"], ["page", "Trang"], ["country", "Quốc gia"], ["device", "Thiết bị"], ["date", "Theo ngày"]] as const;
const tones = { positive: "text-emerald-700", negative: "text-rose-700", neutral: "text-slate-600" };

export function SearchDashboard({ client, storeId, startDate, endDate }: {
  readonly client: SeoPerformanceClient; readonly storeId: string;
  readonly startDate: string; readonly endDate: string;
}): React.JSX.Element {
  const [draft, setDraft] = useState<SearchReportFilters>({ startDate, endDate });
  const [referenceEnd] = useState(endDate);
  const [filters, setFilters] = useState<SearchReportFilters>({ startDate, endDate });
  const [view, setView] = useState<SearchReportView>({ dimension: "query", order: "top", metric: "clicks", offset: 0 });
  const [report, setReport] = useState<SearchReport | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [hasComparison, setHasComparison] = useState(false);
  const [hasAdvancedFilters, setHasAdvancedFilters] = useState(false);
  const appliedCount = [filters.country, filters.device, filters.query, filters.page].filter(Boolean).length;

  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    setReport(null); setError("");
    async function load(): Promise<void> {
      try {
        const value = await client.report(storeId, filters, view);
        if (!live) return;
        setReport(value);
        if (value.status === "pending" || value.status === "running") timer = setTimeout(() => void load(), 4000);
      } catch (failure) {
        if (live) { setReport(null); setError(failure instanceof Error ? failure.message : "Không thể tải báo cáo."); }
      }
    }
    void load();
    return () => { live = false; if (timer) clearTimeout(timer); };
  }, [client, storeId, filters, view, refresh]);

  function applyFilters(next: SearchReportFilters): void {
    const days = (Date.parse(next.endDate) - Date.parse(next.startDate)) / 86400000 + 1;
    if (!(days >= 1 && days <= 90)) { setError("Chọn khoảng 1–90 ngày, ngày bắt đầu không sau ngày kết thúc."); return; }
    setFilters({ ...next }); setView(previous => ({ ...previous, offset: 0 }));
  }
  function choosePreset(days: number): void {
    const next = { ...filters, ...presetPeriod(referenceEnd, days) };
    setDraft(next); applyFilters(next);
  }

  return <section className="min-w-0 space-y-6" aria-label="Dashboard Search Console">
    <form className="space-y-4 rounded-lg border border-slate-200 bg-slate-50 p-4" onSubmit={event => { event.preventDefault(); applyFilters(draft); }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[28, 90].map(days => <button key={days} type="button" className={`${control} ${filters.startDate === presetPeriod(referenceEnd, days).startDate && filters.endDate === referenceEnd ? "border-blue-300 bg-blue-50 text-blue-700" : "text-slate-700"}`} onClick={() => choosePreset(days)}>{days} ngày</button>)}
          <span className="self-center text-xs text-slate-500">hoặc chọn ngày bên dưới</span>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="accent-blue-300" checked={hasComparison} onChange={event => setHasComparison(event.target.checked)} />
          So sánh với kỳ trước
        </label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-slate-600">Từ ngày<input aria-label="Từ ngày báo cáo" required type="date" className={`${control} text-slate-900`} value={draft.startDate} max={draft.endDate} onChange={event => setDraft({ ...draft, startDate: event.target.value })} /></label>
        <label className="grid gap-1 text-xs text-slate-600">Đến ngày<input aria-label="Đến ngày báo cáo" required type="date" className={`${control} text-slate-900`} value={draft.endDate} min={draft.startDate} onChange={event => setDraft({ ...draft, endDate: event.target.value })} /></label>
        <button type="submit" className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700">Áp dụng</button>
        <button type="button" className={control} aria-expanded={hasAdvancedFilters} aria-controls="search-advanced-filters" onClick={() => setHasAdvancedFilters(value => !value)}>Bộ lọc nâng cao{appliedCount ? ` (${appliedCount})` : ""}</button>
        <button type="button" className={`${control} ml-auto text-blue-700`} onClick={() => setRefresh(value => value + 1)}>↻ Làm mới trạng thái</button>
      </div>
      <div id="search-advanced-filters" hidden={!hasAdvancedFilters}>
        <div className="grid gap-3 border-t border-slate-200 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <label className="grid gap-1 text-xs text-slate-600">Quốc gia (mã 3 chữ)<input aria-label="Quốc gia" className={control} placeholder="usa, vnm…" pattern="[a-zA-Z]{3}" maxLength={3} value={draft.country ?? ""} onChange={event => setDraft({ ...draft, country: event.target.value || undefined })} /></label>
          <label className="grid gap-1 text-xs text-slate-600">Thiết bị<select aria-label="Thiết bị lọc" className={control} value={draft.device ?? ""} onChange={event => setDraft({ ...draft, device: event.target.value as SearchReportFilters["device"] || undefined })}><option value="">Tất cả thiết bị</option><option value="DESKTOP">Máy tính</option><option value="MOBILE">Điện thoại</option><option value="TABLET">Máy tính bảng</option></select></label>
          <label className="grid gap-1 text-xs text-slate-600">Từ khóa chứa<input aria-label="Từ khóa chứa" className={control} placeholder="Ví dụ: blanket" maxLength={1000} value={draft.query ?? ""} onChange={event => setDraft({ ...draft, query: event.target.value })} /></label>
          <label className="grid gap-1 text-xs text-slate-600">Đường dẫn chứa<input aria-label="Đường dẫn chứa" className={control} placeholder="Ví dụ: /products/" maxLength={1000} value={draft.page ?? ""} onChange={event => setDraft({ ...draft, page: event.target.value })} /></label>
        </div>
        <p className="mt-2 text-xs text-slate-500">Sau khi chọn bộ lọc, bấm Áp dụng để cập nhật toàn bộ báo cáo.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Đang xem: {displayDate(filters.startDate)} – {displayDate(filters.endDate)}</span>
        {appliedCount > 0 && <><span className="break-all rounded-md bg-blue-50 px-2 py-1 text-blue-700">{[filters.country?.toUpperCase(), filters.device, filters.query && `Từ khóa: ${filters.query}`, filters.page && `URL: ${filters.page}`].filter(Boolean).join(" · ")}</span><button type="button" className="text-blue-700 underline" onClick={() => { const next = { startDate: filters.startDate, endDate: filters.endDate }; setDraft(next); applyFilters(next); }}>Xóa bộ lọc nâng cao</button></>}
      </div>
    </form>

    {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</p>}
    {!error && !report && <div role="status" className="rounded-lg border border-slate-200 p-8 text-center text-slate-600">Đang tải báo cáo Google…</div>}
    {report && <>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
        <span className="break-all">{report.property} · Google Web Search</span>
        <span>Dữ liệu lấy lúc: {report.fetchedAt ? new Date(report.fetchedAt).toLocaleString("vi-VN") : "chưa hoàn tất"}</span>
      </div>
      {report.status !== "done" && <div role="status" className="space-y-2 rounded-lg border border-slate-200 p-5"><p>{JOB_LABELS[report.status]} · {report.progress}%</p><progress aria-label="Tiến độ báo cáo" className="w-full accent-blue-300" value={report.progress} max={100} /><p className="text-sm text-slate-600">{report.error ? `Có lỗi khi lấy dữ liệu: ${report.error}. Bấm Làm mới trạng thái để kiểm tra lại.` : "Bạn có thể chuyển tab. Báo cáo sẽ hiện khi xử lý hoàn tất."}</p></div>}
      {report.stale && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-700">Dữ liệu chưa được xác minh mới. {report.error}</p>}
      {report.status === "done" && <>
        {hasComparison && <p className="text-sm text-slate-600">So với {displayDate(report.previousStart)} – {displayDate(report.previousEnd)} · Hai kỳ có cùng số ngày.</p>}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{metrics.map(metric => {
          const change = metricChange(metric, report.current?.[metric], report.previous?.[metric]);
          return <article key={metric} className="rounded-lg border border-slate-200 bg-slate-50 p-5">
            <h3 className="text-sm text-slate-600">{METRIC_LABELS[metric]}</h3>
            <p className="my-2 text-3xl font-semibold tabular-nums text-slate-900">{format(report.current?.[metric], metric)}</p>
            {hasComparison ? <><p className={`text-sm ${tones[change.tone]}`}>{change.text}</p><p className="mt-1 text-xs text-slate-500">Kỳ trước: {format(report.previous?.[metric], metric)}</p></> : <p className="text-xs text-slate-500">{metric === "position" ? "Số nhỏ hơn là tốt hơn" : metric === "ctr" ? "Lượt nhấp / lượt hiển thị" : "Trong khoảng ngày đã chọn"}</p>}
          </article>;
        })}</div>
        {!report.current && <p className="text-sm text-slate-600">Google không trả dữ liệu tổng cho kỳ/bộ lọc này. Dấu — không được hiểu là 0 lượt tìm kiếm.</p>}
        <Timeline report={report} hasComparison={hasComparison} />
        <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200" aria-label="Chi tiết hiệu suất">
          <div className="flex flex-wrap gap-1 border-b border-slate-200 bg-slate-50 p-3">{dimensions.map(([dimension, label]) => <button type="button" aria-pressed={view.dimension === dimension} key={dimension} className={`rounded-lg px-4 py-2 text-sm ${view.dimension === dimension ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:text-slate-900"}`} onClick={() => setView({ ...view, dimension, offset: 0 })}>{label}</button>)}</div>
          <div className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-slate-600">{report.rows.total.toLocaleString("vi-VN")} kết quả · {view.dimension === "date" ? "Sắp xếp theo ngày" : "Xếp hạng theo chỉ số"}</p>
            {view.dimension !== "date" && <div className="flex flex-wrap gap-2">
              <select aria-label="Xếp hạng" className={control} value={view.order} onChange={event => { const order = event.target.value as SearchReportView["order"]; setView({ ...view, order, offset: 0 }); if (order !== "top") setHasComparison(true); }}><option value="top">Nổi bật nhất</option><option value="growing">Tăng / cải thiện</option><option value="declining">Giảm / suy giảm</option></select>
              <select aria-label="Chỉ số xếp hạng" className={control} value={view.metric} onChange={event => setView({ ...view, metric: event.target.value as keyof SearchMetrics, offset: 0 })}>{metrics.map(metric => <option key={metric} value={metric}>{METRIC_LABELS[metric]}</option>)}</select>
            </div>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Chi tiết hiệu suất Google{hasComparison ? " và so sánh kỳ trước" : ""}</caption>
              <thead className="bg-slate-50 text-xs text-slate-600"><tr><th scope="col" className="min-w-52 p-4">{dimensions.find(([dimension]) => dimension === view.dimension)?.[1]}</th>{metrics.map(metric => <th scope="col" className="whitespace-nowrap p-4 text-right font-medium" key={metric}>{METRIC_LABELS[metric]}</th>)}</tr></thead>
              <tbody>{report.rows.items.map(row => <tr key={row.key} className="border-t border-slate-200 hover:bg-slate-50">
                <th scope="row" className="max-w-80 break-words p-4 font-normal text-slate-900">{view.dimension === "date" ? displayDate(row.key) : row.key}</th>
                {metrics.map(metric => {
                  const change = metricChange(metric, row.current?.[metric], row.previous?.[metric]);
                  return <td key={metric} className="whitespace-nowrap p-4 text-right tabular-nums"><span>{format(row.current?.[metric], metric)}</span>{hasComparison && <><div className="mt-1 text-xs text-slate-500">Trước: {format(row.previous?.[metric], metric)}</div><div className={`mt-1 text-xs ${tones[change.tone]}`}>{change.text}</div></>}</td>;
                })}
              </tr>)}</tbody>
            </table>
            {!report.rows.total && <p className="p-8 text-center text-slate-600">Không có kết quả phù hợp. Thử đổi khoảng ngày hoặc xóa bộ lọc.</p>}
          </div>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 p-4">
            <p className="text-xs text-slate-600">{report.rows.total ? `${(view.offset ?? 0) + 1}–${(view.offset ?? 0) + report.rows.items.length} / ${report.rows.total}` : "0 kết quả"}</p>
            <div className="flex gap-2"><button type="button" className={control} disabled={!view.offset} onClick={() => setView({ ...view, offset: Math.max(0, (view.offset ?? 0) - 50) })}>← Trước</button><button type="button" className={control} disabled={report.rows.nextOffset === null} onClick={() => setView({ ...view, offset: report.rows.nextOffset ?? 0 })}>Sau →</button></div>
          </div>
        </section>
      </>}
      {report.limited && <p role="alert" className="text-sm text-amber-700">Đã chạm giới hạn 100.000 dòng/chiều/kỳ. Bảng không đầy đủ; hãy thu hẹp kỳ hoặc bộ lọc.</p>}
    </>}
    <details className="text-xs leading-relaxed text-slate-500"><summary className="cursor-pointer py-2">Cách đọc số liệu và giới hạn dữ liệu Google</summary><p>Web Search · dữ liệu đã chốt · múi giờ America/Los_Angeles. Kỳ tối đa 90 ngày, ngày kết thúc tối đa hôm nay trừ 3 ngày theo giờ Google. Báo cáo được lưu tối đa 24 giờ trước khi lấy lại.</p><p className="mt-2">Google có thể ẩn truy vấn hoặc chỉ trả các dòng hàng đầu. Truy vấn vắng mặt không có nghĩa là không có traffic. Tổng KPI lấy riêng, không cộng bảng từ khóa/trang. Vị trí giảm là cải thiện; thay đổi CTR tính bằng điểm phần trăm. So sánh thể hiện biến động, không chứng minh nguyên nhân.</p></details>
  </section>;
}
function Timeline({ report, hasComparison }: { readonly report: SearchReport; readonly hasComparison: boolean }): React.JSX.Element {
  const points = report.timeline;
  return <div className="grid gap-4 md:grid-cols-2">{(["clicks", "impressions"] as const).map(metric => {
    const max = Math.max(1, ...points.flatMap(row => [row.current?.[metric] ?? 0, hasComparison ? row.previous?.[metric] ?? 0 : 0]));
    const days = Math.max(1, (Date.parse(report.filters.endDate) - Date.parse(report.filters.startDate)) / 86400000);
    return <figure key={metric} className="rounded-lg border border-slate-200 bg-white p-3"><figcaption>{METRIC_LABELS[metric]} theo ngày · xanh: hiện tại{hasComparison ? " · xám: kỳ trước" : ""}</figcaption><svg viewBox="0 0 600 180" role="img" aria-label={`${metric} theo ngày; bảng Date cung cấp số liệu`}><text x="0" y="15" fill="#475569" fontSize="12">{max}</text>{points.map((row, index) => {
      const x = 30 + (Date.parse(row.key) - Date.parse(report.filters.startDate)) / 86400000 / days * 550;
      const previous = points[index - 1];
      return <g key={row.key}>{(["current", ...(hasComparison ? ["previous"] as const : [])] as const).map(period => {
        const value = row[period]; const previousValue = previous?.[period];
        const color = period === "current" ? "#2563eb" : "#64748b";
        if (!value) return null;
        return <g key={period}>{previousValue && Date.parse(row.key) - Date.parse(previous.key) === 86400000 && <line x1={30 + (Date.parse(previous.key) - Date.parse(report.filters.startDate)) / 86400000 / days * 550} y1={160 - previousValue[metric] / max * 130} x2={x} y2={160 - value[metric] / max * 130} stroke={color} />}<circle cx={x} cy={160 - value[metric] / max * 130} r="3" fill={color}><title>{row.key}: {period} {value[metric]}</title></circle></g>;
      })}</g>;
    })}<text x="20" y="178" fill="#475569" fontSize="11">{report.filters.startDate}</text><text x="500" y="178" fill="#475569" fontSize="11">{report.filters.endDate}</text></svg></figure>;
  })}</div>;
}
