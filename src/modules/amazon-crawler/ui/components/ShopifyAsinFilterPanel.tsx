import { useEffect, useRef, useState } from "react";

import { AmazonCrawlerServiceError } from "../../service";
import { SHOPIFY_ASIN_FILTER_LIMIT } from "../../types";
import type { ShopifyAsinFilter, ShopifyAsinFilterProgress } from "../../types";
import { parseAsinFilterInput } from "../asin-filter-input";
import { markAsinFilterRow, readAsinFilterWorkspace, retainAsinFilterProgress, writeAsinFilterWorkspace } from "../asin-filter-workspace";
import type { AsinFilterWorkspace } from "../asin-filter-workspace";

interface ShopifyAsinFilterPanelProps {
  readonly storeId: string;
  readonly filterShopifyAsins: ShopifyAsinFilter;
  readonly onSelectAsin: (asin: string) => Promise<boolean> | boolean | void;
  readonly isSelectionDisabled: boolean;
}

type FilterState =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly progress: ShopifyAsinFilterProgress }
  | { readonly status: "unverified"; readonly message: string };

// Parent keys this workspace by store: drafts and in-flight reads must never cross stores.
export function ShopifyAsinFilterPanel({ storeId, filterShopifyAsins, onSelectAsin, isSelectionDisabled }: ShopifyAsinFilterPanelProps): React.JSX.Element {
  const [workspace, setWorkspace] = useState<AsinFilterWorkspace>(() => {
    try { return readAsinFilterWorkspace(window.localStorage, storeId); }
    catch { return { inputText: "", snapshot: null }; }
  });
  const { inputText, snapshot } = workspace;
  const [hasStorageError, setHasStorageError] = useState(false);
  const [filterState, setFilterState] = useState<FilterState>({ status: "idle" });
  const [copyMessage, setCopyMessage] = useState("");
  const activeRequest = useRef<AbortController | null>(null);
  const requestVersion = useRef(0);
  const parsed = parseAsinFilterInput(inputText);
  const isChecking = filterState.status === "checking";
  const hasTooManyAsins = parsed.asins.length > SHOPIFY_ASIN_FILTER_LIMIT;
  const verifiedResult = snapshot?.result ?? null;

  useEffect(() => {
    return () => { requestVersion.current++; activeRequest.current?.abort(); activeRequest.current = null; };
  }, []);

  useEffect(() => {
    try { setHasStorageError(!writeAsinFilterWorkspace(window.localStorage, storeId, workspace)); }
    catch { setHasStorageError(true); }
  }, [storeId, workspace]);

  function handleInputChange(nextText: string): void {
    requestVersion.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setWorkspace((current) => ({ ...current, inputText: nextText }));
    setFilterState({ status: "idle" });
    setCopyMessage("");
  }

  function handleStopCheck(): void {
    requestVersion.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setFilterState({ status: "unverified", message: "Đã dừng kiểm tra. Danh sách chưa được xác minh đầy đủ; chưa thể lấy danh sách ASIN chưa có." });
  }

  async function handleCheck(): Promise<void> {
    if (isChecking || !storeId || parsed.asins.length === 0 || hasTooManyAsins || parsed.invalidEntries.length > 0) return;
    const controller = new AbortController();
    activeRequest.current?.abort();
    activeRequest.current = controller;
    const version = ++requestVersion.current;
    setCopyMessage("");
    setFilterState({ status: "checking", progress: { scannedProducts: 0, pagesRead: 0 } });
    try {
      const result = await filterShopifyAsins({
        storeId, asins: parsed.asins, signal: controller.signal,
        onProgress: (progress) => { if (version === requestVersion.current) setFilterState({ status: "checking", progress }); },
      });
      if (version !== requestVersion.current || controller.signal.aborted) return;
      setWorkspace((current) => retainAsinFilterProgress({ ...current, inputText, snapshot: { result, inputText, checkedAt: new Date().toISOString() } }));
      setFilterState({ status: "idle" });
    } catch (error: unknown) {
      if (version !== requestVersion.current) return;
      setFilterState({ status: "unverified", message: error instanceof AmazonCrawlerServiceError ? error.message : "Không thể hoàn tất kiểm tra Shopify. Danh sách chưa được xác minh; kiểm tra kết nối/quyền của store rồi thử lại." });
    } finally {
      if (version === requestVersion.current) activeRequest.current = null;
    }
  }

  function handleMarkRow(asin: string, action: "selected" | "viewed"): void {
    setWorkspace((current) => markAsinFilterRow(current, asin, action));
  }

  async function handleCopy(text: string): Promise<void> {
    if (!navigator.clipboard) { window.prompt("Sao chép danh sách ASIN chưa có:", text); setCopyMessage("Đã mở danh sách để bạn sao chép."); return; }
    try {
      await navigator.clipboard.writeText(text);
      setCopyMessage("Đã sao chép ASIN.");
    }
    catch { setCopyMessage("Trình duyệt không cho sao chép tự động. Bạn có thể chọn văn bản ASIN để sao chép hoặc tải TXT."); }
  }

  function handleClear(): void {
    if (!window.confirm("Xóa danh sách lọc và kết quả của store này? Ô cào không bị thay đổi.")) return;
    requestVersion.current++;
    activeRequest.current?.abort();
    activeRequest.current = null;
    setWorkspace({ inputText: "", snapshot: null });
    setFilterState({ status: "idle" });
    setCopyMessage("");
  }

  function handleDownloadMissing(): void {
    if (!verifiedResult || verifiedResult.missingAsins.length === 0) return;
    const url = URL.createObjectURL(new Blob([verifiedResult.missingAsins.join("\n")], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `asin-chua-co-${storeId.replace(/[^a-zA-Z0-9_-]/g, "_")}.txt`;
    document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
  }

  return (
    <section aria-label="Lọc ASIN trên Shopify" className="min-w-0 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 shadow-xs">
      <div className="min-w-0 space-y-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </span>
            <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">Cấu hình Shopify</h2>
          </div>
          <button type="button" disabled={!inputText && !snapshot && !isChecking} onClick={handleClear} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 transition hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">Xóa danh sách</button>
        </div>
        {hasStorageError ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Không thể lưu trên trình duyệt. Danh sách chỉ giữ trong phiên này; hãy sao chép hoặc tải TXT trước khi rời trang.</p> : null}
        <p className="text-xs text-slate-600 dark:text-slate-400">Store: <strong className="break-words font-semibold text-blue-600 dark:text-blue-400">{storeId}</strong></p>
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Lọc ASIN trên Shopify</span>
          <span aria-hidden="true" title="Kiểm tra danh sách ASIN với sản phẩm trên Shopify của store đang chọn" className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-300">i</span>
        </div>
        <label className="grid gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-300">Danh sách ASIN cần lọc
          <textarea aria-label="Danh sách ASIN cần lọc" value={inputText} onChange={(event) => handleInputChange(event.target.value)} rows={3} maxLength={500000} placeholder="Dán ASIN hoặc link Amazon, mỗi dòng một mục" className="w-full min-w-0 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900 p-2 font-mono text-sm text-slate-900 dark:text-slate-100 focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300 dark:focus:border-blue-800" />
        </label>
        <p className="text-xs text-slate-500 dark:text-slate-400">{parsed.asins.length} ASIN{parsed.duplicateCount ? ` · bỏ ${parsed.duplicateCount} mục trùng` : ""}{parsed.invalidEntries.length ? ` · ${parsed.invalidEntries.length} mục lỗi` : ""}</p>
        {parsed.invalidEntries.length > 0 ? <div role="alert" className="rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3 text-xs text-amber-700 dark:text-amber-300">
          <p>Sửa các mục không hợp lệ trước khi kiểm tra:</p>
          <ul className="mt-2 max-h-32 list-inside list-disc overflow-auto">{parsed.invalidEntries.map((entry) => <li key={entry.position} className="break-words [overflow-wrap:anywhere]">Mục {entry.position}: {entry.value}</li>)}</ul>
        </div> : null}
        {hasTooManyAsins ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">Danh sách vượt {SHOPIFY_ASIN_FILTER_LIMIT} ASIN. Chia thành các lần kiểm tra nhỏ hơn.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" aria-label={isChecking ? "Đang kiểm tra…" : "Kiểm tra Shopify"} disabled={!storeId || parsed.asins.length === 0 || parsed.invalidEntries.length > 0 || hasTooManyAsins || isChecking} onClick={() => void handleCheck()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-xs transition hover:bg-blue-700 disabled:opacity-50">{isChecking ? "Đang kiểm tra…" : "Kiểm tra trên Shopify"}</button>
          {isChecking ? <button type="button" onClick={handleStopCheck} className="rounded-lg border border-amber-200 dark:border-amber-800 px-4 py-2 text-sm text-amber-700 dark:text-amber-300">Dừng kiểm tra</button> : null}
        </div>
        {filterState.status === "checking" ? <p role="status" className="text-sm text-blue-700 dark:text-blue-300">Đã đọc {filterState.progress.scannedProducts} sản phẩm Shopify · {filterState.progress.pagesRead} trang. Chờ kiểm tra đủ trước khi phân loại ASIN.</p> : null}
        {filterState.status === "unverified" ? <section aria-label="ASIN chưa xác minh" className="space-y-2 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/60 p-3">
          <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{filterState.message}</p>
          <p className="text-sm text-slate-700 dark:text-slate-300">Chưa xác minh: {parsed.asins.length} ASIN</p>
          <textarea aria-label="Danh sách ASIN chưa xác minh" readOnly value={parsed.asins.join("\n")} rows={4} className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 font-mono text-sm" />
        </section> : null}
        {verifiedResult ? <>
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Kết quả kiểm tra</span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400" title={snapshot ? `Kết quả lưu lúc ${new Date(snapshot.checkedAt).toLocaleString("vi-VN")}; kiểm tra lại để cập nhật.` : undefined}>{snapshot ? `↻ Cập nhật: ${new Date(snapshot.checkedAt).toLocaleTimeString("vi-VN")}` : ""}</span>
          </div>
          <p role="status" className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
            <strong className="rounded-md border border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 font-semibold text-emerald-700 dark:text-emerald-300">{verifiedResult.missingAsins.length} chưa có</strong>
            <span>· {verifiedResult.matches.length} đã có</span>
          </p>
          {snapshot?.inputText !== inputText ? (
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/80 dark:bg-amber-950/60 px-2.5 py-2 text-xs text-amber-800 dark:text-amber-300">
              <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white">!</span>
              <span>Đầu vào đã đổi. Kết quả cũ vẫn giữ; kiểm tra lại để cập nhật.</span>
            </p>
          ) : null}
          <div className="grid min-w-0 gap-2.5">
            <section aria-label="ASIN chưa có trên Shopify" className="min-w-0 space-y-2">
              <ul aria-label="Danh sách ASIN chưa có trên Shopify" className="max-h-60 space-y-1.5 overflow-y-auto">
                {verifiedResult.missingAsins.map((asin) => {
                  const row = workspace.progress?.rows[asin];
                  const isLatest = workspace.progress?.lastAsin === asin;
                  const hasAction = row?.copied || row?.viewed || row?.selected;
                  return <li key={asin} data-asin-row={asin} aria-current={isLatest ? "true" : undefined}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-2.5 py-2 ${isLatest ? "border-blue-300 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/60" : hasAction ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/60 dark:bg-emerald-950/60" : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900"}`}>
                  <div className="min-w-0">
                    <span className="font-mono text-sm font-medium text-slate-900 dark:text-slate-100">{asin}</span>
                    {hasAction ? <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                      {row?.copied ? <span className="text-emerald-700 dark:text-emerald-300">✓ Đã copy</span> : null}
                      {row?.selected ? <span className="text-emerald-700 dark:text-emerald-300">✓ Đã chọn cào</span> : null}
                      {row?.viewed ? <span className="text-emerald-700 dark:text-emerald-300">✓ Đã xem</span> : null}
                      {isLatest ? <span className="text-blue-700 dark:text-blue-300">Gần nhất</span> : null}
                    </div> : null}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button type="button" aria-label={`Dùng ASIN này ${asin}`} disabled={isSelectionDisabled}
                      onClick={async () => { if (await onSelectAsin(asin) === false) return; handleMarkRow(asin, "selected"); setCopyMessage(`Đã đưa ${asin} vào ô nhập. Chọn collection rồi bấm Bắt đầu cào.`); }}
                      className="min-h-8 rounded-md border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/60 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 transition hover:bg-blue-100/80 disabled:opacity-50">Dùng ASIN này</button>
                    <a aria-label={`View Amazon ${asin}`} href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer"
                      onClick={() => handleMarkRow(asin, "viewed")} onAuxClick={(event) => { if (event.button === 1) handleMarkRow(asin, "viewed"); }}
                      className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 transition hover:bg-slate-50 dark:hover:bg-slate-800">View ↗</a>
                  </div>
                </li>;
                })}
              </ul>
              {verifiedResult.missingAsins.length === 0 ? <p className="text-xs text-slate-600 dark:text-slate-400">Tất cả ASIN đã tồn tại trong store này.</p> : <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleCopy(verifiedResult.missingAsins.join("\n"))} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-2xs transition hover:bg-slate-50 dark:hover:bg-slate-800">Sao chép ASIN chưa có</button>
                <button type="button" onClick={handleDownloadMissing} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-300 shadow-2xs transition hover:bg-slate-50 dark:hover:bg-slate-800">Tải TXT</button>
              </div>}
              {copyMessage ? <p role="status" className="text-xs text-slate-700 dark:text-slate-300">{copyMessage}</p> : null}
            </section>
            <details className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-800/60 px-3 py-2">
              <summary className="cursor-pointer text-xs font-medium text-slate-600 dark:text-slate-400">Đã có trên Shopify ({verifiedResult.matches.length})</summary>
              <section aria-label="ASIN đã có trên Shopify" className="mt-2 min-w-0 space-y-2">
              {verifiedResult.matches.length === 0 ? <p className="text-sm text-slate-600 dark:text-slate-400">Không có ASIN nào trùng chính xác.</p> : <ul className="max-h-80 space-y-3 overflow-auto">
                {verifiedResult.matches.map((match) => <li key={match.asin} className="min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 text-sm">
                  <p className="font-mono text-blue-700 dark:text-blue-300">{match.asin} <span className="text-xs text-slate-500 dark:text-slate-400">· {match.status}</span></p>
                  <p className="mt-1 break-words text-slate-700 dark:text-slate-300 [overflow-wrap:anywhere]">{match.title}</p>
                  <a href={match.adminUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-700 dark:text-blue-300">Mở Shopify Admin →</a>
                </li>)}
              </ul>}
              </section>
            </details>
          </div>
        </> : null}
      </div>
    </section>
  );
}

