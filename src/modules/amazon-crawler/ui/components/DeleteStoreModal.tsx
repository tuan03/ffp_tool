import { useState } from "react";

export interface DeleteStoreModalProps {
  readonly isOpen: boolean;
  readonly storeId: string;
  readonly shopDomain: string;
  readonly onClose: () => void;
  readonly onStoreDeleted: (storeId: string) => void;
}

export function DeleteStoreModal({
  isOpen,
  storeId,
  shopDomain,
  onClose,
  onStoreDeleted,
}: DeleteStoreModalProps): React.JSX.Element | null {
  const [isDeleting, setIsDeleting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen) return null;

  async function handleDelete(): Promise<void> {
    setIsDeleting(true);
    setErrorMessage(null);

    try {
      const res = await fetch("/api/stores/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error?.message || "Không thể xóa store. Vui lòng thử lại.");
      }

      onStoreDeleted(storeId);
      onClose();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Lỗi mạng khi xóa store.");
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isDeleting) {
          onClose();
        }
      }}
    >
      <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-rose-500/10 text-rose-400">
            <svg className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-bold text-slate-100">Xóa Shopify Store</h3>
            <p className="text-xs text-slate-400">Ngắt kết nối và gỡ cấu hình store khỏi hệ thống</p>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-rose-500/20 bg-rose-950/20 p-3.5 text-sm text-slate-300 space-y-2">
          <p>
            Bạn có chắc chắn muốn xóa store <strong className="font-mono text-rose-300">{storeId}</strong>
            {shopDomain ? <span> ({shopDomain})</span> : null}?
          </p>
          <p className="text-xs text-rose-200/80">
            ⚠️ Thao tác này sẽ loại bỏ hoàn toàn thông tin xác thực, token và proxy của store này khỏi cấu hình máy chủ.
          </p>
        </div>

        {errorMessage && (
          <div className="mt-3 rounded-lg border border-rose-500/30 bg-rose-950/50 p-3 text-xs text-rose-300">
            {errorMessage}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isDeleting}
            className="rounded-lg border border-slate-700 bg-slate-800 px-4 py-2 text-sm font-medium text-slate-300 hover:bg-slate-700 disabled:opacity-50 transition-colors"
          >
            Hủy bỏ
          </button>
          <button
            type="button"
            onClick={() => void handleDelete()}
            disabled={isDeleting}
            className="inline-flex items-center gap-2 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-rose-500 disabled:opacity-50 transition-colors"
          >
            {isDeleting ? (
              <>
                <svg className="h-4 w-4 animate-spin text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span>Đang xóa...</span>
              </>
            ) : (
              <span>Xác nhận xóa</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
