import React, { useState } from "react";

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

  const handleAddSurface = () => {
    const newId = `surface_${Date.now()}`;
    const newSurface: SurfaceItem = {
      name: `Surface ${surfaces.length + 1}`,
      surfaceId: newId,
      previewUrl: "",
      fileId: "",
      placements: [
        {
          name: "Main Area",
          placementId: `placement_${Date.now()}`,
          allowedTypes: ["text", "image"],
        },
      ],
    };
    onChange([...surfaces, newSurface]);
    setEditingIndex(surfaces.length);
  };

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

  const handleAddPlacement = (surfaceIndex: number) => {
    const surface = surfaces[surfaceIndex];
    const newPlacement: PlacementItem = {
      name: `Placement ${(surface.placements?.length ?? 0) + 1}`,
      placementId: `place_${Date.now()}`,
      allowedTypes: ["text", "image"],
    };
    const updatedPlacements = [...(surface.placements ?? []), newPlacement];
    handleUpdateSurfaceField(surfaceIndex, "placements", updatedPlacements);
  };

  const handleRemovePlacement = (surfaceIndex: number, placementIndex: number) => {
    const surface = surfaces[surfaceIndex];
    const updatedPlacements = (surface.placements ?? []).filter((_, i) => i !== placementIndex);
    handleUpdateSurfaceField(surfaceIndex, "placements", updatedPlacements);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-200">
            Mặt In & Phôi Thiết Kế (Surfaces & Mockups)
          </h3>
          <p className="text-xs text-slate-400">
            Quản lý các mặt hiển thị của sản phẩm (Front, Back, Side...) cùng phôi mockup và vùng thiết kế (Placements).
          </p>
        </div>
        <button
          type="button"
          onClick={handleAddSurface}
          className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-cyan-500 transition"
        >
          <span className="text-base leading-none">+</span> Thêm Mặt In
        </button>
      </div>

      {surfaces.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-800 p-8 text-center bg-slate-900/30">
          <p className="text-xs text-slate-400 mb-3">Chưa có mặt in nào được cấu hình cho sản phẩm này.</p>
          <button
            type="button"
            onClick={handleAddSurface}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-medium text-cyan-400 hover:bg-slate-700 transition"
          >
            + Tạo Mặt In Đầu Tiên
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {surfaces.map((surface, idx) => {
            const isEditing = editingIndex === idx;
            return (
              <div
                key={surface.surfaceId || idx}
                className={`rounded-xl border p-4 transition-all ${
                  isEditing
                    ? "border-cyan-500/80 bg-slate-900/90 shadow-md shadow-cyan-950/20"
                    : "border-slate-800 bg-slate-900/50 hover:border-slate-700"
                }`}
              >
                {/* Surface Header */}
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="flex items-center gap-2.5">
                    {surface.previewUrl ? (
                      <img
                        src={surface.previewUrl}
                        alt={surface.name}
                        className="h-10 w-10 rounded-lg border border-slate-700 bg-slate-950 object-cover"
                        onError={(e) => {
                          (e.target as HTMLElement).style.display = "none";
                        }}
                      />
                    ) : (
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-slate-800 bg-slate-950 text-slate-500 text-xs">
                        🖼️
                      </div>
                    )}
                    <div>
                      <h4 className="text-xs font-semibold text-slate-200">
                        {surface.name || "Chưa đặt tên"}
                      </h4>
                      <span className="text-[10px] font-mono text-slate-500">
                        ID: {surface.surfaceId}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => setEditingIndex(isEditing ? null : idx)}
                      className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-[11px] font-medium text-slate-300 hover:bg-slate-700 transition"
                    >
                      {isEditing ? "Thu gọn" : "Chỉnh sửa"}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveSurface(idx)}
                      className="rounded-md border border-rose-900/40 bg-rose-950/30 px-2.5 py-1 text-[11px] font-medium text-rose-300 hover:bg-rose-900/50 transition"
                      title="Xóa mặt in"
                    >
                      Xóa
                    </button>
                  </div>
                </div>

                {/* Surface Details (Editable or Compact) */}
                {isEditing ? (
                  <div className="space-y-3 pt-2 border-t border-slate-800 text-xs">
                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Tên Mặt In (Surface Name)
                      </label>
                      <input
                        type="text"
                        value={surface.name}
                        onChange={(e) => handleUpdateSurfaceField(idx, "name", e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Surface ID
                      </label>
                      <input
                        type="text"
                        value={surface.surfaceId}
                        onChange={(e) => handleUpdateSurfaceField(idx, "surfaceId", e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Mockup Preview URL (Shopify CDN hoặc liên kết ảnh phôi)
                      </label>
                      <input
                        type="url"
                        placeholder="https://cdn.shopify.com/s/files/.../mockup.png"
                        value={surface.previewUrl ?? ""}
                        onChange={(e) => handleUpdateSurfaceField(idx, "previewUrl", e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs text-slate-100 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-medium text-slate-400 mb-1">
                        Shopify MediaImage File ID (Phục vụ dọn rác tự động)
                      </label>
                      <input
                        type="text"
                        placeholder="gid://shopify/MediaImage/..."
                        value={surface.fileId ?? ""}
                        onChange={(e) => handleUpdateSurfaceField(idx, "fileId", e.target.value)}
                        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1.5 text-xs font-mono text-slate-300 focus:border-cyan-500 focus:outline-none"
                      />
                    </div>

                    {/* Placements Section */}
                    <div className="mt-3 pt-3 border-t border-slate-800">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-semibold text-slate-300">
                          Vùng In (Placements: {surface.placements?.length ?? 0})
                        </span>
                        <button
                          type="button"
                          onClick={() => handleAddPlacement(idx)}
                          className="text-[11px] text-cyan-400 hover:text-cyan-300"
                        >
                          + Thêm vùng in
                        </button>
                      </div>

                      <div className="space-y-2">
                        {surface.placements?.map((p, pIdx) => (
                          <div
                            key={p.placementId || pIdx}
                            className="flex items-center justify-between gap-2 rounded-md bg-slate-950/80 p-2 border border-slate-800 text-[11px]"
                          >
                            <div className="flex-1">
                              <span className="font-medium text-slate-200">{p.name}</span>
                              <span className="ml-2 font-mono text-[10px] text-slate-500">
                                ({p.placementId})
                              </span>
                              <div className="mt-0.5 flex gap-1">
                                {p.allowedTypes.map((t) => (
                                  <span
                                    key={t}
                                    className="rounded bg-slate-800 px-1 py-0.2 text-[9px] text-slate-400"
                                  >
                                    {t}
                                  </span>
                                ))}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleRemovePlacement(idx, pIdx)}
                              className="text-rose-400 hover:text-rose-300 px-1"
                              title="Xóa vùng in"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="text-[11px] text-slate-400">
                    <div className="flex justify-between py-0.5">
                      <span>Vùng in (Placements):</span>
                      <span className="text-slate-200 font-medium">
                        {surface.placements?.length ?? 0} vùng
                      </span>
                    </div>
                    {surface.fileId && (
                      <div className="flex justify-between py-0.5">
                        <span>File ID:</span>
                        <span className="font-mono text-slate-300 truncate max-w-[200px]">
                          {surface.fileId}
                        </span>
                      </div>
                    )}
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
