import React, { useState } from "react";

import { AppIcon } from "../../../../shared/components/AppIcon";
export interface PlacementItem {
  name: string;
  placementId: string;
  allowedTypes: string[];
}

export interface SurfaceItem {
  name: string;
  surfaceId: string;
  previewUrl?: string;
  fileId?: string;
  placements?: PlacementItem[];
}

export interface SurfaceManagerProps {
  readonly surfaces: readonly SurfaceItem[];
  readonly onChange: (updatedSurfaces: SurfaceItem[]) => void;
}

export function SurfaceManager({
  surfaces,
  onChange,
}: SurfaceManagerProps): React.JSX.Element {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleRemoveSurface = (index: number) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa mặt in "${surfaces[index].name}" không?`)) {
      return;
    }
    const updated = surfaces.filter((_, i) => i !== index);
    onChange(updated);
    if (editingIndex === index) {
      setEditingIndex(null);
    } else if (editingIndex !== null && editingIndex > index) {
      setEditingIndex(editingIndex - 1);
    }
  };

  const handleUpdateSurfaceField = <K extends keyof SurfaceItem>(
    index: number,
    field: K,
    value: SurfaceItem[K],
  ) => {
    const updated = surfaces.map((item, i) => {
      if (i === index) {
        return { ...item, [field]: value };
      }
      return item;
    });
    onChange(updated);
  };

  const handleRemovePlacement = (surfaceIndex: number, placementIndex: number) => {
    const surface = surfaces[surfaceIndex];
    const updatedPlacements = (surface.placements ?? []).filter((_, i) => i !== placementIndex);
    handleUpdateSurfaceField(surfaceIndex, "placements", updatedPlacements);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Mặt In
        </h3>
      </div>

      {surfaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center bg-slate-50 dark:bg-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-400">Chưa có mặt in nào.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {surfaces.map((surface, idx) => {
            const isEditing = editingIndex === idx;
            return (
              <div
                key={surface.surfaceId || idx}
                className={`rounded-lg border p-4 transition-all ${
                  isEditing
                    ? "border-blue-300 dark:border-blue-800 bg-slate-50 dark:bg-slate-800 shadow-md "
                    : "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-700"
                }`}
              >
                {/* Surface Header */}
                <div className={`flex items-center justify-between gap-3 ${isEditing ? "mb-3" : ""}`}>
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {surface.previewUrl ? (
                      <img
                        src={surface.previewUrl}
                        alt={surface.name}
                        className="h-10 w-10 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 text-xs flex-shrink-0">
                        <AppIcon name="image" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                        {surface.name || "Chưa đặt tên"}
                      </h4>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditingIndex(isEditing ? null : idx)}
                      className="rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-slate-100 transition whitespace-nowrap cursor-pointer"
                    >
                      {isEditing ? "Thu gọn" : "Chỉnh sửa"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSurface(idx)}
                      className="rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 px-2.5 py-1.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-950/80 transition whitespace-nowrap cursor-pointer"
                      title="Xóa mặt in"
                    >
                      Xóa
                    </button>
                  </div>
                </div>

                {/* Surface Details (Editable) */}
                {isEditing && (
                  <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-700 text-xs">
                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Tên mặt in
                      </label>
                      <input
                        type="text"
                        value={surface.name}
                        onChange={(e) => handleUpdateSurfaceField(idx, "name", e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                        Link ảnh phôi (URL)
                      </label>
                      <input
                        type="url"
                        placeholder="https://cdn.shopify.com/.../mockup.png"
                        value={surface.previewUrl ?? ""}
                        onChange={(e) => handleUpdateSurfaceField(idx, "previewUrl", e.target.value)}
                        className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:border-blue-300 dark:focus:border-blue-800 focus-visible:ring-2 focus-visible:ring-blue-600/30"
                      />
                    </div>

                    {/* Placements Section */}
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-700">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                          Vùng in ({surface.placements?.length ?? 0})
                        </span>
                      </div>

                      <div className="space-y-2">
                        {surface.placements?.map((p, pIdx) => (
                          <div
                            key={p.placementId || pIdx}
                            className="flex items-center justify-between gap-2 rounded-lg bg-white dark:bg-slate-900 p-2.5 border border-slate-200 dark:border-slate-700 text-xs"
                          >
                            <span className="font-medium text-slate-900 dark:text-slate-100">{p.name}</span>
                            <button
                              type="button"
                              onClick={() => handleRemovePlacement(idx, pIdx)}
                              className="text-rose-700 dark:text-rose-300 hover:text-rose-700 dark:hover:text-rose-300 px-1 cursor-pointer"
                              title="Xóa vùng in"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
