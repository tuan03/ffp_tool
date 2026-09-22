import { useRef, useState } from "react";
import type { ReferenceImage } from "../../types";

export interface RoomTemplateManagerModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly images: readonly ReferenceImage[];
  readonly onChange: (images: readonly ReferenceImage[]) => void;
  readonly onPreviewImage?: (url: string, title: string) => void;
  readonly maxImages?: number;
}

export function RoomTemplateManagerModal({
  isOpen,
  onClose,
  images,
  onChange,
  onPreviewImage,
  maxImages = 10,
}: RoomTemplateManagerModalProps): React.JSX.Element | null {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  function handleProcessFiles(files: FileList | null): void {
    if (!files || files.length === 0) return;
    setUploadError(null);

    const remainingSlots = maxImages - images.length;
    if (remainingSlots <= 0) {
      setUploadError(`Đã đạt giới hạn tối đa ${maxImages} ảnh phòng mẫu.`);
      return;
    }

    const filesToProcess = Array.from(files).slice(0, remainingSlots);

    Promise.all(
      filesToProcess.map(
        (file) =>
          new Promise<ReferenceImage>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              if (typeof reader.result === "string") {
                resolve({
                  id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                  url: reader.result,
                  name: file.name,
                });
              } else {
                reject(new Error("Không thể đọc file ảnh"));
              }
            };
            reader.onerror = () => reject(reader.error ?? new Error("Lỗi đọc file"));
            reader.readAsDataURL(file);
          }),
      ),
    )
      .then((loadedImages) => {
        if (loadedImages.length > 0) {
          onChange([...images, ...loadedImages]);
        }
      })
      .catch((err) => {
        setUploadError(err instanceof Error ? err.message : "Lỗi khi xử lý file ảnh.");
      });
  }

  function handleAddUrl(): void {
    const trimmed = customUrl.trim();
    if (!trimmed) return;
    if (images.length >= maxImages) {
      setUploadError(`Đã đạt giới hạn tối đa ${maxImages} ảnh.`);
      return;
    }

    const newImage: ReferenceImage = {
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url: trimmed,
      name: trimmed.split("/").pop() || "Ảnh phòng URL",
    };

    onChange([...images, newImage]);
    setCustomUrl("");
    setShowUrlInput(false);
    setUploadError(null);
  }

  function handleRemove(id: string): void {
    onChange(images.filter((img) => img.id !== id));
  }

  function handleClearAll(): void {
    onChange([]);
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl border border-slate-700/80 bg-slate-900 shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/60 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-950 border border-purple-500/40 text-lg shadow-sm">
              🛋️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-slate-100">
                  Quản lý Ảnh Phòng Mẫu (Mockup Reference)
                </h3>
                <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-[11px] font-semibold text-purple-300 border border-purple-500/30">
                  {images.length}/{maxImages} ảnh
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                AI sẽ giữ nguyên các căn phòng này làm bối cảnh và ghép hoa văn các mẫu đã chọn vào đúng vị trí sàn / giường.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition cursor-pointer"
            title="Đóng modal"
          >
            ✕
          </button>
        </div>

        {/* Body Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Error notice if any */}
          {uploadError && (
            <div className="rounded-lg border border-rose-800/80 bg-rose-950/60 p-3 text-xs text-rose-300 flex items-center justify-between">
              <span>⚠️ {uploadError}</span>
              <button
                type="button"
                onClick={() => setUploadError(null)}
                className="text-rose-400 hover:text-white ml-2"
              >
                ✕
              </button>
            </div>
          )}

          {/* Add / Upload Section */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Thêm ảnh phòng mới
              </span>
              <button
                type="button"
                onClick={() => setShowUrlInput(!showUrlInput)}
                className="text-xs text-cyan-400 hover:text-cyan-300 hover:underline cursor-pointer"
              >
                {showUrlInput ? "Đóng nhập URL" : "🔗 Hoặc nhập URL ảnh"}
              </button>
            </div>

            {/* URL Input Form */}
            {showUrlInput && (
              <div className="flex gap-2 p-3 rounded-xl border border-cyan-500/30 bg-cyan-950/20">
                <input
                  type="url"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                  placeholder="https://example.com/room-mockup.jpg"
                  className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-400 focus:outline-none"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddUrl();
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={handleAddUrl}
                  className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 cursor-pointer"
                >
                  Thêm URL
                </button>
              </div>
            )}

            {/* Drag & Drop File Upload Box */}
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragOver(true);
              }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragOver(false);
                handleProcessFiles(e.dataTransfer.files);
              }}
              onClick={() => fileInputRef.current?.click()}
              className={`flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition cursor-pointer ${
                isDragOver
                  ? "border-purple-400 bg-purple-950/40"
                  : "border-slate-700 hover:border-purple-500/60 bg-slate-950/40 hover:bg-slate-950/70"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/png,image/jpeg,image/webp,image/jpg"
                className="hidden"
                onChange={(e) => handleProcessFiles(e.target.files)}
              />
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-purple-900/50 text-purple-300 text-lg">
                📤
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-200">
                  Kéo thả ảnh phòng vào đây, hoặc <span className="text-purple-400 hover:underline">bấm để chọn từ máy tính</span>
                </p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Hỗ trợ tải nhiều file ảnh cùng lúc (PNG, JPG, WEBP). Khuyên dùng ảnh chụp phòng khách, phòng ngủ hoặc bảng Size Chart.
                </p>
              </div>
            </div>
          </div>

          {/* Current Images Gallery */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
                Danh sách phòng mẫu hiện tại ({images.length})
              </span>
              {images.length > 0 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="text-xs text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                >
                  Xóa tất cả ({images.length})
                </button>
              )}
            </div>

            {images.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-800 bg-slate-950/30 p-8 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-950/50 text-purple-400 text-2xl mb-2">
                  🛋️
                </div>
                <p className="text-xs font-medium text-slate-300">
                  Chưa có ảnh phòng mẫu riêng nào
                </p>
                <p className="text-[11px] text-slate-500 mt-1 max-w-md mx-auto">
                  Khi danh sách trống, AI sẽ tự động sinh ngẫu nhiên các bối cảnh phòng decor. Hãy tải ảnh lên ở trên hoặc bấm nút &ldquo;Làm phòng&rdquo; trên thẻ ảnh Pinterest để chỉ định bối cảnh cố định!
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3.5">
                {images.map((img, idx) => (
                  <div
                    key={img.id}
                    className="group relative flex flex-col overflow-hidden rounded-xl border border-slate-700/80 bg-slate-950 shadow-md transition hover:border-purple-500/60"
                  >
                    {/* Image Preview Container */}
                    <div className="relative aspect-4/3 w-full overflow-hidden bg-slate-900">
                      <img
                        src={img.url}
                        alt={img.name || `Phòng ${idx + 1}`}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />

                      {/* Number Badge */}
                      <span className="absolute top-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[10px] font-bold text-purple-300 backdrop-blur-xs">
                        #{idx + 1}
                      </span>

                      {/* Delete Button Overlay */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemove(img.id);
                        }}
                        className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-md bg-rose-600/80 hover:bg-rose-600 text-white text-xs backdrop-blur-xs transition shadow cursor-pointer opacity-80 hover:opacity-100"
                        title="Gỡ ảnh phòng này"
                      >
                        ✕
                      </button>

                      {/* Zoom Preview Button */}
                      {onPreviewImage && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onPreviewImage(img.url, img.name || `Phòng Mẫu #${idx + 1}`);
                          }}
                          className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-black/70 hover:bg-black/90 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-xs transition cursor-pointer"
                          title="Soi phóng to HD"
                        >
                          <span>🔍</span>
                          <span>Soi</span>
                        </button>
                      )}
                    </div>

                    {/* Meta info */}
                    <div className="p-2 border-t border-slate-800 bg-slate-900/60">
                      <p
                        className="truncate text-[11px] font-medium text-slate-300"
                        title={img.name || `Phòng Mẫu #${idx + 1}`}
                      >
                        {img.name || `Phòng Mẫu #${idx + 1}`}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between border-t border-slate-800 bg-slate-950/70 px-6 py-3.5">
          <span className="text-xs text-slate-400">
            {images.length > 0
              ? `Đang có ${images.length} phòng mẫu sẵn sàng cho đợt sản xuất.`
              : "Hệ thống sẽ tự động vẽ ngẫu nhiên bối cảnh phòng."}
          </span>

          <button
            type="button"
            onClick={onClose}
            className="rounded-xl bg-purple-600 hover:bg-purple-500 px-5 py-2 text-xs font-bold text-white shadow-md shadow-purple-600/30 transition cursor-pointer"
          >
            Hoàn tất &amp; Lưu
          </button>
        </div>
      </div>
    </div>
  );
}
