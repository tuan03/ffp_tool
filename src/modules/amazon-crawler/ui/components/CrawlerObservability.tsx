import { useEffect, useRef, useState } from "react";

import type { AmazonCrawlerJobController, AmazonCrawlerMetrics, AmazonCrawlerTracePage } from "../../types";

function percentage(value: number | null): string {
  return value === null ? "Chưa có số liệu" : `${(value * 100).toFixed(1)}%`;
}

export function CrawlerMetricsView({ metrics }: { metrics: AmazonCrawlerMetrics }): React.JSX.Element {
  const counters = metrics.counts;
  const cards = [
    ["Cache hit", percentage(metrics.rates.cacheHit), `${counters.familyCacheHits}/${counters.familyCacheHits + counters.familyCacheMisses} lượt family`],
    ["HTTP thành công", percentage(metrics.rates.httpSuccess), `${counters.httpSuccesses}/${counters.httpAttempts} attempt`],
    ["Playwright fallback", percentage(metrics.rates.playwrightFallback), `${counters.playwrightFallbacks}/${counters.pageFetches} lượt lấy trang sản phẩm`],
    ["CAPTCHA", percentage(metrics.rates.captcha), `${counters.captchaAttempts}/${counters.httpAttempts + counters.browserAttempts} attempt HTTP/browser`],
    ["Thời gian crawl TB", metrics.averageCrawlDurationMs === null ? "Chưa có số liệu" : `${(metrics.averageCrawlDurationMs / 1000).toFixed(2)} s`, `${counters.familyAttempts} lượt family, gồm cache và lỗi`],
    ["Retry", String(counters.retryCount), `${counters.networkRetries} HTTP/browser · ${counters.taskRetries} task`],
    ["Partial family", String(counters.partialFamilies), "Theo kết quả mới nhất của mỗi task"],
    ["Parser lỗi", String(counters.parserFailures), "Các lỗi parser mới phát sinh"],
    ["Hàng đợi crawl", String(metrics.queue.crawl), `${metrics.queue.crawlActive} đang chạy · ${metrics.queue.pipeline} chờ xử lý sản phẩm`],
    ...(metrics.scheduler ? [["Scheduler capacity", `${metrics.scheduler.activeTasks}/${metrics.scheduler.totalCapacity}`, `${metrics.scheduler.activeAgents} agent · ${metrics.scheduler.availableCapacity} slot khả dụng · ${metrics.scheduler.overCapacityAgents} vượt giới hạn`],
      ["Độ trễ hàng đợi", `${metrics.scheduler.oldestQueuedAgeSeconds} s`, `${metrics.scheduler.queuedTasks} task đang chờ · chênh lệch hoàn thành 24h: ${metrics.scheduler.completedTasks24hSpread}`]] : []),
  ];
  return <div className="space-y-3">
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {cards.map(([label, value, detail]) => <div className="rounded-lg border border-slate-700 bg-slate-900/70 p-3" key={label}>
        <p className="text-xs text-slate-400">{label}</p><p className="mt-1 text-lg font-semibold text-slate-100">{value}</p>
        <p className="mt-1 text-xs text-slate-400">{detail}</p>
      </div>)}
    </div>
    {metrics.agents.length === 0 ? <p className="text-xs text-slate-400">Chưa có agent online gửi số liệu tài nguyên.</p> :
      <div className="grid gap-2 md:grid-cols-2">{metrics.agents.map((agent) => <div className="rounded-lg border border-slate-700 p-3 text-xs text-slate-300" key={agent.agentId}>
        <strong>{agent.displayName}</strong>
        {agent.agentGroup ? <span className="ml-2 text-slate-400">· {agent.agentGroup}</span> : null}
        {agent.maxConcurrentInputs !== undefined ? <p className="mt-1">Task {agent.activeTasks ?? 0}/{agent.maxConcurrentInputs} · hoàn tất 24h: {agent.completedTasks24h ?? 0}
          {agent.averageTaskDurationMs24h === null || agent.averageTaskDurationMs24h === undefined ? "" : ` · TB ${(agent.averageTaskDurationMs24h / 1000).toFixed(1)} s`}
          {agent.overCapacity ? " · VƯỢT CAPACITY" : ""}</p> : null}
        <p className="mt-1">{agent.resources.rssBytes === undefined ? "Chưa đo RAM" : `RAM agent và tiến trình con: ${(agent.resources.rssBytes / 1024 / 1024).toFixed(1)} MiB${agent.resources.isComplete ? "" : " (đo chưa đủ)"}`}</p>
        <p className="mt-1">{agent.resources.browserContexts === undefined ? "Chưa đo browser" : `${agent.resources.browserContexts} browser context · ${agent.resources.browserPages ?? 0} trang đang mở`}{agent.resources.browserProcesses === undefined ? "" : ` · ${agent.resources.browserProcesses} tiến trình Chromium`}</p>
        <p className="mt-1">{agent.backlog} sự kiện chờ gửi{agent.dropped ? ` · ${agent.dropped} sự kiện telemetry bị bỏ` : ""}</p>
      </div>)}</div>}
  </div>;
}

export function CrawlerObservability({ controller, jobId, requestId, isActive = true }: {
  controller?: AmazonCrawlerJobController;
  jobId?: string;
  requestId?: string;
  isActive?: boolean;
}): React.JSX.Element | null {
  const [metrics, setMetrics] = useState<AmazonCrawlerMetrics | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const [tracePage, setTracePage] = useState<AmazonCrawlerTracePage | null>(null);
  const [traceError, setTraceError] = useState<string | null>(null);
  const [isLoadingTrace, setIsLoadingTrace] = useState(false);
  const [tracePageNumber, setTracePageNumber] = useState(1);
  const traceVersion = useRef(0);

  useEffect(() => {
    if (!isActive || !controller?.metrics) return;
    let isMounted = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    async function refresh(): Promise<void> {
      try {
        const next = await controller?.metrics?.();
        if (isMounted && next) { setMetrics(next); setMetricsError(null); }
      } catch {
        if (isMounted) setMetricsError("Không tải được số liệu crawler. Đang chờ lần cập nhật tiếp theo.");
      } finally {
        if (isMounted) timeout = setTimeout(() => void refresh(), 10_000);
      }
    }
    void refresh();
    return () => { isMounted = false; if (timeout !== undefined) clearTimeout(timeout); };
  }, [controller, isActive]);

  useEffect(() => {
    traceVersion.current += 1;
    setTracePage(null); setTraceError(null); setIsLoadingTrace(false); setTracePageNumber(1);
    return () => { traceVersion.current += 1; };
  }, [jobId, requestId]);

  async function loadTrace(cursor?: string): Promise<void> {
    if (!controller?.trace || !jobId || !requestId) return;
    const version = traceVersion.current;
    setIsLoadingTrace(true); setTraceError(null);
    try {
      const next = await controller.trace(jobId, requestId, cursor);
      if (version !== traceVersion.current) return;
      setTracePage(next); setTracePageNumber((page) => cursor ? page + 1 : 1);
    } catch {
      if (version === traceVersion.current) setTraceError("Không tải được trace. Hãy thử lại từ trang đầu.");
    } finally {
      if (version === traceVersion.current) setIsLoadingTrace(false);
    }
  }

  if (!controller?.metrics) return null;
  return <section className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4">
    <div><h2 className="font-semibold text-slate-100">Quan sát crawler</h2><p className="mt-1 text-xs text-slate-400">24 giờ gần nhất · số liệu đã nhận · cập nhật mỗi 10 giây</p></div>
    {metricsError ? <p className="text-sm text-amber-300" role="status">{metricsError}</p> : null}
    {metrics ? <CrawlerMetricsView metrics={metrics} /> : <p className="text-sm text-slate-400">Đang tải số liệu...</p>}
    {jobId && requestId && controller.trace ? <details className="rounded-lg border border-slate-700 p-3">
      <summary className="cursor-pointer text-sm font-semibold text-cyan-300">Trace family đang chọn</summary>
      <p className="mt-2 break-all font-mono text-xs text-slate-400">requestId: {requestId}</p>
      <div className="mt-2 flex gap-2">
        <button type="button" disabled={isLoadingTrace} onClick={() => void loadTrace()} className="rounded border border-slate-600 px-3 py-1 text-sm disabled:opacity-50">{isLoadingTrace ? "Đang tải..." : "Tải từ đầu"}</button>
        {tracePage?.nextCursor ? <button type="button" disabled={isLoadingTrace} onClick={() => void loadTrace(tracePage.nextCursor ?? undefined)} className="rounded border border-slate-600 px-3 py-1 text-sm disabled:opacity-50">Trang tiếp</button> : null}
      </div>
      {traceError ? <p className="mt-2 text-sm text-rose-300" role="status">{traceError}</p> : null}
      {tracePage ? <div className="mt-3 overflow-x-auto">
        <p className="mb-2 text-xs text-slate-400">Trang {tracePageNumber} · {tracePage.events.length} sự kiện</p>
        {tracePage.events.length === 0 ? <p className="text-sm text-slate-400">Chưa có trace được lưu cho family này.</p> :
          <table className="w-full text-left text-xs"><thead className="text-slate-400"><tr>{["Bước / ASIN", "Agent / route / profile", "Attempt", "Thời gian", "Kết quả"].map((label) => <th key={label} className="p-2">{label}</th>)}</tr></thead>
            <tbody>{tracePage.events.map((event) => <tr key={event.eventId} className="border-t border-slate-800 align-top">
              <td className="p-2">{event.stage || event.event}<p className="font-mono">{event.asin}</p><details className="mt-1 text-slate-400"><summary className="cursor-pointer">ID và cache key</summary><p className="break-all">{event.requestId}</p><p className="break-all">{event.cacheKey || "—"}</p><p>{event.timestamp}</p></details></td>
              <td className="p-2"><p className="max-w-40 truncate" title={event.agentId}>{event.agentId}</p>{event.route || "—"} / {event.profile || "—"}</td>
              <td className="p-2">Task {event.taskAttempt ?? 1} · request {event.attempt ?? 1}</td>
              <td className="p-2">{event.durationMs === undefined ? "—" : `${event.durationMs} ms`}</td>
              <td className="p-2">{event.result}{event.error ? <p className="mt-1 max-w-72 break-words text-rose-300">{event.error}</p> : null}</td>
            </tr>)}</tbody>
          </table>}
      </div> : null}
    </details> : null}
  </section>;
}
