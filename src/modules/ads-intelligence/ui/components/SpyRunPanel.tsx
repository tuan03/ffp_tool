import { useEffect, useState } from "react";

import type { AdsIntelligenceClient, SpyCapabilities, SpyJob } from "../../types";

import { SpyRunLog } from "./SpyRunLog";

const PHASES = [{ id: "profile", label: "Xác minh store" }, { id: "discovery", label: "Tìm đối thủ" }, { id: "ads", label: "Thu thập quảng cáo" }, { id: "media", label: "Kiểm tra media" }, { id: "analysis", label: "Phân tích" }, { id: "publish", label: "Lưu kết quả" }];
const ERRORS: Readonly<Record<string, string>> = {
  SPY_LOG_WRITE_FAILED: "Không ghi được nhật ký trên backend; chưa công bố kết quả mới.",
  SPY_PERMISSION_REQUIRED: "CLI đã từ chối quyền chạy công cụ trong chế độ nền. Cần cấu hình quyền cho lệnh MCP trên máy backend rồi chạy lại; kết quả cũ vẫn được giữ nguyên.",
  SPY_RUNNER_RESPONSE_INVALID: "Không đọc được phản hồi có cấu trúc từ CLI; chưa công bố kết quả.",
  SPY_RESEARCH_MISSING: "CLI đã kết thúc nhưng chưa gửi dữ liệu nghiên cứu qua công cụ lưu kết quả. Thư viện cũ được giữ nguyên.",
  SPY_LOGIN_REQUIRED: "CLI cần đăng nhập lại trên máy chạy backend.", SPY_TIMEOUT: "Đã dừng vì vượt 90 phút. Kết quả cũ được giữ nguyên.",
  SPY_RUNNER_FAILED: "CLI không hoàn thành. Kiểm tra đăng nhập, model và kết nối của công cụ.",
  SPY_EXECUTION_FAILED: "Agent chưa trả kết quả nghiên cứu hợp lệ; không thay kết quả cũ.",
  SPY_COVERAGE_INCOMPLETE: "Kết quả chưa có trạng thái thu thập cho từng đối thủ; chưa được đưa lên thư viện.",
  SPY_MEDIA_UNVERIFIED: "Một số mẫu chưa được kiểm tra ảnh/video; chưa thay thư viện hiện tại.",
  SPY_RESEARCH_INVALID: "Kết quả không khớp store hoặc lượt chạy hiện tại; chưa được công bố.",
  SPY_SERVER_RESTARTED: "Backend đã khởi động lại. Lượt cũ bị gián đoạn; bạn có thể chạy lại.",
};

export function SpyRunPanel({ client, storeId }: { readonly client: AdsIntelligenceClient; readonly storeId: string }): React.JSX.Element {
  const [capabilities, setCapabilities] = useState<SpyCapabilities | null>(null);
  const [runner, setRunner] = useState<"codex" | "agy">("codex");
  const [model, setModel] = useState("");
  const [job, setJob] = useState<SpyJob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let disposed = false;
    setIsLoaded(false);
    void (async () => {
      try {
        if (!client.getSpyCapabilities || !client.getSpyJob) throw new Error("Chế độ này chưa hỗ trợ chạy Spy.");
        const [available, snapshot] = await Promise.all([client.getSpyCapabilities(), client.getSpyJob(storeId)]);
        if (disposed) return;
        setCapabilities(available); setJob(snapshot.job); setError("");
        const selected = available.runners.find(r => snapshot.job?.status === "running" ? r.id === snapshot.job.runner : r.available && r.models.length);
        if (selected) { setRunner(selected.id); setModel(snapshot.job?.status === "running" ? snapshot.job.model : selected.defaultModel); }
        setIsLoaded(true);
      } catch (failure) { if (!disposed) setError(failure instanceof Error ? failure.message : "Không tải được công cụ Spy."); }
    })();
    return () => { disposed = true; };
  }, [client, storeId, reload]);
  useEffect(() => {
    if (!isLoaded || !client.getSpyJob) return;
    let disposed = false;
    let fetching = false;
    const timer = window.setInterval(() => {
      if (fetching) return;
      fetching = true;
      void client.getSpyJob?.(storeId).then(snapshot => { if (!disposed) { setJob(current => {
          if (!snapshot.job) return current;
          if (current?.id === snapshot.job.id && current.status !== "running" && snapshot.job.status === "running") return current;
          return !current || snapshot.job.startedAt >= current.startedAt ? snapshot.job : current;
        }); setError(current => current.startsWith("Mất kết nối tiến độ") ? "" : current); } }, () => { if (!disposed) setError("Mất kết nối tiến độ; lượt Spy có thể vẫn chạy. Đang thử kết nối lại."); }).finally(() => { fetching = false; });
    }, 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [client, storeId, isLoaded]);
  const selectedRunner = capabilities?.runners.find(r => r.id === runner);
  const isRunning = job?.status === "running";
  const handleStart = async () => {
    if (!client.startSpyJob || isBusy || isRunning) return;
    setIsBusy(true); setError("");
    try { setJob((await client.startSpyJob({ storeId, runner, model })).job); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Không bắt đầu được Spy."); }
    finally { setIsBusy(false); }
  };
  const handleCancel = async () => {
    if (!client.cancelSpyJob || !job) return;
    setIsBusy(true);
    try { setJob((await client.cancelSpyJob(storeId, job.id)).job); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Không gửi được yêu cầu dừng."); }
    finally { setIsBusy(false); }
  };
  return <section aria-label="Chạy nghiên cứu đối thủ" className="space-y-4 rounded-2xl border border-indigo-900/60 bg-slate-950/70 p-4 sm:p-5">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-semibold text-slate-100">Nghiên cứu đối thủ</h3><p className="text-xs text-slate-400">Store: <strong className="text-cyan-300">{storeId}</strong> · Tìm tối đa 10 đối thủ đúng sản phẩm, kiểm tra quảng cáo và lưu lên thư viện.</p></div><span className="rounded border border-purple-800 px-2 py-1 text-xs text-purple-300">Skill spy-competitors · MCP ffp-ads</span></div>
    <div className="flex flex-wrap items-end gap-3">
      <label className="space-y-1 text-xs text-slate-400"><span className="block">Công cụ chạy Spy</span><select aria-label="Công cụ chạy Spy" value={runner} disabled={isRunning || isBusy || !isLoaded} onChange={event => { const next = capabilities?.runners.find(r => r.id === event.target.value); if (next) { setRunner(next.id); setModel(next.defaultModel); } }} className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-slate-100">{capabilities?.runners.map(r => <option key={r.id} value={r.id} disabled={!r.available}>{r.name}{r.available ? "" : " — chưa cài"}</option>)}</select></label>
      <label className="space-y-1 text-xs text-slate-400"><span className="block">Model chạy Spy</span><select aria-label="Model chạy Spy" value={model} disabled={isRunning || isBusy || !isLoaded} onChange={event => setModel(event.target.value)} className="rounded-lg border border-slate-700 bg-slate-900 p-2 text-sm text-cyan-300">{!selectedRunner?.models.length && <option value="">Chưa đọc được danh sách model</option>}{selectedRunner?.models.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
      <button type="button" onClick={() => { void handleStart(); }} disabled={!isLoaded || isBusy || isRunning || !selectedRunner?.available || !model || capabilities?.skillAvailable === false} className="rounded-lg bg-cyan-500 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-40">{isRunning ? "Đang nghiên cứu…" : "Spy đối thủ"}</button>
      {isRunning && <button type="button" disabled={isBusy} onClick={() => { void handleCancel(); }} className="rounded-lg border border-rose-800 px-4 py-2 text-sm text-rose-300">Dừng</button>}
      {!isRunning && <button type="button" disabled={isBusy} onClick={() => setReload(value => value + 1)} className="px-2 py-2 text-xs text-slate-400 underline">Tải lại công cụ</button>}
    </div>
    {capabilities?.skillAvailable === false && <p role="alert" className="text-sm text-amber-300">Chưa cài skill spy-competitors trên máy chạy backend.</p>}
    {error && <p role="alert" className="text-sm text-amber-300">{error}</p>}
    {job && <div aria-live="polite" className="space-y-2 text-xs text-slate-400">
      <p>{job.storeId} · {job.runner} / {job.model} · Bắt đầu {new Date(job.startedAt).toLocaleString("vi-VN")}</p>
      {isRunning && <><ol className="flex flex-wrap gap-2">{PHASES.map(phase => <li key={phase.id} aria-current={job.phase === phase.id ? "step" : undefined} className={`rounded px-2 py-1 ${job.phase === phase.id ? "bg-cyan-950 text-cyan-200" : "bg-slate-900"}`}>{phase.label}</li>)}</ol><p>Bước do agent báo cáo. Bạn có thể chuyển tab hoặc tải lại trang; backend tiếp tục chạy. Kết quả cũ được giữ trong lúc nghiên cứu.</p></>}
      {(job.status === "completed" || job.status === "partial") && <p className="text-cyan-200">{job.status === "completed" ? "Hoàn tất" : "Đã kết thúc lượt chạy, còn thiếu bằng chứng ở một số đối thủ"}: {job.adCount ?? 0} quảng cáo / {job.brandsWithAds ?? 0} thương hiệu; {job.selectedCount ?? 0} đối thủ được chọn. {job.published ? "Kết quả tự cập nhật bên dưới trong tối đa 15 giây." : "Chưa thay kết quả cũ; lượt mới chưa có quảng cáo xác minh."}</p>}
      {job.status === "cancelled" && <p>Đã dừng. Không công bố kết quả của lượt này.</p>}
      {(job.status === "failed" || job.status === "interrupted") && <p className="text-amber-300">{ERRORS[job.errorCode ?? ""] ?? "Lượt Spy chưa hoàn tất. Kết quả cũ vẫn được giữ nguyên."}</p>}
    </div>}
    {job && <SpyRunLog key={job.id} job={job} />}
    {!job && <p className="text-xs text-slate-500">Sử dụng phiên đăng nhập CLI và quota nguồn quảng cáo hiện có. Chỉ bắt đầu khi bạn bấm Spy.</p>}
  </section>;
}
