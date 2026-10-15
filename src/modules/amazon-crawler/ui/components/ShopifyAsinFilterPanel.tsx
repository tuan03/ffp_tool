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
  readonly onSelectAsin: (asin: string) => void;
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
    <section aria-label="Lọc ASIN trên Shopify" className="min-w-0 rounded-lg border border-blue-200 bg-slate-50 p-4">
      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-blue-700">Lọc ASIN trên Shopify</h2>
          <button type="button" disabled={!inputText && !snapshot && !isChecking} onClick={handleClear} className="rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-700 disabled:opacity-50">Xóa danh sách</button>
        </div>
        {hasStorageError ? <p role="alert" className="text-xs text-amber-700">Không thể lưu trên trình duyệt. Danh sách chỉ giữ trong phiên này; hãy sao chép hoặc tải TXT trước khi rời trang.</p> : null}
        <p className="text-xs text-slate-600">Store: <strong className="break-words text-blue-700">{storeId}</strong></p>
        <label className="grid gap-2 text-sm text-slate-900">Danh sách ASIN cần lọc
          <textarea aria-label="Danh sách ASIN cần lọc" value={inputText} onChange={(event) => handleInputChange(event.target.value)} rows={4} maxLength={500000} placeholder="Dán ASIN hoặc link Amazon, mỗi dòng một mục" className="w-full min-w-0 rounded-lg border border-slate-300 bg-white p-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-blue-600/30 focus:border-blue-300" />
        </label>
        <p className="text-xs text-slate-600">{parsed.asins.length} ASIN{parsed.duplicateCount ? ` · bỏ ${parsed.duplicateCount} mục trùng` : ""}{parsed.invalidEntries.length ? ` · ${parsed.invalidEntries.length} mục lỗi` : ""}</p>
        {parsed.invalidEntries.length > 0 ? <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
          <p>Sửa các mục không hợp lệ trước khi kiểm tra:</p>
          <ul className="mt-2 max-h-32 list-inside list-disc overflow-auto">{parsed.invalidEntries.map((entry) => <li key={entry.position} className="break-words [overflow-wrap:anywhere]">Mục {entry.position}: {entry.value}</li>)}</ul>
        </div> : null}
        {hasTooManyAsins ? <p role="alert" className="text-sm text-amber-700">Danh sách vượt {SHOPIFY_ASIN_FILTER_LIMIT} ASIN. Chia thành các lần kiểm tra nhỏ hơn.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!storeId || parsed.asins.length === 0 || parsed.invalidEntries.length > 0 || hasTooManyAsins || isChecking} onClick={() => void handleCheck()} className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{isChecking ? "Đang kiểm tra…" : "Kiểm tra Shopify"}</button>
          {isChecking ? <button type="button" onClick={handleStopCheck} className="rounded-lg border border-amber-200 px-4 py-2 text-sm text-amber-700">Dừng kiểm tra</button> : null}
        </div>
        {filterState.status === "checking" ? <p role="status" className="text-sm text-blue-700">Đã đọc {filterState.progress.scannedProducts} sản phẩm Shopify · {filterState.progress.pagesRead} trang. Chờ kiểm tra đủ trước khi phân loại ASIN.</p> : null}
        {filterState.status === "unverified" ? <section aria-label="ASIN chưa xác minh" className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <p role="alert" className="text-sm text-amber-700">{filterState.message}</p>
          <p className="text-sm text-slate-700">Chưa xác minh: {parsed.asins.length} ASIN</p>
          <textarea aria-label="Danh sách ASIN chưa xác minh" readOnly value={parsed.asins.join("\n")} rows={4} className="w-full rounded-lg border border-slate-300 bg-white p-3 font-mono text-sm" />
        </section> : null}
        {verifiedResult ? <>
          <p role="status" className="flex flex-wrap justify-between gap-2 text-xs text-slate-600">
            <span><strong className="text-emerald-700">{verifiedResult.missingAsins.length} chưa có</strong> · {verifiedResult.matches.length} đã có</span>
            <span title={snapshot ? `Kết quả lưu lúc ${new Date(snapshot.checkedAt).toLocaleString("vi-VN")}; kiểm tra lại để cập nhật.` : undefined}>{snapshot ? new Date(snapshot.checkedAt).toLocaleTimeString("vi-VN") : ""}</span>
          </p>
          {snapshot?.inputText !== inputText ? <p className="text-xs text-amber-700">Đầu vào đã đổi. Kết quả cũ vẫn giữ; kiểm tra lại để cập nhật.</p> : null}
          <div className="grid min-w-0 gap-3">
            <section aria-label="ASIN chưa có trên Shopify" className="min-w-0 space-y-2">
              <ul aria-label="Danh sách ASIN chưa có trên Shopify" className="max-h-60 space-y-1.5 overflow-y-auto">
                {verifiedResult.missingAsins.map((asin) => {
                  const row = workspace.progress?.rows[asin];
                  const isLatest = workspace.progress?.lastAsin === asin;
                  const hasAction = row?.copied || row?.viewed || row?.selected;
                  return <li key={asin} data-asin-row={asin} aria-current={isLatest ? "true" : undefined}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 ${isLatest ? "border-blue-300 bg-blue-50" : hasAction ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-slate-900">{asin}</span>
                    {hasAction ? <div className="mt-0.5 flex flex-wrap gap-x-2 text-[11px]">
                      {row?.copied ? <span className="text-emerald-700">✓ Đã copy</span> : null}
                      {row?.selected ? <span className="text-emerald-700">✓ Đã chọn cào</span> : null}
                      {row?.viewed ? <span className="text-emerald-700">✓ Đã xem</span> : null}
                      {isLatest ? <span className="text-blue-700">Gần nhất</span> : null}
                    </div> : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`Chọn cào ${asin}`} disabled={isSelectionDisabled}
                      onClick={() => { onSelectAsin(asin); handleMarkRow(asin, "selected"); setCopyMessage(`Ô cào hiện chỉ có ${asin}. Chọn collection rồi bấm Bắt đầu cào.`); }}
                      className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-xs text-blue-700 disabled:opacity-50">Cào</button>
                    <a aria-label={`View Amazon ${asin}`} href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer"
                      onClick={() => handleMarkRow(asin, "viewed")} onAuxClick={(event) => { if (event.button === 1) handleMarkRow(asin, "viewed"); }}
                      className="rounded border border-blue-200 px-2 py-1 text-xs text-blue-700">View ↗</a>
                  </div>
                </li>;
                })}
              </ul>
              {verifiedResult.missingAsins.length === 0 ? <p className="text-xs text-slate-600">Tất cả ASIN đã tồn tại trong store này.</p> : <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleCopy(verifiedResult.missingAsins.join("\n"))} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Sao chép ASIN chưa có</button>
                <button type="button" onClick={handleDownloadMissing} className="rounded-lg border border-slate-300 px-3 py-2 text-xs">Tải TXT</button>
              </div>}
              {copyMessage ? <p role="status" className="text-xs text-slate-700">{copyMessage}</p> : null}
            </section>
            <details className="min-w-0 rounded-lg border border-slate-200 p-2">
              <summary className="cursor-pointer text-xs text-slate-600">Đã có trên Shopify ({verifiedResult.matches.length})</summary>
              <section aria-label="ASIN đã có trên Shopify" className="mt-2 min-w-0 space-y-2">
              {verifiedResult.matches.length === 0 ? <p className="text-sm text-slate-600">Không có ASIN nào trùng chính xác.</p> : <ul className="max-h-80 space-y-3 overflow-auto">
                {verifiedResult.matches.map((match) => <li key={match.asin} className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                  <p className="font-mono text-blue-700">{match.asin} <span className="text-xs text-slate-500">· {match.status}</span></p>
                  <p className="mt-1 break-words text-slate-700 [overflow-wrap:anywhere]">{match.title}</p>
                  <a href={match.adminUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-blue-700">Mở Shopify Admin →</a>
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
