import { useEffect, useRef, useState } from "react";

import type { AmazonCrawlerProfile, AmazonCrawlerStoreCrawlSettings, AmazonCrawlerStoreCrawlSettingsManager, ImageProcessingProfile } from "../../types";

interface CrawlerStoreSettingsProps {
  storeId: string;
  manager?: AmazonCrawlerStoreCrawlSettingsManager;
  imageProfiles: readonly ImageProcessingProfile[];
  disabled: boolean;
  onReady: (config: AmazonCrawlerStoreCrawlSettings | null) => void;
  onEditImage: (slug: string) => void;
  onCreateImage: () => void;
  onReloadImages: () => void;
}

const fieldClass = "min-w-0 w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm disabled:opacity-50";
const buttonClass = "rounded-lg border border-blue-300 dark:border-blue-800 px-3 py-2 text-sm text-blue-700 dark:text-blue-300 disabled:opacity-50";

export function CrawlerStoreSettings({ storeId, manager, imageProfiles, disabled, onReady, onEditImage, onCreateImage, onReloadImages }: CrawlerStoreSettingsProps): React.JSX.Element {
  const [saved, setSaved] = useState<AmazonCrawlerStoreCrawlSettings | null>(null);
  const [vendor, setVendor] = useState("");
  const [profileSlug, setProfileSlug] = useState<AmazonCrawlerProfile | "">("");
  const [imageSlug, setImageSlug] = useState("");
  const [preset, setPreset] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);

  function populate(config: AmazonCrawlerStoreCrawlSettings): void {
    setVendor(config.vendor ?? "");
    setProfileSlug(config.defaults?.profileSlug ?? "");
    setImageSlug(config.defaults?.imageProfileSlug ?? "");
    setPreset(config.defaults?.applyJeminisePreset ?? false);
  }

  useEffect(() => {
    const requestGeneration = ++generation.current;
    setSaved(null);
    setIsLoading(true);
    setError(null);
    async function load(): Promise<void> {
      try {
        if (!manager) throw new Error("Missing settings service");
        const config = await manager.get(storeId);
        if (generation.current !== requestGeneration) return;
        setSaved(config);
        populate(config);
        setIsEditing(!config.defaults);
      } catch {
        if (generation.current === requestGeneration) setError("Không tải được cấu hình store. Kiểm tra kết nối rồi thử lại.");
      } finally {
        if (generation.current === requestGeneration) setIsLoading(false);
      }
    }
    void load();
    return () => { generation.current++; };
  }, [storeId, manager, reload]);

  const savedImage = imageProfiles.find((profile) => profile.slug === saved?.defaults?.imageProfileSlug);
  const isReady = saved?.storeId === storeId && Boolean(saved.defaults && saved.vendor && savedImage)
    && !isLoading && !isSaving && !isEditing && !error;
  useEffect(() => { onReady(isReady ? saved : null); }, [isReady, saved, onReady]);

  async function save(): Promise<void> {
    if (!manager || !profileSlug || !vendor.trim() || !imageProfiles.some((profile) => profile.slug === imageSlug) || isSaving || disabled) return;
    const requestGeneration = generation.current;
    setIsSaving(true);
    setError(null);
    try {
      const config = await manager.save(storeId, { vendor: vendor.trim(), profileSlug, imageProfileSlug: imageSlug, applyJeminisePreset: preset });
      if (generation.current !== requestGeneration) return;
      setSaved(config);
      populate(config);
      setIsEditing(false);
    } catch {
      if (generation.current === requestGeneration) setError("Không lưu được cấu hình. Kiểm tra Vendor (1–255 ký tự), Profile và kết nối rồi thử lại.");
    } finally {
      if (generation.current === requestGeneration) setIsSaving(false);
    }
  }

  return <section id="crawler-store-settings" aria-label="Cấu hình cào theo store" className="min-w-0 space-y-3 rounded-lg border border-slate-200 dark:border-slate-700 p-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">Cấu hình của {storeId}</h3>
      <div className="flex gap-3 text-xs text-blue-700 dark:text-blue-300">
        {!isEditing && saved ? <button type="button" disabled={disabled || isLoading} onClick={() => { populate(saved); setIsEditing(true); }}>Chỉnh cấu hình</button> : null}
        <button type="button" disabled={disabled || isLoading || isSaving} onClick={() => { setReload((value) => value + 1); onReloadImages(); }}>Tải lại</button>
      </div>
    </div>
    {isLoading ? <p role="status" className="text-sm text-slate-500">Đang tải cấu hình store…</p> : null}
    {error ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{error}</p> : null}
    {!isLoading && !isEditing && saved?.defaults ? <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
        <dt className="text-slate-500">Vendor</dt><dd className="break-words font-medium">{saved.vendor}</dd>
        <dt className="text-slate-500">Profile cào</dt><dd>{saved.defaults.profileSlug}{saved.defaults.applyJeminisePreset ? " · preset variants bật" : ""}</dd>
        <dt className="text-slate-500">Xử lý ảnh</dt><dd>{savedImage ? `${savedImage.name} · ${savedImage.enabled ? "bật" : "tắt"}` : "Profile ảnh không khả dụng — tải lại hoặc chỉnh cấu hình"}</dd>
      </dl>
      {!savedImage ? <p role="alert" className="text-xs text-amber-700 dark:text-amber-300">Chưa thể cào khi không tìm thấy Profile ảnh đã lưu.</p> : null}
    </> : null}
    {!isLoading && isEditing ? <fieldset disabled={disabled || isSaving} className="grid min-w-0 gap-3 sm:grid-cols-2 disabled:opacity-60">
      {!saved?.defaults ? <p className="text-xs text-amber-700 dark:text-amber-300 sm:col-span-2">Thiết lập một lần cho store này trước khi cào.</p> : null}
      <label className="grid min-w-0 gap-1 text-sm sm:col-span-2">Vendor Shopify
        <input id="crawler-store-vendor" maxLength={255} className={fieldClass} value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Tên thương hiệu / nhà cung cấp" />
      </label>
      <label className="grid min-w-0 gap-1 text-sm">Profile cào
        <select aria-label="Profile cào" className={fieldClass} value={profileSlug} onChange={(event) => {
          const value = event.target.value;
          if (value === "default" || value === "jeminise" || value === "preaurem" || value === "") {
            setProfileSlug(value);
            if (value !== "jeminise") setPreset(false);
          }
        }}><option value="">Chọn Profile cào</option><option value="default">Default</option><option value="jeminise">Jeminise</option><option value="preaurem">Preaurem</option></select>
      </label>
      <label className="grid min-w-0 gap-1 text-sm">Xử lý ảnh
        <select aria-label="Profile xử lý ảnh" className={fieldClass} value={imageSlug} onChange={(event) => setImageSlug(event.target.value)}>
          <option value="">Chọn Profile ảnh</option>
          {imageSlug && !imageProfiles.some((profile) => profile.slug === imageSlug) ? <option value={imageSlug}>Không khả dụng: {imageSlug}</option> : null}
          {imageProfiles.map((profile) => <option key={profile.slug} value={profile.slug}>{profile.name} · {profile.enabled ? "bật" : "tắt"}</option>)}
        </select>
      </label>
      {profileSlug === "jeminise" ? <label className="flex items-start gap-2 text-sm sm:col-span-2"><input type="checkbox" checked={preset} onChange={(event) => setPreset(event.target.checked)} />Thay variants bằng preset Jeminise (Bedding 47v / Blanket 8v)</label> : null}
      <div className="flex flex-wrap gap-3 text-xs text-blue-700 dark:text-blue-300 sm:col-span-2">
        <button type="button" disabled={!imageProfiles.some((profile) => profile.slug === imageSlug)} onClick={() => onEditImage(imageSlug)}>Cấu hình ảnh</button>
        <button type="button" onClick={onCreateImage}>Tạo Profile ảnh</button>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="button" className={buttonClass} disabled={!vendor.trim() || !profileSlug || !imageProfiles.some((profile) => profile.slug === imageSlug)} onClick={() => void save()}>{isSaving ? "Đang lưu…" : "Lưu cấu hình store"}</button>
        {saved?.defaults ? <button type="button" className="px-2 py-2 text-sm" onClick={() => { populate(saved); setError(null); setIsEditing(false); }}>Hủy chỉnh sửa</button> : null}
        <p className="text-xs text-slate-500">Chỉ áp dụng cho job mới.</p>
      </div>
    </fieldset> : null}
  </section>;
}
