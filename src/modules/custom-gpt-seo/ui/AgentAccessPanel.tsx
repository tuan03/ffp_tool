import { useEffect, useState } from "react";

import type { CustomGptClient } from "../service";
import type { AgentAccessPage, AgentRunPage } from "../types";

const BUTTON = "rounded-lg border border-slate-600 px-3 py-2 text-sm text-cyan-300 disabled:opacity-40";

export function AgentAccessPanel({ client, storeId }: { readonly client: CustomGptClient; readonly storeId: string }): React.JSX.Element {
  const [access, setAccess] = useState<AgentAccessPage | null>(null);
  const [runs, setRuns] = useState<AgentRunPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [runOffset, setRunOffset] = useState(0);
  const [workerId, setWorkerId] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [hasCopied, setHasCopied] = useState(false);
  const [target, setTarget] = useState(5);

  async function handleCopyPrompt(runId?: string): Promise<void> {
    const prompt = `Use $ffp-seo. Verify worker_status.storeId is ${JSON.stringify(storeId)}. ${runId ? `Resume run ${runId}; complete only its remaining target.` : `Start a run for ${target} successfully delivered Review drafts.`} Never approve or publish to Shopify. Report the run ID and confirmed progress if interrupted.`;
    try { await navigator.clipboard.writeText(prompt); }
    catch { setError("Không sao chép được prompt; kiểm tra quyền clipboard."); }
  }

  useEffect(() => {
    let cancelled = false;
    setAccess(null); setRuns(null); setError("");
    void Promise.all([client.agentAccess(storeId, offset), client.agentRuns(storeId, runOffset)])
      .then(([nextAccess, nextRuns]) => { if (!cancelled) { setAccess(nextAccess); setRuns(nextRuns); } })
      .catch(() => { if (!cancelled) setError("Không tải được Agent Access. Cần đăng nhập quản trị; dữ liệu cũ đã được ẩn."); });
    return () => { cancelled = true; };
  }, [client, storeId, offset, runOffset, refresh]);

  async function handleCreate(): Promise<void> {
    setIsBusy(true); setError(""); setToken(null); setHasCopied(false);
    try { const issued = await client.createAgentToken(storeId, workerId.trim()); setToken(issued.token); setRefresh(value => value + 1); }
    catch { setError("Không tạo được token. Kiểm tra tên máy và quyền quản trị."); }
    finally { setIsBusy(false); }
  }
  async function handleRevoke(tokenId: string): Promise<void> {
    if (!window.confirm("Thu hồi token sẽ dừng quyền truy cập và lease hiện tại của máy này. Tiếp tục?")) return;
    setIsBusy(true); setError(""); setToken(null);
    try { await client.revokeAgentToken(storeId, tokenId); setRefresh(value => value + 1); }
    catch { setError("Chưa thu hồi được token. Vui lòng thử lại."); }
    finally { setIsBusy(false); }
  }

  return <section className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900/40 p-5" aria-label="Agent Access">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-lg font-semibold text-white">Agent Access · {storeId}</h2><button type="button" className={BUTTON} onClick={() => setRefresh(value => value + 1)}>Làm mới</button></div>
    <p className="text-sm text-slate-400">Token có hiệu lực 24 giờ, chỉ cho một store và một máy. Không có quyền duyệt hoặc đồng bộ Shopify. Tài khoản quản trị dùng chung không xác định được cá nhân thực hiện.</p>
    <div className="flex flex-wrap gap-4 text-sm text-cyan-300"><a href="/seo-agent-pack/ffp-seo-worker-1.0.0-preview.zip" download>↓ Agent Pack (preview)</a><a href="/seo-agent-pack/ffp-seo-worker-1.0.0-preview.zip.sha256" download>SHA-256</a><span className="text-slate-400">Dùng Python 3.11+; token chỉ nhập trong terminal.</span></div>
    {error && <p role="alert" className="text-red-300">{error}</p>}
    {!error && !access && <p role="status">Đang tải…</p>}
    {access && <>
      <p className={access.claimsEnabled ? "text-emerald-300" : "text-amber-300"}>{access.claimsEnabled ? "Store đã bật worker mới." : "Chưa bật nhận job bằng worker mới. Tạo token không tự chuyển đổi Queue."}</p>
      <div className="flex flex-wrap items-end gap-3"><label className="grid gap-2 text-sm">Mục tiêu bản Review<input type="number" min={1} step={1} className="w-28 rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" value={target} onChange={event => setTarget(Number(event.target.value))} /></label><button type="button" className={BUTTON} disabled={!Number.isSafeInteger(target) || target < 1} onClick={() => { void handleCopyPrompt(); }}>Copy Start Prompt (không chứa token)</button></div>
      <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); void handleCreate(); }}>
        <label className="grid gap-2 text-sm">Tên máy<input className="rounded-lg border border-slate-600 bg-slate-950 px-3 py-2" value={workerId} onChange={event => setWorkerId(event.target.value)} maxLength={100} required placeholder="Ví dụ: Laptop SEO 1" /></label>
        <button type="submit" className={BUTTON} disabled={isBusy || !workerId.trim()}>Tạo token 24 giờ</button>
      </form>
      {token && <div className="space-y-2 rounded-lg border border-amber-700 p-3"><p>Token chỉ hiển thị lần này. Không gửi vào chat, prompt hoặc Git.</p><code className="block break-all select-all">{token}</code><button type="button" className={BUTTON} onClick={() => { void navigator.clipboard.writeText(token).then(() => setHasCopied(true)).catch(() => setError("Không truy cập được clipboard; hãy sao chép thủ công.")); }}>{hasCopied ? "Đã sao chép" : "Copy token"}</button> <button type="button" className={BUTTON} onClick={() => setToken(null)}>Ẩn token</button></div>}
      <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-2">Máy</th><th>Hết hạn</th><th>Lần hoạt động cuối</th><th>Job hiện tại</th><th>Quyền</th></tr></thead><tbody>{access.tokens.map(entry => <tr key={entry.id} className="border-t border-slate-800"><td className="p-2">{entry.workerId}</td><td>{new Date(entry.expiresAt).toLocaleString()}</td><td>{entry.lastSeenAt ? new Date(entry.lastSeenAt).toLocaleString() : "Chưa kết nối"}</td><td>{entry.jobId ?? "—"}</td><td>{entry.revokedAt !== null ? "Đã thu hồi" : <button type="button" className={BUTTON} disabled={isBusy} onClick={() => { void handleRevoke(entry.id); }}>Thu hồi</button>}</td></tr>)}</tbody></table></div>
      {access.total === 0 && <p>Chưa có token cho store này.</p>}
      <div className="flex gap-3"><span>{access.total} token · Trang {offset / 50 + 1}</span><button type="button" className={BUTTON} disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>Trước</button><button type="button" className={BUTTON} disabled={access.nextOffset === null} onClick={() => setOffset(access.nextOffset ?? offset)}>Sau</button></div>
    </>}
    {runs && <><h3 className="font-semibold">Lịch sử phiên chạy ({runs.total})</h3>{runs.runs.map(run => <div key={run.id} className="space-y-2 break-all text-sm"><p>{run.workerId} · {run.successful}/{run.target} bản Review · {run.state} · {run.stopReason ?? "—"} · {run.id}</p>{run.state === "PARTIAL" && <button type="button" className={BUTTON} onClick={() => { void handleCopyPrompt(run.id); }}>Copy Resume · còn {Math.max(0, run.target - run.successful)} bản · đúng máy {run.workerId}</button>}</div>)}<div className="flex gap-3"><button type="button" className={BUTTON} disabled={runOffset === 0} onClick={() => setRunOffset(value => Math.max(0, value - 50))}>Phiên trước</button><button type="button" className={BUTTON} disabled={runs.nextOffset === null} onClick={() => setRunOffset(runs.nextOffset ?? runOffset)}>Phiên sau</button></div></>}
  </section>;
}
