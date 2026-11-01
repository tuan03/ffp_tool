import { useEffect, useRef, useState } from "react";

import type { EtsyConnectionStatus, EtsyCrawlerClient, EtsyPreflightResult } from "../../etsy-types";
import { normalizeEtsyListingId } from "../../etsy-input";
import { analyzeCrawlerInput } from "../crawler-input";

const fieldClass = "w-full rounded-lg border border-slate-300 bg-white p-2 text-sm dark:border-slate-700 dark:bg-slate-900";
const buttonClass = "rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50 dark:border-slate-700";

interface EtsyWorkspace {
  text: string;
  listingIds: string[];
  visited: string[];
}

function readWorkspace(key: string): EtsyWorkspace {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
    if (saved && typeof saved === "object" && "text" in saved && typeof saved.text === "string"
      && "listingIds" in saved && Array.isArray(saved.listingIds) && "visited" in saved && Array.isArray(saved.visited)) {
      return { text: saved.text, listingIds: saved.listingIds.filter((id): id is string => typeof id === "string" && /^\d{6,20}$/.test(id)),
        visited: saved.visited.filter((id): id is string => typeof id === "string") };
    }
  } catch { /* A fresh workspace remains usable when storage is unavailable. */ }
  return { text: "", listingIds: [], visited: [] };
}

export function EtsyListingPanel({ storeId, client, isBusy, onUseListing }: {
  readonly storeId: string;
  readonly client: EtsyCrawlerClient;
  readonly isBusy: boolean;
  readonly onUseListing: (listingId: string) => void;
}): React.JSX.Element {
  const key = `ffp_etsy_filter_v1:${storeId}`;
  const [workspace, setWorkspace] = useState(() => readWorkspace(key));
  const [isChecking, setIsChecking] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(workspace)); } catch { /* Keep the in-memory list. */ } }, [key, workspace]);
  const analysis = analyzeCrawlerInput(workspace.text, "etsy");
  function markVisited(listingId: string): void {
    setWorkspace(current => ({ ...current, visited: [...new Set([...current.visited, listingId])] }));
  }
  async function handleCheck(): Promise<void> {
    if (isChecking || analysis.invalidEntries.length || !analysis.validCount || analysis.validCount > 200) return;
    controller.current = new AbortController();
    setIsChecking(true);
    setError("");
    try {
      const ids = [...new Set(workspace.text.split(/\r?\n/).filter(line => line.trim()).map(normalizeEtsyListingId))];
      const result = await client.check(storeId, ids, controller.current.signal);
      if (!mounted.current) return;
      if (!result.ready) throw new Error("Shopify đang lập chỉ mục Etsy. Vui lòng kiểm tra lại sau.");
      setWorkspace(current => ({ ...current, listingIds: [...result.allowedListingIds] }));
      setMessage(describeEtsyPreflight(result));
    } catch (caught) {
      if (mounted.current) setError(caught instanceof Error ? caught.message : "Không kiểm tra được listing Etsy.");
    } finally { if (mounted.current) setIsChecking(false); }
  }
  return <aside className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
    <div className="flex items-center justify-between gap-2"><h2 className="font-semibold">Lọc listing Etsy</h2>
      <button type="button" className={buttonClass} disabled={isChecking} onClick={() => { setWorkspace({ text: "", listingIds: [], visited: [] }); setMessage(""); setError(""); }}>Xóa danh sách</button></div>
    <p className="text-xs text-slate-500">Store: {storeId}</p>
    <label className="grid gap-1 text-sm">Link Etsy hoặc listing ID
      <textarea className={fieldClass} rows={4} value={workspace.text} disabled={isChecking} onChange={event => setWorkspace(current => ({ ...current, text: event.target.value }))} /></label>
    <div className="flex items-center justify-between gap-2"><span className="text-xs">{analysis.validCount}/200 listing · {analysis.invalidEntries.length} không hợp lệ</span>
      <button type="button" className={buttonClass} disabled={isChecking || !analysis.validCount || analysis.validCount > 200 || analysis.invalidEntries.length > 0} onClick={() => void handleCheck()}>{isChecking ? "Đang kiểm tra…" : "Kiểm tra"}</button></div>
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
    {message ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{message}</p> : null}
    <ul className="max-h-96 space-y-2 overflow-auto">{workspace.listingIds.map(listingId => <li key={listingId}
      className={`flex items-center gap-2 rounded-lg border p-2 ${workspace.visited.includes(listingId) ? "border-blue-400 bg-blue-50 dark:bg-blue-950" : "border-slate-200 dark:border-slate-700"}`}>
      <span className="min-w-0 flex-1 font-mono text-sm">{listingId}{workspace.visited.includes(listingId) ? <span className="ml-1" aria-label="Đã thao tác">✓</span> : null}</span>
      <button type="button" className={buttonClass} disabled={isBusy} onClick={() => { markVisited(listingId); onUseListing(listingId); }}>Cào</button>
      <a className={buttonClass} href={`https://www.etsy.com/listing/${listingId}`} target="_blank" rel="noopener noreferrer" onClick={() => markVisited(listingId)}>View ↗</a>
    </li>)}</ul>
    <EtsyConnectionPanel client={client} />
  </aside>;
}

function describeEtsyPreflight(result: EtsyPreflightResult): string {
  const count = (statuses: readonly string[]): number => result.listings.filter(listing => statuses.includes(listing.status)).length;
  return `${result.allowedListingIds.length} có thể cào · ${count(["existing"])} đã có Shopify · ${count(["processing", "crawled_pending_sync"])} đang xử lý · ${count(["reconciliation_required"])} cần kiểm tra`;
}

function EtsyConnectionPanel({ client }: { readonly client: EtsyCrawlerClient }): React.JSX.Element {
  const [status, setStatus] = useState<EtsyConnectionStatus | null>(null);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [credentials, setCredentials] = useState({ keystring: "", sharedSecret: "", accessToken: "", refreshToken: "", refreshEnabled: true });
  useEffect(() => { let current = true; void client.status().then(next => {
    if (current) { setStatus(next); setCredentials(previous => ({ ...previous, refreshEnabled: next.refreshEnabled })); }
  }).catch(() => { if (current) setMessage("Chưa đọc được kết nối Etsy."); }); return () => { current = false; }; }, [client]);
  async function handleAction(action: "save" | "test"): Promise<void> {
    setIsBusy(true);
    setMessage("");
    try {
      if (action === "save") {
        const saved = await client.save(credentials);
        setStatus(saved);
        setCredentials({ keystring: "", sharedSecret: "", accessToken: "", refreshToken: "", refreshEnabled: saved.refreshEnabled });
        setMessage("Đã lưu kết nối Etsy.");
      } else {
        const ok = await client.test();
        setStatus(await client.status());
        setMessage(ok ? "Kết nối Etsy thành công." : "Etsy chưa xác nhận kết nối. Kiểm tra token và quyền ứng dụng.");
      }
    } catch (caught) { setMessage(caught instanceof Error ? caught.message : "Không cập nhật được kết nối Etsy."); }
    finally { setIsBusy(false); }
  }
  return <details className="border-t border-slate-200 pt-3 dark:border-slate-700">
    <summary className="cursor-pointer text-sm font-medium">Kết nối Etsy · {status?.configured ? "Đã cấu hình" : "Chưa cấu hình"}</summary>
    <div className="mt-3 space-y-2">
      <p className="text-xs text-slate-500">Chỉ cấu hình tại server quản lý token. Để trống để giữ giá trị cũ. Không dùng cùng token để refresh ở tool cũ hoặc môi trường khác.</p>
      {([ ["keystring", "API Key"], ["sharedSecret", "Shared Secret"], ["accessToken", "Access Token"], ["refreshToken", "Refresh Token"] ] as const).map(([field, label]) =>
        <label key={field} className="grid gap-1 text-xs">{label}<input type="password" autoComplete="off" className={fieldClass} value={credentials[field]} onChange={event => setCredentials(current => ({ ...current, [field]: event.target.value }))} /></label>)}
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={credentials.refreshEnabled} onChange={event => setCredentials(current => ({ ...current, refreshEnabled: event.target.checked }))} />Cho phép server này tự làm mới token</label>
      <div className="flex gap-2"><button type="button" className={buttonClass} disabled={isBusy} onClick={() => void handleAction("save")}>Lưu kết nối</button>
        <button type="button" className={buttonClass} disabled={isBusy || !status?.configured} onClick={() => void handleAction("test")}>Kiểm tra kết nối</button></div>
      {message ? <p role="status" className="text-sm">{message}</p> : null}
    </div>
  </details>;
}
