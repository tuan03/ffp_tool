import { useEffect, useState } from "react";

import type { CustomGptClient } from "../service";
import type { AgentAccessPage, AgentRunPage } from "../types";
import { WorkerMetricsPanel } from "./WorkerMetricsPanel";
import { createAgentPrompt } from "./agent-prompt";

const BUTTON = "rounded-lg border border-slate-600 px-3 py-2 text-sm text-cyan-300 hover:bg-slate-800 focus-visible:outline-2 focus-visible:outline-cyan-300 disabled:opacity-40";
const PRIMARY = "rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-40";
const INPUT = "rounded-lg border border-slate-600 bg-slate-950 px-3 py-2 text-white";
const VIEWS = [{ id: "connect", label: "Kết nối máy" }, { id: "runs", label: "Phiên chạy" }, { id: "metrics", label: "Hoạt động" }] as const;
const RUN_LABELS: Readonly<Record<string, string>> = { RUNNING: "Đang chạy", PARTIAL: "Tạm dừng", COMPLETED: "Hoàn thành" };

export function AgentAccessPanel({ client, storeId }: { readonly client: CustomGptClient; readonly storeId: string }): React.JSX.Element {
  const [view, setView] = useState<"connect" | "runs" | "metrics">("connect");
  const [access, setAccess] = useState<AgentAccessPage | null>(null);
  const [runs, setRuns] = useState<AgentRunPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [workerId, setWorkerId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [notice, setNotice] = useState("");
  const [target, setTarget] = useState(1);
  const [isSetupOpen, setIsSetupOpen] = useState(false);
  const startPrompt = createAgentPrompt({ storeId, target });

  async function handleCopy(value: string, message: string): Promise<void> {
    try { await navigator.clipboard.writeText(value); setNotice(message); }
    catch { setError("Không sao chép được. Kiểm tra quyền clipboard rồi thử lại."); }
  }
  async function handleCopyPrompt(runId?: string): Promise<void> {
    const prompt = runId ? createAgentPrompt({ storeId, target, runId }) : startPrompt;
    if (!prompt) return;
    await handleCopy(prompt, "Đã sao chép yêu cầu. Dán vào Codex trên máy đã kết nối.");
  }

  useEffect(() => {
    let cancelled = false;
    setAccess(null); setRuns(null); setError("");
    // Only fetch the active view; a metrics failure must not block connection setup.
    if (view === "connect") {
      void client.agentAccess(storeId, offset).then(next => { if (!cancelled) setAccess(next); })
        .catch(() => { if (!cancelled) setError("Không tải được danh sách máy. Kiểm tra đăng nhập quản trị rồi thử lại."); });
    } else if (view === "runs") {
      void Promise.all([client.agentAccess(storeId, 0), client.agentRuns(storeId, runOffset)])
        .then(([nextAccess, nextRuns]) => { if (!cancelled) { setAccess(nextAccess); setRuns(nextRuns); } })
        .catch(() => { if (!cancelled) setError("Không tải được phiên chạy. Bấm Làm mới để thử lại."); });
    }
    return () => { cancelled = true; };
  }, [client, storeId, view, offset, runOffset, refresh]);

  async function handleCreate(): Promise<void> {
    setIsBusy(true); setError(""); setToken(null); setNotice("");
    try { const issued = await client.createAgentToken(storeId, workerId.trim()); setToken(issued.token); setRefresh(value => value + 1); }
    catch { setError("Không tạo được token. Kiểm tra tên máy và quyền quản trị."); }
    finally { setIsBusy(false); }
  }
  async function handleRevoke(tokenId: string): Promise<void> {
    if (!window.confirm("Thu hồi token sẽ ngắt quyền truy cập và công việc đang giữ của máy này. Tiếp tục?")) return;
    setIsBusy(true); setError(""); setToken(null);
    try { await client.revokeAgentToken(storeId, tokenId); setRefresh(value => value + 1); setNotice("Đã thu hồi token."); }
    catch { setError("Chưa thu hồi được token. Vui lòng thử lại."); }
    finally { setIsBusy(false); }
  }
  async function handleDelete(tokenId: string): Promise<void> {
    if (!window.confirm("Xóa token đã thu hồi khỏi danh sách? Lịch sử job và phiên chạy vẫn được giữ.")) return;
    setIsBusy(true); setError(""); setToken(null);
    try { await client.deleteAgentToken(storeId, tokenId); setRefresh(value => value + 1); setNotice("Đã xóa token khỏi danh sách."); }
    catch { setError("Chỉ xóa được token đã thu hồi. Làm mới rồi thử lại."); }
    finally { setIsBusy(false); }
  }

  return <section className="space-y-5 pt-5" aria-label="Agent Access">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="font-semibold text-white">Máy xử lý SEO</h2><p className="mt-1 text-sm text-slate-400">{storeId} · Một kết nối: xử lý SEO + đánh giá GSC. Không tự duyệt hoặc đồng bộ Shopify.</p></div>
      {view !== "metrics" && <button type="button" className={BUTTON} disabled={isBusy} onClick={() => setRefresh(value => value + 1)}>Làm mới</button>}
    </div>
    <nav aria-label="Quản lý máy SEO" className="flex flex-wrap gap-2 border-b border-slate-800 pb-4">
      {VIEWS.map(entry => <button key={entry.id} type="button" aria-pressed={view === entry.id} className={view === entry.id ? PRIMARY : BUTTON} onClick={() => { setView(entry.id); setNotice(""); setError(""); }}>{entry.label}</button>)}
    </nav>
    {error && <p role="alert" className="rounded-lg bg-rose-950/40 p-3 text-sm text-rose-300">{error}</p>}
    {notice && <p role="status" className="text-sm text-emerald-300">{notice}</p>}
    {view !== "metrics" && !access && !error && <p role="status" className="text-sm text-slate-400">Đang tải…</p>}
    {access && !access.claimsEnabled && view !== "metrics" && <p className="rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-sm text-amber-200">Store chưa bật nhận việc. Nhờ quản trị viên chuyển Queue sang Worker trước khi chạy SEO.</p>}

    {view === "connect" && access && <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="font-semibold">Máy và quyền truy cập</h3><p className="mt-1 text-sm text-slate-400">Token mới: tất cả store hiện có · một máy · 24 giờ. Thu hồi sẽ ngắt quyền trên mọi store.</p></div>
        {access.total > 0 && <button type="button" className={isSetupOpen ? BUTTON : PRIMARY} aria-expanded={isSetupOpen} onClick={() => setIsSetupOpen(value => !value)}>{isSetupOpen ? "Đóng thiết lập" : "+ Kết nối máy"}</button>}
      </div>
      {(isSetupOpen || access.total === 0) && <div className="grid gap-5 rounded-xl border border-cyan-900 bg-slate-900/60 p-4 lg:grid-cols-3">
        <div className="space-y-3"><h4 className="font-semibold text-cyan-300">1. Tải và giải nén</h4><p className="text-sm text-slate-400">Tải file ZIP, tạo thư mục <code className="text-slate-200">ffp-seo-worker</code> trên máy rồi giải nén toàn bộ file vào đó.</p><a className={`${BUTTON} inline-block`} href="/seo-agent-pack/ffp-seo-worker-1.0.0-preview.zip" download>Tải file ZIP</a></div>
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void handleCreate(); }}><h4 className="font-semibold text-cyan-300">2. Cấp quyền cho máy</h4><label className="grid gap-2 text-sm">Tên máy<input className={`${INPUT} w-full`} value={workerId} onChange={event => setWorkerId(event.target.value)} maxLength={100} required placeholder="Ví dụ: rua-laptop" /></label><button type="submit" className={PRIMARY} disabled={isBusy || !workerId.trim()}>{isBusy ? "Đang xử lý…" : "Tạo token"}</button></form>
        <div className="space-y-3"><h4 className="font-semibold text-cyan-300">3. Cài kết nối vào Codex</h4><p className="text-sm text-slate-400">Mở <code className="text-slate-200">README.md</code> trong thư mục vừa giải nén. Chạy lần lượt các lệnh ở mục <strong>Install → Login → Setup</strong>, sau đó đóng và mở lại Codex.</p><p className="text-sm text-slate-400">Cài xong? Sang <button type="button" className="text-cyan-300 underline" onClick={() => setView("runs")}>Phiên chạy</button> để giao việc.</p><details className="text-sm"><summary className="cursor-pointer text-slate-400">Máy cần có gì?</summary><p className="mt-2 text-slate-400">Python 3.11+ và kho mật khẩu hệ điều hành. Token chỉ nhập trong terminal, không dán vào chat.</p><a className="mt-2 inline-block text-cyan-300" href="/seo-agent-pack/ffp-seo-worker-1.0.0-preview.zip.sha256" download>Tải checksum SHA-256</a></details></div>
      </div>}
    </>}
    {token && <div className="space-y-3 rounded-xl border border-amber-700 bg-amber-950/20 p-4"><p className="text-sm text-amber-200">Token chỉ hiện lần này. Dùng để login trong terminal, không gửi vào chat.</p><code className="block break-all select-all text-sm">{token}</code><div className="flex gap-2"><button type="button" className={PRIMARY} onClick={() => void handleCopy(token, "Đã sao chép token. Chỉ dán vào lệnh login trong terminal.")}>Sao chép token</button><button type="button" className={BUTTON} onClick={() => setToken(null)}>Ẩn token</button></div></div>}

    {view === "connect" && access && <>
      {access.tokens.length === 0 ? <p className="py-5 text-center text-sm text-slate-400">Chưa có máy trên trang này. Bắt đầu bằng “Kết nối máy”.</p> : <div className="overflow-x-auto rounded-xl border border-slate-800"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-900/80 text-xs uppercase text-slate-400"><tr><th className="px-4 py-3">Máy</th><th className="px-4 py-3">Trạng thái</th><th className="px-4 py-3">Phạm vi</th><th className="px-4 py-3">Hết hạn</th><th className="px-4 py-3 text-right">Thao tác</th></tr></thead><tbody className="divide-y divide-slate-800">{access.tokens.map(entry => {
        const isExpired = entry.expiresAt <= Date.now();
        const isRevoked = entry.revokedAt !== null;
        const status = isRevoked ? "Đã thu hồi" : isExpired ? "Token hết hạn" : entry.jobId ? "Đang giữ công việc" : entry.lastSeenAt ? "Đã kết nối" : "Chưa đăng nhập";
        return <tr key={entry.id} className="bg-slate-950/30 align-top hover:bg-slate-900/50"><td className="px-4 py-3"><p className="font-semibold text-white">{entry.workerId}</p><details className="mt-1 text-xs text-slate-400"><summary className="cursor-pointer">Chi tiết</summary><p className="mt-2 max-w-sm break-words">Store: {(entry.storeIds ?? [storeId]).join(", ")}</p><p>Hoạt động cuối: {entry.lastSeenAt ? new Date(entry.lastSeenAt).toLocaleString() : "Chưa có"}</p><p className="break-all">Job: {entry.jobId ?? "Không có"}</p></details></td><td className={`px-4 py-3 ${isRevoked || isExpired ? "text-slate-400" : "text-cyan-300"}`}>{status}</td><td className="px-4 py-3 text-slate-300">{(entry.storeIds ?? [storeId]).length} store</td><td className="whitespace-nowrap px-4 py-3 text-slate-400">{new Date(entry.expiresAt).toLocaleString()}</td><td className="px-4 py-3 text-right">{isRevoked ? <button type="button" className="rounded-lg border border-rose-800 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-950/40 disabled:opacity-40" disabled={isBusy} onClick={() => void handleDelete(entry.id)}>Xóa</button> : <button type="button" className={BUTTON} disabled={isBusy} onClick={() => void handleRevoke(entry.id)}>Thu hồi</button>}</td></tr>;
      })}</tbody></table></div>}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-slate-400"><span>{access.total} token · Trang {offset / 50 + 1}</span><div className="flex gap-2"><button type="button" className={BUTTON} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Trước</button><button type="button" className={BUTTON} disabled={access.nextOffset === null} onClick={() => setOffset(access.nextOffset ?? offset)}>Sau</button></div></div>
    </>}

    {view === "runs" && access && <>
      <div className="space-y-3 rounded-xl border border-slate-700 bg-slate-900/50 p-4"><h3 className="font-semibold">Giao việc cho Codex</h3><div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-sm">Số sản phẩm<input type="number" min={1} step={1} className={`${INPUT} w-28`} value={target} onChange={event => setTarget(Number(event.target.value))} /></label><button type="button" className={PRIMARY} disabled={!access.claimsEnabled || !startPrompt} onClick={() => void handleCopyPrompt()}>Sao chép yêu cầu</button></div><label className="grid gap-2 text-sm text-slate-300">Prompt gửi Codex<textarea readOnly value={startPrompt} rows={9} className={`${INPUT} w-full resize-y leading-relaxed`} placeholder="Nhập số sản phẩm nguyên dương để xem prompt." /></label><p className="text-sm text-slate-400">Dán vào Codex trên máy đã kết nối để bắt đầu. Nút này chưa chạy SEO.</p></div>
      {runs && <><h3 className="font-semibold">Lịch sử · {runs.total} phiên</h3>{runs.runs.length === 0 && <p className="py-5 text-center text-sm text-slate-400">Chưa có phiên chạy trên trang này.</p>}{runs.runs.map(run => <article key={run.id} className="space-y-3 rounded-xl border border-slate-800 p-4"><div className="flex flex-wrap items-center justify-between gap-3"><h4 className="break-all font-semibold">{run.workerId}</h4><span className={run.state === "COMPLETED" ? "text-sm text-emerald-300" : "text-sm text-cyan-300"}>{RUN_LABELS[run.state] ?? run.state}</span></div><p className="text-lg font-semibold">{run.successful} / {run.target} <span className="text-sm font-normal text-slate-400">bản chờ duyệt</span></p>{run.state === "PARTIAL" && <button type="button" className={BUTTON} disabled={!access.claimsEnabled} onClick={() => void handleCopyPrompt(run.id)}>Sao chép yêu cầu tiếp tục · còn {Math.max(0, run.target - run.successful)}</button>}<details className="text-sm text-slate-400"><summary className="cursor-pointer">Chi tiết phiên</summary><p className="mt-2 break-all">ID: {run.id}</p><p>Lý do dừng: {run.stopReason ?? "—"}</p><p>Tiếp tục trên máy {run.workerId}.</p></details></article>)}<div className="flex items-center justify-between text-sm text-slate-400"><span>Trang {runOffset / 50 + 1}</span><div className="flex gap-2"><button type="button" className={BUTTON} disabled={runOffset === 0} onClick={() => setRunOffset(value => Math.max(0, value - 50))}>Trước</button><button type="button" className={BUTTON} disabled={runs.nextOffset === null} onClick={() => setRunOffset(runs.nextOffset ?? runOffset)}>Sau</button></div></div></>}
    </>}
    {view === "metrics" && <WorkerMetricsPanel client={client} storeId={storeId} />}
  </section>;
}
