import { useRef, useState } from "react";
import type { ReferenceImage } from "../../types";

interface ReferenceDropzoneProps {
  readonly images: readonly ReferenceImage[];
  readonly onChange: (images: readonly ReferenceImage[]) => void;
  readonly maxImages?: number;
  readonly disabled?: boolean;
}

export function ReferenceDropzone({
  images,
  onChange,
  maxImages = 5,
  disabled = false,
}: ReferenceDropzoneProps): React.JSX.Element {
  const [isDragOver, setIsDragOver] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [customUrl, setCustomUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFiles(files: FileList | null): void {
    if (!files || disabled) return;

    const remainingSlots = maxImages - images.length;
    if (remainingSlots <= 0) return;

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
        console.error("Lỗi khi tải ảnh tham chiếu:", err);
      });
  }

  function handleAddUrl(): void {
    const trimmed = customUrl.trim();
    if (!trimmed || images.length >= maxImages) return;

    const newImage: ReferenceImage = {
      id: `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      url: trimmed,
      name: trimmed.split("/").pop() || "Ảnh tham chiếu",
    };

    onChange([...images, newImage]);
    setCustomUrl("");
    setShowUrlInput(false);
  }

  function handleRemove(id: string): void {
    if (disabled) return;
    onChange(images.filter((img) => img.id !== id));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs text-slate-300">
        <label className="font-medium text-slate-200">
          Ảnh phòng tham chiếu ({images.length}/{maxImages} ảnh)
        </label>
        <button
          type="button"
          onClick={() => setShowUrlInput(!showUrlInput)}
          className="text-cyan-400 underline-offset-2 hover:underline"
        >
          {showUrlInput ? "Đóng nhập URL" : "+ Nhập URL ảnh"}
        </button>
      </div>

      {showUrlInput && (
        <div className="flex gap-2">
          <input
            type="url"
            value={customUrl}
            onChange={(e) => setCustomUrl(e.target.value)}
            placeholder="Dán URL ảnh (/mockups/room.jpg hoặc https://...)"
            disabled={disabled || images.length >= maxImages}
            className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100 placeholder-slate-500 focus:border-cyan-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={handleAddUrl}
            disabled={!customUrl.trim() || disabled || images.length >= maxImages}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-cyan-500 disabled:opacity-50"
          >
            Thêm
          </button>
        </div>
      )}

      {/* Dropzone Box */}
      {images.length < maxImages && (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!disabled) setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            handleFiles(e.dataTransfer.files);
          }}
          onClick={() => {
            if (!disabled) fileInputRef.current?.click();
          }}
          className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed p-4 text-center transition ${
            isDragOver
              ? "border-cyan-400 bg-cyan-950/20"
              : "border-slate-700 bg-slate-950/50 hover:border-slate-500 hover:bg-slate-900"
          } ${disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/jpg"
            multiple
            disabled={disabled}
            className="hidden"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <span className="text-2xl transition group-hover:scale-110">📁</span>
          <p className="mt-1 text-xs font-medium text-slate-200">
            Kéo thả ảnh phòng mẫu hoặc <span className="text-cyan-400">click để chọn file</span>
          </p>
          <p className="mt-0.5 text-[10px] text-slate-400">Hỗ trợ JPG, PNG, WEBP (Tối đa {maxImages} ảnh)</p>
        </div>
      )}

      {/* Thumbnails preview */}
      {images.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((img, idx) => (
            <div
              key={img.id}
              className="group relative aspect-square overflow-hidden rounded-lg border border-slate-700 bg-slate-950 shadow"
            >
              <img
                src={img.url}
                alt={img.name ?? `Ảnh phòng ${idx + 1}`}
                className="h-full w-full object-cover"
              />
              <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] font-bold text-white">
                #{idx + 1}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemove(img.id);
                  }}
                  className="absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-rose-600/90 text-[10px] font-bold text-white shadow hover:bg-rose-500"
                  title="Xóa ảnh này"
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
