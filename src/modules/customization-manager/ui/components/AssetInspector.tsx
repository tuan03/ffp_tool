import React, { useState } from "react";
import type { CustomizationAsset } from "../../../customization-normalizer";

export interface AssetInspectorProps {
  readonly assets: readonly CustomizationAsset[];
  readonly trackedFileIds?: readonly string[];
  readonly onChange: (updatedAssets: CustomizationAsset[]) => void;
}

export function AssetInspector({
  assets,
  trackedFileIds = [],
  onChange,
}: AssetInspectorProps): React.JSX.Element {
  const [newUrl, setNewUrl] = useState("");
  const [newAlt, setNewAlt] = useState("");
  const [newRole, setNewRole] = useState("preview");

  const handleAddAsset = () => {
    if (!newUrl.trim()) return;
    const newAsset: CustomizationAsset = {
      url: newUrl.trim(),
      alt: newAlt.trim() || undefined,
      roles: [newRole],
    };
    onChange([...assets, newAsset]);
    setNewUrl("");
    setNewAlt("");
  };

  const handleRemoveAsset = (index: number) => {
    const updated = assets.filter((_, i) => i !== index);
    onChange(updated);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Quản Lý Tài Nguyên CDN (Asset Inspector & Tracking)
          </h3>
          <p className="text-xs text-slate-400">
            Danh sách file ảnh phôi, clipart, swatch được lưu trữ trên Shopify CDN. Khi xóa hoặc thay đổi, hệ thống sẽ thực hiện dọn dẹp delta tự động.
          </p>
        </div>
        <div className="text-xs font-mono text-cyan-400 bg-cyan-950/40 border border-cyan-800/60 px-2.5 py-1 rounded-lg">
          {assets.length} Assets • {trackedFileIds.length} File GIDs
        </div>
      </div>

      {/* Add New Asset Form */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 space-y-3">
        <span className="text-xs font-medium text-slate-300">Thêm Asset mới thủ công:</span>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="md:col-span-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Shopify CDN URL (https://cdn.shopify.com/...)"
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div>
            <input
              type="text"
              value={newAlt}
              onChange={(e) => setNewAlt(e.target.value)}
              placeholder="Mô tả alt..."
              className="w-full rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="flex-1 rounded-lg border border-slate-800 bg-slate-950 px-2 py-1.5 text-xs text-slate-200 focus:border-cyan-500 focus:outline-none"
            >
              <option value="preview">preview</option>
              <option value="mockup">mockup</option>
              <option value="swatch">swatch</option>
              <option value="clipart">clipart</option>
            </select>
            <button
              type="button"
              onClick={handleAddAsset}
              disabled={!newUrl.trim()}
              className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-cyan-500 disabled:opacity-40 transition cursor-pointer"
            >
              Thêm
            </button>
          </div>
        </div>
      </div>

      {/* Asset Cards Grid */}
      {assets.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/30 p-8 text-center">
          <p className="text-xs text-slate-400">Không có asset nào trong cấu hình.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((asset, index) => {
            const hasGid = trackedFileIds[index];
            return (
              <div
                key={`${asset.url}-${index}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800 bg-slate-900/50 p-3 hover:border-slate-700 transition"
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center">
                    <img
                      src={asset.url}
                      alt={asset.alt || `Asset ${index + 1}`}
                      className="h-full w-full object-contain"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 flex-wrap mb-1">
                      {(asset.roles || ["asset"]).map((role: string) => (
                        <span
                          key={role}
                          className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-cyan-400 uppercase tracking-wider"
                        >
                          {role}
                        </span>
                      ))}
                      {hasGid && (
                        <span className="rounded bg-emerald-950/80 border border-emerald-800 px-1.5 py-0.5 text-[10px] text-emerald-300">
                          Tracked
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-medium text-slate-200 truncate">
                      {asset.alt || `Asset ${index + 1}`}
                    </p>

                    <p className="text-[11px] font-mono text-slate-500 truncate" title={asset.url}>
                      {asset.url}
                    </p>

                    {hasGid && (
                      <p className="text-[10px] font-mono text-slate-600 truncate mt-0.5">
                        GID: {hasGid}
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-3 flex items-center justify-between border-t border-slate-800/80 pt-2 text-[11px]">
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:text-cyan-300 hover:underline flex items-center gap-1"
                  >
                    Xem ảnh gốc ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemoveAsset(index)}
                    className="text-rose-400 hover:text-rose-300 transition"
                  >
                    Xóa asset
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
