import { useEffect, useRef, useState } from "react";

import type { AmazonCrawlerStoreVendorManager } from "../../types";

interface CrawlerStoreVendorFieldProps {
  storeId: string;
  manager?: AmazonCrawlerStoreVendorManager;
  onReady: (value: { storeId: string; vendor: string | null }) => void;
}

export function CrawlerStoreVendorField({ storeId, manager, onReady }: CrawlerStoreVendorFieldProps): React.JSX.Element {
  const [draft, setDraft] = useState("");
  const [savedVendor, setSavedVendor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    let isCurrent = true;
    onReady({ storeId, vendor: null });
    setIsLoading(true);
    async function load(): Promise<void> {
      try {
        if (!manager) throw new Error("Chưa kết nối dịch vụ cấu hình Vendor.");
        const config = await manager.get(storeId);
        if (!isCurrent) return;
        setDraft(config.vendor ?? "");
        setSavedVendor(config.vendor);
        setError(null);
        onReady({ storeId, vendor: config.vendor });
      } catch {
        if (isCurrent) setError("Không tải được Vendor. Kiểm tra kết nối và thử lại bằng nút Lưu Vendor.");
      } finally {
        if (isCurrent) setIsLoading(false);
      }
    }
    void load();
    return () => { isCurrent = false; mounted.current = false; };
  }, [storeId, manager, onReady]);

  async function save(): Promise<void> {
    if (!manager || isSaving) return;
    setIsSaving(true);
    setError(null);
    try {
      const config = await manager.save(storeId, draft);
      if (!mounted.current) return;
      setDraft(config.vendor ?? "");
      setSavedVendor(config.vendor);
      onReady({ storeId, vendor: config.vendor });
    } catch {
      if (mounted.current) setError("Không lưu được Vendor. Nhập 1–255 ký tự và kiểm tra kết nối.");
    } finally {
      if (mounted.current) setIsSaving(false);
    }
  }

  const hasUnsavedChanges = draft.trim() !== savedVendor;
  return <div className="grid min-w-0 gap-1.5">
    <label htmlFor="crawler-store-vendor" className="text-sm text-slate-300">Vendor Shopify</label>
    <div className="flex min-w-0 gap-2">
      <input id="crawler-store-vendor" value={draft} maxLength={255} placeholder="Nhập tên thương hiệu / nhà cung cấp" disabled={isLoading || isSaving}
        className="min-w-0 flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100 disabled:opacity-50"
        onChange={(event) => {
          const vendor = event.target.value;
          setDraft(vendor);
          onReady({ storeId, vendor: vendor.trim() === savedVendor ? savedVendor : null });
        }} />
      <button type="button" disabled={isLoading || isSaving || !manager || !draft.trim() || (!hasUnsavedChanges && !error)}
        className="shrink-0 whitespace-nowrap rounded-lg border border-cyan-600 px-3 py-2 text-sm text-cyan-300 disabled:opacity-50" onClick={() => void save()}>
        {isSaving ? "Đang lưu..." : "Lưu Vendor"}
      </button>
    </div>
    <p role={error ? "alert" : "status"} className={`text-xs ${error ? "text-rose-300" : "text-slate-400"}`}>
      {error ?? (isLoading ? "Đang tải Vendor..." : !savedVendor ? "Lưu một lần cho store này trước khi cào." : hasUnsavedChanges ? "Chưa lưu thay đổi." : "Đã lưu cho store này. Thay đổi chỉ áp dụng cho job mới.")}
    </p>
  </div>;
}
