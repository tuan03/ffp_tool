import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
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
        className="fixed inset-0 bg-slate-50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <div className="flex min-h-screen items-center justify-center p-4">
        <div className="relative w-full max-w-lg rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b border-slate-200">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-50 border border-amber-300 text-amber-700 text-sm">
                🧹
              </span>
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Dọn Dẹp File CDN Mồ Côi (Orphan Asset Cleaner)
                </h3>
                <p className="text-xs text-slate-600">
                  Quét và giải phóng các file mockup/clipart cũ không còn được tham chiếu
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg p-1 text-slate-600 hover:bg-slate-50 hover:text-slate-900 transition"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="py-4 space-y-4">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5 text-xs text-amber-700 leading-relaxed">
              <strong>Lưu ý:</strong> Chế độ quét ban đầu là <em>Dry-Run</em> (xem trước an toàn, chưa xóa bất kỳ file nào). Bạn chỉ xóa thực tế sau khi đã kiểm tra danh sách file.
            </div>

            {error && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-xs text-rose-700">
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
                  className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50 transition cursor-pointer"
                >
                  {isScanning ? (
                    <>
                      <span className="inline-block animate-spin"><AppIcon name="clock" /></span>
                      <span>Đang quét Shopify CDN...</span>
                    </>
                  ) : (
                    <>
                      <span><AppIcon name="search" /></span>
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
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <span className="text-slate-600 block mb-1">Tổng file đã quét</span>
                    <span className="text-lg font-bold text-slate-900">{scanResult.scannedCount}</span>
                  </div>
                  <div className="rounded-lg border border-slate-200 bg-white p-3">
                    <span className="text-slate-600 block mb-1">File mồ côi phát hiện</span>
                    <span className={`text-lg font-bold ${scanResult.orphanCount > 0 ? "text-amber-700" : "text-emerald-700"}`}>
                      {scanResult.orphanCount}
                    </span>
                  </div>
                </div>

                {scanResult.orphanCount > 0 ? (
                  <div>
                    <span className="text-xs font-medium text-slate-600 block mb-1.5">
                      Danh sách File GIDs mồ côi:
                    </span>
                    <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 text-xs font-mono text-slate-600 space-y-1">
                      {scanResult.orphanFileIds.map((id) => (
                        <div key={id} className="text-amber-700 truncate">
                          {id}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="text-xs text-emerald-700 font-medium text-center py-2">
                    ✓ Tuyệt vời! CDN của bạn sạch sẽ, không có file mồ côi nào.
                  </p>
                )}
              </div>
            )}

            {/* Clean Result Completed */}
            {cleanResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-center space-y-2">
                <span className="text-2xl">🎉</span>
                <h4 className="text-sm font-bold text-emerald-700">
                  Dọn dẹp thành công!
                </h4>
                <p className="text-xs text-slate-700">
                  Đã xóa vĩnh viễn {cleanResult.deletedFileIds.length} file rác khỏi Shopify CDN.
                </p>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 transition"
            >
              Đóng
            </button>

            {scanResult && scanResult.orphanCount > 0 && (
              <button
                type="button"
                onClick={handleExecuteClean}
                disabled={isCleaning}
                className="inline-flex items-center gap-1.5 rounded-lg bg-rose-600 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-50 transition cursor-pointer"
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
