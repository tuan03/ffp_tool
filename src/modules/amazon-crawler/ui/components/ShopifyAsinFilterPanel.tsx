import { useEffect, useRef, useState } from "react";

import { AmazonCrawlerServiceError } from "../../service";
import { SHOPIFY_ASIN_FILTER_LIMIT } from "../../types";
import type { ShopifyAsinFilter, ShopifyAsinFilterProgress } from "../../types";
import { parseAsinFilterInput } from "../asin-filter-input";
import { readAsinFilterWorkspace, writeAsinFilterWorkspace } from "../asin-filter-workspace";
import type { AsinFilterWorkspace } from "../asin-filter-workspace";

interface ShopifyAsinFilterPanelProps {
  readonly storeId: string;
  readonly filterShopifyAsins: ShopifyAsinFilter;
}

type FilterState =
  | { readonly status: "idle" }
  | { readonly status: "checking"; readonly progress: ShopifyAsinFilterProgress }
  | { readonly status: "unverified"; readonly message: string };

// Parent keys this workspace by store: drafts and in-flight reads must never cross stores.
export function ShopifyAsinFilterPanel({ storeId, filterShopifyAsins }: ShopifyAsinFilterPanelProps): React.JSX.Element {
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
      setWorkspace({ inputText, snapshot: { result, inputText, checkedAt: new Date().toISOString() } });
      setFilterState({ status: "idle" });
    } catch (error: unknown) {
      if (version !== requestVersion.current) return;
      setFilterState({ status: "unverified", message: error instanceof AmazonCrawlerServiceError ? error.message : "Không thể hoàn tất kiểm tra Shopify. Danh sách chưa được xác minh; kiểm tra kết nối/quyền của store rồi thử lại." });
    } finally {
      if (version === requestVersion.current) activeRequest.current = null;
    }
  }

  async function handleCopy(text: string): Promise<void> {
    if (!navigator.clipboard) { window.prompt("Sao chép danh sách ASIN chưa có:", text); setCopyMessage("Đã mở danh sách để bạn sao chép."); return; }
    try { await navigator.clipboard.writeText(text); setCopyMessage("Đã sao chép ASIN."); }
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
    <section aria-label="Lọc ASIN trên Shopify" className="min-w-0 rounded-xl border border-cyan-900 bg-slate-950/50 p-4">
      <div className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold text-cyan-200">Lọc ASIN trên Shopify</h2>
          <button type="button" disabled={!inputText && !snapshot && !isChecking} onClick={handleClear} className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-300 disabled:opacity-50">Xóa danh sách</button>
        </div>
        <p className="text-xs leading-relaxed text-slate-400">Lọc → View Amazon để chọn collection → sao chép ASIN vào ô cào bên trái. Danh sách lưu riêng theo store trên trình duyệt này, không tự mất khi cào.</p>
        {hasStorageError ? <p role="alert" className="text-xs text-amber-200">Không thể lưu trên trình duyệt. Danh sách chỉ giữ trong phiên này; hãy sao chép hoặc tải TXT trước khi rời trang.</p> : null}
        <p className="text-sm text-slate-300">Store kiểm tra: <strong className="break-words text-cyan-200">{storeId}</strong> · metafield <code>custom.amazon_asin</code></p>
        <p className="text-xs leading-relaxed text-slate-400">So khớp chính xác từng ASIN, không loại cả family. Sản phẩm draft/archived vẫn tính là đã có. Chỉ đọc Shopify; không cần agent và không tự bắt đầu cào.</p>
        <label className="grid gap-2 text-sm text-slate-200">Danh sách ASIN cần lọc
          <textarea aria-label="Danh sách ASIN cần lọc" value={inputText} onChange={(event) => handleInputChange(event.target.value)} rows={6} maxLength={500000} placeholder="ASIN hoặc link Amazon; mỗi dòng một giá trị, hoặc ngăn cách bằng dấu phẩy" className="w-full min-w-0 rounded-xl border border-slate-700 bg-slate-900 p-3 font-mono text-sm outline-none focus:border-cyan-500" />
        </label>
        <p className="text-xs text-slate-400">{parsed.asins.length} ASIN hợp lệ · {parsed.duplicateCount} mục trùng đã bỏ · {parsed.invalidEntries.length} mục không hợp lệ · tối đa {SHOPIFY_ASIN_FILTER_LIMIT} ASIN/lần</p>
        {parsed.invalidEntries.length > 0 ? <div role="alert" className="rounded-lg border border-amber-800 bg-amber-950/20 p-3 text-xs text-amber-200">
          <p>Sửa các mục không hợp lệ trước khi kiểm tra:</p>
          <ul className="mt-2 max-h-32 list-inside list-disc overflow-auto">{parsed.invalidEntries.map((entry) => <li key={entry.position} className="break-words [overflow-wrap:anywhere]">Mục {entry.position}: {entry.value}</li>)}</ul>
        </div> : null}
        {hasTooManyAsins ? <p role="alert" className="text-sm text-amber-200">Danh sách vượt {SHOPIFY_ASIN_FILTER_LIMIT} ASIN. Chia thành các lần kiểm tra nhỏ hơn.</p> : null}
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!storeId || parsed.asins.length === 0 || parsed.invalidEntries.length > 0 || hasTooManyAsins || isChecking} onClick={() => void handleCheck()} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:opacity-50">{isChecking ? "Đang kiểm tra…" : "Kiểm tra Shopify"}</button>
          {isChecking ? <button type="button" onClick={handleStopCheck} className="rounded-lg border border-amber-700 px-4 py-2 text-sm text-amber-200">Dừng kiểm tra</button> : null}
        </div>
        {filterState.status === "checking" ? <p role="status" className="text-sm text-cyan-200">Đã đọc {filterState.progress.scannedProducts} sản phẩm Shopify · {filterState.progress.pagesRead} trang. Chờ kiểm tra đủ trước khi phân loại ASIN.</p> : null}
        {filterState.status === "unverified" ? <section aria-label="ASIN chưa xác minh" className="space-y-2 rounded-xl border border-amber-800 bg-amber-950/20 p-3">
          <p role="alert" className="text-sm text-amber-200">{filterState.message}</p>
          <p className="text-sm text-slate-300">Chưa xác minh: {parsed.asins.length} ASIN</p>
          <textarea aria-label="Danh sách ASIN chưa xác minh" readOnly value={parsed.asins.join("\n")} rows={4} className="w-full rounded-lg border border-slate-700 bg-slate-950 p-3 font-mono text-sm" />
        </section> : null}
        {verifiedResult ? <>
          <p role="status" className="text-sm text-slate-300">Đã có: <strong>{verifiedResult.matches.length}</strong> · Chưa có: <strong>{verifiedResult.missingAsins.length}</strong> · Đã đọc {verifiedResult.scannedProducts} sản phẩm Shopify · kiểm tra lúc {snapshot ? new Date(snapshot.checkedAt).toLocaleString("vi-VN") : ""}</p>
          <p className="text-xs text-amber-200">Kết quả tại lần kiểm tra trên, không tự cập nhật sau khi sync.{snapshot?.inputText !== inputText ? " Đầu vào đã thay đổi; danh sách bên dưới vẫn là kết quả trước đó." : ""} Bấm Kiểm tra Shopify để lọc lại.</p>
          <div className="grid min-w-0 gap-4">
            <section aria-label="ASIN chưa có trên Shopify" className="min-w-0 space-y-3 rounded-xl border border-emerald-900 bg-emerald-950/10 p-4">
              <h3 className="font-semibold text-emerald-300">Chưa có trên Shopify ({verifiedResult.missingAsins.length})</h3>
              <ul aria-label="Danh sách ASIN chưa có trên Shopify" className="max-h-80 space-y-2 overflow-y-auto">
                {verifiedResult.missingAsins.map((asin) => <li key={asin} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-slate-950 p-2">
                  <span className="font-mono text-sm text-slate-100">{asin}</span>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={`Sao chép ${asin}`} onClick={() => void handleCopy(asin)} className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200">Copy</button>
                    <a aria-label={`View Amazon ${asin}`} href={`https://www.amazon.com/dp/${asin}`} target="_blank" rel="noopener noreferrer" className="rounded border border-cyan-800 px-2 py-1 text-xs text-cyan-200">View ↗</a>
                  </div>
                </li>)}
              </ul>
              {verifiedResult.missingAsins.length === 0 ? <p className="text-xs text-slate-400">Tất cả ASIN đã tồn tại trong store này.</p> : <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void handleCopy(verifiedResult.missingAsins.join("\n"))} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Sao chép ASIN chưa có</button>
                <button type="button" onClick={handleDownloadMissing} className="rounded-lg border border-slate-700 px-3 py-2 text-xs">Tải TXT</button>
              </div>}
              {copyMessage ? <p role="status" className="text-xs text-slate-300">{copyMessage}</p> : null}
              <p className="text-xs leading-relaxed text-slate-400">Chưa có trên Shopify không có nghĩa chưa từng cào. Khi Start, hệ thống vẫn kiểm tra job/SEO Queue để tránh xử lý trùng.</p>
            </section>
            <section aria-label="ASIN đã có trên Shopify" className="min-w-0 space-y-3 rounded-xl border border-slate-800 p-4">
              <h3 className="font-semibold text-slate-200">Đã có trên Shopify ({verifiedResult.matches.length})</h3>
              {verifiedResult.matches.length === 0 ? <p className="text-sm text-slate-400">Không có ASIN nào trùng chính xác.</p> : <ul className="max-h-80 space-y-3 overflow-auto">
                {verifiedResult.matches.map((match) => <li key={match.asin} className="min-w-0 rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-sm">
                  <p className="font-mono text-cyan-200">{match.asin} <span className="text-xs text-slate-500">· {match.status}</span></p>
                  <p className="mt-1 break-words text-slate-300 [overflow-wrap:anywhere]">{match.title}</p>
                  <a href={match.adminUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-cyan-300">Mở Shopify Admin →</a>
                </li>)}
              </ul>}
            </section>
          </div>
        </> : null}
      </div>
    </section>
  );
}
