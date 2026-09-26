import React, { useState } from "react";
import type {
  CleanOrphanAssetsOutput,
  CustomizationGateway,
} from "../../types";
import { cleanOrphanAssets } from "../../service";

export interface OrphanAssetCleanerModalProps {
  readonly isOpen: boolean;
  readonly gateway: CustomizationGateway;
  readonly onClose: () => void;
}

export function OrphanAssetCleanerModal({
  isOpen,
  gateway,
  onClose,
}: OrphanAssetCleanerModalProps): React.JSX.Element | null {
  const [isScanning, setIsScanning] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [scanResult, setScanResult] = useState<CleanOrphanAssetsOutput | null>(null);
  const [cleanResult, setCleanResult] = useState<CleanOrphanAssetsOutput | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleScan = async () => {
    setIsScanning(true);
    setError(null);
    setCleanResult(null);
    try {
      const result = await cleanOrphanAssets(gateway, { dryRun: true });
      setScanResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsScanning(false);
    }
  };

  const handleExecuteClean = async () => {
    if (!scanResult || scanResult.orphanCount === 0) return;
    const confirmed = window.confirm(
      `CẢNH BÁO: Bạn sắp xóa vĩnh viễn ${scanResult.orphanCount} file mồ côi trên Shopify CDN!\nThao tác này KHÔNG thể hoàn tác. Bạn có chắc muốn tiếp tục không?`
    );
    if (!confirmed) return;

    setIsCleaning(true);
    setError(null);
    try {
      const result = await cleanOrphanAssets(gateway, { dryRun: false });
      setCleanResult(result);
      setScanResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsCleaning(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 shadow-2xl">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-800">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 text-sm">
                🧹
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-100">
                  Dọn Dẹp File CDN Mồ Côi (Orphan Asset Cleaner)
                </h3>
                <p className="text-xs text-slate-400">
                  Quét và giải phóng các file mockup/clipart cũ không còn được tham chiếu
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="py-4 space-y-4">
            <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 p-3.5 text-xs text-amber-300/90 leading-relaxed">
              <strong>Lưu ý:</strong> Chế độ quét ban đầu là <em>Dry-Run</em> (xem trước an toàn, chưa xóa bất kỳ file nào). Bạn chỉ xóa thực tế sau khi đã kiểm tra danh sách file.
            </div>

            {error && (
              <div className="rounded-xl border border-rose-800 bg-rose-950/50 p-3 text-xs text-rose-300">
                <strong>Lỗi:</strong> {error}
              </div>
            )}

            {/* Scan State */}
            {!scanResult && !cleanResult && (
              <div className="text-center py-6">
                <button
                  type="button"
                  onClick={handleScan}
                  disabled={isScanning}
                  className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-2.5 text-xs font-semibold text-white shadow-lg shadow-cyan-900/30 hover:bg-cyan-500 disabled:opacity-50 transition cursor-pointer"
                >
                  {isScanning ? (
                    <>
                      <span className="inline-block animate-spin">⏳</span>
                      <span>Đang quét Shopify CDN...</span>
                    </>
                  ) : (
                    <>
                      <span>🔍</span>
                      <span>Bắt đầu quét Dry-Run</span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Scan Results */}
            {scanResult && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <span className="text-slate-400 block mb-1">Tổng file đã quét</span>
                    <span className="text-lg font-bold text-slate-200">{scanResult.scannedCount}</span>
                  </div>
                  <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
                    <span className="text-slate-400 block mb-1">File mồ côi phát hiện</span>
                    <span className={`text-lg font-bold ${scanResult.orphanCount > 0 ? "text-amber-400" : "text-emerald-400"}`}>
                      {scanResult.orphanCount}
                    </span>
                  </div>
                </div>

                {scanResult.orphanCount > 0 ? (
                  <div>
                    <span className="text-[11px] font-medium text-slate-400 block mb-1.5">
                      Danh sách File GIDs mồ côi:
                    </span>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-800 bg-slate-950 p-2 text-[11px] font-mono text-slate-400 space-y-1">
                      {scanResult.orphanFileIds.map((id) => (
                        <div key={id} className="text-amber-300 truncate">
                          {id}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-400 font-medium text-center py-2">
                    ✓ Tuyệt vời! CDN của bạn sạch sẽ, không có file mồ côi nào.
                  </p>
                )}
              </div>
            )}

            {/* Clean Result Completed */}
            {cleanResult && (
              <div className="rounded-xl border border-emerald-900/60 bg-emerald-950/30 p-4 text-center space-y-2">
                <span className="text-2xl">🎉</span>
                <h4 className="text-sm font-bold text-emerald-300">
                  Dọn dẹp thành công!
                </h4>
                <p className="text-xs text-slate-300">
                  Đã xóa vĩnh viễn {cleanResult.deletedFileIds.length} file rác khỏi Shopify CDN.
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-400 hover:bg-slate-800 transition"
            >
              Đóng
            </button>

            {scanResult && scanResult.orphanCount > 0 && (
              <button
                type="button"
                onClick={handleExecuteClean}
                disabled={isCleaning}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-rose-900/40 hover:bg-rose-500 disabled:opacity-50 transition cursor-pointer"
              >
                {isCleaning ? "Đang xóa..." : `Xóa vĩnh viễn ${scanResult.orphanCount} file mồ côi`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
