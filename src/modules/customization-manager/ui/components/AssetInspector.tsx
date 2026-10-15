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
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Tài Nguyên CDN ({assets.length})
        </h3>
        <div className="text-xs font-mono text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 px-2.5 py-1 rounded-lg">
          {trackedFileIds.length} Files tracked
        </div>
      </div>

      {/* Add New Asset Form */}
      <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3.5 space-y-3">
        <span className="text-xs font-medium text-slate-700 dark:text-slate-300">Thêm Asset mới thủ công:</span>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div className="md:col-span-2">
            <input
              type="text"
              value={newUrl}
              onChange={(e) => setNewUrl(e.target.value)}
              placeholder="Shopify CDN URL (https://cdn.shopify.com/...)"
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
            />
          </div>
          <div>
            <input
              type="text"
              value={newAlt}
              onChange={(e) => setNewAlt(e.target.value)}
              placeholder="Mô tả alt..."
              className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
            />
          </div>
          <div className="flex gap-2">
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value)}
              className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
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
              className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:opacity-40 transition cursor-pointer"
            >
              Thêm
            </button>
          </div>
        </div>
      </div>

      {/* Asset Cards Grid */}
      {assets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-8 text-center">
          <p className="text-xs text-slate-600 dark:text-slate-400">Không có asset nào trong cấu hình.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {assets.map((asset, index) => {
            const hasGid = trackedFileIds[index];
            return (
              <div
                key={`${asset.url}-${index}`}
                className="group relative flex flex-col justify-between overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-3 hover:border-slate-300 dark:hover:border-slate-700 transition"
              >
                <div className="flex items-start gap-3">
                  {/* Thumbnail */}
                  <div className="h-16 w-16 flex-shrink-0 overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 flex items-center justify-center">
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
                          className="rounded bg-slate-50 dark:bg-slate-800 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:text-blue-300 uppercase tracking-wider"
                        >
                          {role}
                        </span>
                      ))}
                      {hasGid && (
                        <span className="rounded bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 px-1.5 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
                          Tracked
                        </span>
                      )}
                    </div>

                    <p className="text-xs font-medium text-slate-900 dark:text-slate-100 truncate">
                      {asset.alt || `Asset ${index + 1}`}
                    </p>

                    <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate" title={asset.url}>
                      {asset.url}
                    </p>

                    {hasGid && (
                      <p className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate mt-0.5">
                        GID: {hasGid}
                      </p>
                    )}
                  </div>
                </div>

                {/* Footer Actions */}
                <div className="mt-3 flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-2 text-xs">
                  <a
                    href={asset.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-700 dark:text-blue-300 hover:text-blue-700 dark:hover:text-blue-300 hover:underline flex items-center gap-1"
                  >
                    Xem ảnh gốc ↗
                  </a>
                  <button
                    type="button"
                    onClick={() => handleRemoveAsset(index)}
                    className="text-rose-700 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-300 transition"
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
