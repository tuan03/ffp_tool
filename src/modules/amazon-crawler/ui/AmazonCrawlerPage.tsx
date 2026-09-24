import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { notifyUser } from "../../../shared/utils";

import {
  type AmazonCrawlerCacheClearer,
  type AmazonCrawlerClientSummary,
  type AmazonCrawlerClientsLoader,
  type AmazonCrawlerHandoverHandler,
  type AmazonCrawlerOutput,
  type AmazonCrawlerProgress,
  type AmazonCrawlerRunner,
  type AmazonCrawlerSettings,
  type AmazonCrawlerJobLoader,
  type AmazonCrawlerJobSummary,
  type AmazonCrawlerSyncRetrier,
  type ImageProcessingProfile,
  type ImageProcessingProfileManager,
} from "../types";

import {
  abortCrawlerJob,
  hydrateCrawlerSessionFromJob,
  resetCrawlerOutput,
  selectCrawlerProduct,
  setCrawlerActiveTab,
  setCrawlerSelectedMediaUrl,
  setCrawlerUrlText,
  startCrawlerJob,
  toggleCrawlerAdvancedOpen,
  toggleCrawlerBatchJsonOpen,
  updateCrawlerSession,
  updateCrawlerSetting,
  useAmazonCrawlerSession,
} from "./crawler-session";
import { firstProductMediaUrl, resolveSelectedProduct } from "./product-selection";
import { formatPipelineTimings } from "./pipeline-timings";

interface AmazonCrawlerPageProps {
  clearAmazonCrawlerCache: AmazonCrawlerCacheClearer;
  loadAmazonCrawlerClients: AmazonCrawlerClientsLoader;
  runAmazonCrawler: AmazonCrawlerRunner;
  loadAmazonCrawlerJob?: AmazonCrawlerJobLoader;
  onHandoverToSeo?: AmazonCrawlerHandoverHandler;
  retryAmazonCrawlerSyncs?: AmazonCrawlerSyncRetrier;
  imageProcessingProfiles?: ImageProcessingProfileManager;
}

const COMMON_PRODUCT_TYPES = [
  { label: "Rug (Thảm trải sàn)", value: "Rug" },
  { label: "Blanket (Chăn lông / Fleece Blanket)", value: "Blanket" },
  { label: "Quilt (Chăn chần bông)", value: "Quilt" },
  { label: "Comforter (Bộ chăn ga)", value: "Comforter" },
  { label: "Pillow (Gối / Vỏ gối)", value: "Pillow" },
  { label: "Doormat (Thảm cửa)", value: "Doormat" },
  { label: "Canvas (Tranh Canvas)", value: "Canvas" },
  { label: "T-Shirt (Áo thun)", value: "T-Shirt" },
  { label: "Hoodie (Áo nỉ có mũ)", value: "Hoodie" },
  { label: "Tumbler (Ly giữ nhiệt)", value: "Tumbler" },
  { label: "Ornament (Đồ trang trí)", value: "Ornament" },
  { label: "Sign (Biển hiệu)", value: "Sign" },
];

const QUICK_PRODUCT_TYPE_PILLS = [
  "Rug",
  "Blanket",
  "Quilt",
  "Comforter",
  "Pillow",
  "Doormat",
  "Canvas",
  "T-Shirt",
];
function NumberSetting({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-sm text-slate-300">
      {label}
      <input
        className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
        max={max}
        min={min}
        type="number"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

function moneyLabel(raw: string | undefined, amount: number | undefined): string {
  if (raw) return raw;
  if (amount !== undefined) return `$${amount.toFixed(2)}`;
  return "—";
}

function optionLabel(options: Record<string, string>): string {
  const pairs = Object.entries(options);
  if (pairs.length === 0) return "Default";
  return pairs.map(([key, val]) => `${key}: ${val}`).join(" · ");
}

function progressPhaseLabel(phase: AmazonCrawlerProgress["phase"]): string {
  const labels: Record<AmazonCrawlerProgress["phase"], string> = {
    queued: "Chờ xử lý",
    product: "Sản phẩm / variant",
    variant_matrix: "Quét variant matrix",
    customization: "Amazon Customize",
    normalization: "Chuẩn hóa",
    seo: "Tạo nội dung SEO",
    image_processing: "Xử lý và tải ảnh",
    shopify: "Đẩy Shopify",
    captcha: "Chờ CAPTCHA",
    export: "Xuất JSON",
  };
  return labels[phase];
}

export function AmazonCrawlerPage({
  clearAmazonCrawlerCache,
  imageProcessingProfiles,
  loadAmazonCrawlerClients,
  loadAmazonCrawlerJob,
  onHandoverToSeo,
  retryAmazonCrawlerSyncs,
  runAmazonCrawler,
}: AmazonCrawlerPageProps): React.JSX.Element {
  const navigate = useNavigate();
  const session = useAmazonCrawlerSession();
  const {
    urlText,
    settings,
    isAdvancedOpen,
    isRunning,
    progress,
    output,
    liveProducts,
    lastJobId,
    error,
    activeTab,
    selectedProductId,
    selectedMediaUrl,
    isBatchJsonOpen,
  } = session;
  const [isRetryingSync, setIsRetryingSync] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [isClearingCache, setIsClearingCache] = useState(false);
  const [cacheMessage, setCacheMessage] = useState<string | null>(null);
  const [isHandingOver, setIsHandingOver] = useState(false);
  const [handoverError, setHandoverError] = useState<string | null>(null);
  const [isHydratingJob, setIsHydratingJob] = useState(false);
  const [recentJobs, setRecentJobs] = useState<AmazonCrawlerJobSummary[]>([]);
  const [hydrateMessage, setHydrateMessage] = useState<string | null>(null);
  const [clients, setClients] = useState<AmazonCrawlerClientSummary[]>([]);
  const [clientError, setClientError] = useState<string | null>(null);
  const [isLoadingClients, setIsLoadingClients] = useState(true);
  const [imageProfiles, setImageProfiles] = useState<ImageProcessingProfile[]>([]);
  const [editingImageProfile, setEditingImageProfile] = useState<ImageProcessingProfile | null>(null);
  const [isImageProfileEditorOpen, setIsImageProfileEditorOpen] = useState(false);
  const [imageProfileMessage, setImageProfileMessage] = useState<string | null>(null);
  const [imageProfilePreview, setImageProfilePreview] = useState<string | null>(null);
  const [availableStores, setAvailableStores] = useState<Array<{ storeId: string; shopDomain: string }>>([
    { storeId: "capozen", shopDomain: "capozen.myshopify.com" },
    { storeId: "jeminise", shopDomain: "b6-theme-test.myshopify.com" },
  ]);
  const [availableCollections, setAvailableCollections] = useState<Array<{ id: string; title: string; productsCount?: number }>>([]);
  const [isLoadingCollections, setIsLoadingCollections] = useState(false);
  const [isCollectionListOpen, setIsCollectionListOpen] = useState(false);

  const urls = useMemo(
    () => urlText.split(/\r?\n/).map((url) => url.trim()).filter(Boolean),
    [urlText],
  );
  const resultProducts = output?.products ?? liveProducts;
  const selectedProduct = useMemo(
    () => resolveSelectedProduct(resultProducts, selectedProductId),
    [resultProducts, selectedProductId],
  );
  const activeMediaUrl = selectedMediaUrl ?? firstProductMediaUrl(selectedProduct);
  const selectedPipelineTimings = formatPipelineTimings(selectedProduct?.pipeline?.shopify.timings);

  useEffect(() => {
    if (selectedProductId && resultProducts.some((product) => product.id === selectedProductId)) return;
    const firstProduct = resultProducts[0] ?? null;
    if (firstProduct) {
      updateCrawlerSession({
        selectedProductId: firstProduct.id,
        selectedMediaUrl: firstProductMediaUrl(firstProduct),
      });
    }
  }, [resultProducts, selectedProductId]);

  useEffect(() => {
    let isMounted = true;
    async function refreshClients(): Promise<void> {
      try {
        const nextClients = await loadAmazonCrawlerClients();
        if (!isMounted) return;
        setClients(nextClients);
        setClientError(null);
      } catch (caught: unknown) {
        if (!isMounted) return;
        setClients([]);
        setClientError(caught instanceof Error ? caught.message : "Không tải được danh sách client.");
      } finally {
        if (isMounted) setIsLoadingClients(false);
      }
    }
    void refreshClients();
    const intervalId = window.setInterval(() => void refreshClients(), 5_000);
    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [loadAmazonCrawlerClients]);

  // 1. Fetch recent jobs list from coordinator
  useEffect(() => {
    if (!loadAmazonCrawlerJob) return;
    let isMounted = true;
    void loadAmazonCrawlerJob.listRecentJobs(10).then((jobs) => {
      if (isMounted) setRecentJobs(jobs);
    }).catch(() => {
      // ignore
    });
    return () => {
      isMounted = false;
    };
  }, [loadAmazonCrawlerJob]);

  // 2. Auto-hydrate on mount if currently no products (e.g. F5 or page reload)
  useEffect(() => {
    if (!loadAmazonCrawlerJob) return;
    if (resultProducts.length > 0) return; // already restored from localStorage/session

    let isMounted = true;
    setIsHydratingJob(true);
    setHydrateMessage("Đang kiểm tra và khôi phục phiên cào gần nhất từ Coordinator...");

    void loadAmazonCrawlerJob.loadJob(lastJobId ?? undefined).then((hydrated) => {
      if (!isMounted) return;
      setIsHydratingJob(false);
      if (hydrated && hydrated.products.length > 0) {
        hydrateCrawlerSessionFromJob(hydrated);
        setHydrateMessage(`Đã khôi phục thành công ${hydrated.products.length} sản phẩm.`);
        setTimeout(() => setHydrateMessage(null), 3000);
      } else {
        setHydrateMessage(null);
      }
    }).catch(() => {
      if (isMounted) {
        setIsHydratingJob(false);
        setHydrateMessage(null);
      }
    });

    return () => {
      isMounted = false;
    };
  }, [loadAmazonCrawlerJob]);

  // 3. Auto-reconnect if a job is currently running on coordinator (e.g. reload during active crawl)
  useEffect(() => {
    if (!loadAmazonCrawlerJob || !isRunning || !lastJobId) return;

    let isMounted = true;
    const intervalId = window.setInterval(async () => {
      try {
        const job = await loadAmazonCrawlerJob.loadJob(lastJobId);
        if (!isMounted || !job) return;

        hydrateCrawlerSessionFromJob(job);

        if (job.status === "completed" || job.status === "partial" || job.status === "failed" || job.status === "cancelled") {
          window.clearInterval(intervalId);
        }
      } catch {
        // ignore polling error
      }
    }, 2000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, [loadAmazonCrawlerJob, isRunning, lastJobId]);

  async function handleSelectRecentJob(targetJobId: string): Promise<void> {
    if (!loadAmazonCrawlerJob || !targetJobId) return;
    setIsHydratingJob(true);
    setHydrateMessage(`Đang tải dữ liệu phiên cào ${targetJobId.slice(0, 8)}...`);
    try {
      const job = await loadAmazonCrawlerJob.loadJob(targetJobId);
      if (job) {
        hydrateCrawlerSessionFromJob(job);
        setHydrateMessage(`Đã nạp ${job.products.length} sản phẩm từ phiên cào.`);
        setTimeout(() => setHydrateMessage(null), 3000);
      }
    } catch {
      setHydrateMessage("Không thể tải phiên cào.");
    } finally {
      setIsHydratingJob(false);
    }
  }

  useEffect(() => {
    if (!imageProcessingProfiles) return;
    let isMounted = true;
    void imageProcessingProfiles.list().then((profiles) => {
      if (!isMounted) return;
      setImageProfiles(profiles);
      const selected = profiles.find((profile) => profile.slug === settings.imageProfileSlug) ?? profiles[0];
      if (selected) {
        updateCrawlerSetting("imageProfileSlug", selected.slug);
        setEditingImageProfile(selected);
      }
    }).catch((caught: unknown) => {
      if (isMounted) setImageProfileMessage(caught instanceof Error ? caught.message : "Không tải được image profiles.");
    });
    return () => { isMounted = false; };
  }, [imageProcessingProfiles]);

  async function refreshImageProfiles(selectedSlug?: string): Promise<void> {
    if (!imageProcessingProfiles) return;
    const profiles = await imageProcessingProfiles.list();
    setImageProfiles(profiles);
    const selected = profiles.find((profile) => profile.slug === (selectedSlug ?? settings.imageProfileSlug)) ?? profiles[0] ?? null;
    setEditingImageProfile(selected);
    if (selected) updateSetting("imageProfileSlug", selected.slug);
  }

  async function handleSaveImageProfile(): Promise<void> {
    if (!imageProcessingProfiles || !editingImageProfile) return;
    try {
      const saved = await imageProcessingProfiles.save(editingImageProfile.slug, editingImageProfile);
      await refreshImageProfiles(saved.slug);
      setImageProfileMessage(`Đã lưu image profile ${saved.name}.`);
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không lưu được image profile.");
    }
  }

  async function handleCreateImageProfile(): Promise<void> {
    const template = imageProfiles.find((profile) => profile.slug === settings.imageProfileSlug) ?? imageProfiles[0];
    if (!template) return;
    const slug = `image-profile-${Date.now()}`;
    setEditingImageProfile({ ...template, slug, name: "New image profile", revision: "new", hasLogo: false });
    setIsImageProfileEditorOpen(true);
  }

  async function handleDeleteImageProfile(): Promise<void> {
    if (!imageProcessingProfiles || !editingImageProfile || editingImageProfile.slug === "default") return;
    try {
      await imageProcessingProfiles.delete(editingImageProfile.slug);
      await refreshImageProfiles("default");
      setImageProfileMessage("Đã xóa image profile.");
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không xóa được image profile.");
    }
  }

  async function handleImageProfileLogo(file: File | undefined): Promise<void> {
    if (!file || !imageProcessingProfiles || !editingImageProfile) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error ?? new Error("Không đọc được logo.")), { once: true });
      reader.readAsDataURL(file);
    });
    try {
      const isUnsaved = !imageProfiles.some((profile) => profile.slug === editingImageProfile.slug);
      const profile = isUnsaved
        ? await imageProcessingProfiles.save(editingImageProfile.slug, editingImageProfile)
        : editingImageProfile;
      const saved = await imageProcessingProfiles.uploadLogo(profile.slug, dataUrl);
      await refreshImageProfiles(saved.slug);
      setImageProfileMessage("Đã tải logo lên profile.");
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không tải được logo.");
    }
  }

  async function handleImageProfilePreview(file: File | undefined): Promise<void> {
    if (!file || !imageProcessingProfiles || !editingImageProfile) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result || "")), { once: true });
      reader.addEventListener("error", () => reject(reader.error ?? new Error("Không đọc được ảnh preview.")), { once: true });
      reader.readAsDataURL(file);
    });
    try {
      setImageProfilePreview(await imageProcessingProfiles.preview(editingImageProfile.slug, editingImageProfile, dataUrl));
      setImageProfileMessage("Preview dùng chính cấu hình hiện tại, chưa cần bấm lưu.");
    } catch (caught: unknown) {
      setImageProfileMessage(caught instanceof Error ? caught.message : "Không tạo được preview.");
    }
  }

  useEffect(() => {
    let isMounted = true;
    async function loadStores(): Promise<void> {
      try {
        const response = await fetch("/api/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ operation: "stores.list", payload: {} }),
        });
        const result = await response.json();
        if (isMounted && result.success && Array.isArray(result.data?.stores) && result.data.stores.length > 0) {
          const fetched = (result.data.stores as Array<{ storeId: string; shopDomain: string }>).map((s) => ({
            storeId: s.storeId,
            shopDomain: s.shopDomain,
          }));
          setAvailableStores(fetched);
        }
      } catch {
        // Keep fallback stores
      }
    }
    void loadStores();
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    const targetStore = settings.storeId || "capozen";
    async function loadCollections(): Promise<void> {
      setIsLoadingCollections(true);
      try {
        const response = await fetch("/api/shopify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            storeId: targetStore,
            operation: "collections.list",
            payload: { limit: 100 },
          }),
        });
        const result = await response.json();
        if (isMounted) {
          if (result.success && Array.isArray(result.data?.collections)) {
            setAvailableCollections(result.data.collections as Array<{ id: string; title: string; productsCount?: number }>);
          } else {
            setAvailableCollections([]);
          }
        }
      } catch {
        if (isMounted) setAvailableCollections([]);
      } finally {
        if (isMounted) setIsLoadingCollections(false);
      }
    }
    void loadCollections();
    return () => {
      isMounted = false;
    };
  }, [settings.storeId]);

  function handleSelectProduct(productId: string): void {
    selectCrawlerProduct(productId);
  }

  function updateSetting<K extends keyof AmazonCrawlerSettings>(key: K, value: AmazonCrawlerSettings[K]): void {
    updateCrawlerSetting(key, value);
  }

  const activeCollectionIds = useMemo(() => {
    const fromArray = Array.isArray(settings.collectionIds) ? settings.collectionIds : [];
    if (fromArray.length > 0) return fromArray;
    return settings.collectionId ? [settings.collectionId] : [];
  }, [settings.collectionIds, settings.collectionId]);

  const selectedCollections = useMemo(() => {
    return availableCollections.filter((c) => activeCollectionIds.includes(c.id));
  }, [availableCollections, activeCollectionIds]);

  function toggleCollection(colId: string): void {
    const current = new Set(activeCollectionIds);
    if (current.has(colId)) {
      current.delete(colId);
    } else {
      current.add(colId);
    }
    const nextList = Array.from(current);
    updateCrawlerSession({
      settings: { ...settings, collectionIds: nextList, collectionId: nextList[0] || "" },
    });
  }

  function handleSelectAllCollections(): void {
    const allIds = availableCollections.map((c) => c.id);
    updateCrawlerSession({
      settings: { ...settings, collectionIds: allIds, collectionId: allIds[0] || "" },
    });
  }

  function handleClearCollections(): void {
    updateCrawlerSession({
      settings: { ...settings, collectionIds: [], collectionId: "" },
    });
  }

  async function handleStart(): Promise<void> {
    setSyncMessage(null);
    await startCrawlerJob({ runAmazonCrawler, urls, settings });
  }

  function handleStop(): void {
    abortCrawlerJob();
  }

  async function handleRetrySyncs(): Promise<void> {
    if (!output || isRetryingSync || !retryAmazonCrawlerSyncs) return;
    setIsRetryingSync(true);
    setSyncMessage(null);
    try {
      const retried = await retryAmazonCrawlerSyncs(output.jobId, {
        onProgress: (nextProgress) => updateCrawlerSession({ progress: nextProgress }),
        onProducts: (products) => updateCrawlerSession({ liveProducts: [...products] }),
      });
      if (retried.output) {
        updateCrawlerSession({
          output: retried.output,
          liveProducts: [...retried.output.products],
        });
      }
      setSyncMessage(`Đã đưa ${retried.retried} product lỗi trở lại hàng đợi Shopify.`);
      notifyUser({
        title: "🛍️ Shopify Sync Retry hoàn tất",
        message: `Đã đưa ${retried.retried} sản phẩm lỗi trở lại hàng đợi Shopify.`,
        type: "info",
        sound: "chime",
        url: "/amazon-crawler",
      });
    } catch (caught: unknown) {
      const errorMsg = caught instanceof Error ? caught.message : "Không thể retry Shopify sync.";
      setSyncMessage(errorMsg);
      notifyUser({
        title: "❌ Shopify Sync Retry thất bại",
        message: errorMsg,
        type: "error",
        sound: "alert",
        url: "/amazon-crawler",
      });
    } finally {
      setIsRetryingSync(false);
    }
  }

  function handleDownload(): void {
    if (output === null) return;
    const blob = new Blob([JSON.stringify(output, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = output.exportFilename ?? `amazon-crawl-${output.jobId}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function handleClearCache(): Promise<void> {
    if (isRunning || isClearingCache || !window.confirm("Xóa toàn bộ Amazon family cache? Các lần crawl sau sẽ tải lại dữ liệu từ Amazon.")) return;
    setIsClearingCache(true);
    setCacheMessage(null);
    try {
      const result = await clearAmazonCrawlerCache();
      const megabytes = result.removedBytes / (1024 * 1024);
      setCacheMessage(`Đã xóa ${result.removedFiles} cache file (${megabytes.toFixed(2)} MB).`);
    } catch (caught: unknown) {
      setCacheMessage(caught instanceof Error ? `Không thể xóa cache: ${caught.message}` : "Không thể xóa cache.");
    } finally {
      setIsClearingCache(false);
    }
  }

  async function handleHandover(): Promise<void> {
    if (!onHandoverToSeo || resultProducts.length === 0 || isHandingOver) return;
    setIsHandingOver(true);
    setHandoverError(null);
    try {
      await onHandoverToSeo(resultProducts);
      notifyUser({
        title: "📦 Bàn giao sang SEO Review",
        message: `Đã bàn giao ${resultProducts.length} sản phẩm sang bộ phận SEO Review thành công!`,
        type: "success",
        sound: "chime",
        url: "/seo-review",
      });
      navigate("/seo-review");
    } catch (caught: unknown) {
      const msg = caught instanceof Error ? caught.message : String(caught);
      setHandoverError(`Lỗi khi bàn giao sang SEO Review: ${msg}`);
      notifyUser({
        title: "❌ Bàn giao SEO thất bại",
        message: msg,
        type: "error",
        sound: "alert",
        url: "/amazon-crawler",
      });
    } finally {
      setIsHandingOver(false);
    }
  }

  return (
    <div className="mt-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Amazon Crawler</h1>
        <p className="mt-2 text-sm text-slate-400">Cào Amazon family, tách product và xử lý Customize — không rewrite dữ liệu.</p>
      </div>

      <section className="rounded-xl border border-slate-700 bg-slate-950/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold text-slate-100">Crawler clients</h2>
            <p className="text-xs text-slate-400">Tự cập nhật mỗi 5 giây · job chỉ được tạo khi có ít nhất một client online.</p>
          </div>
          <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-200">
            {clients.filter((client) => client.isConnected && ["online", "busy", "waiting_captcha"].includes(client.status)).length} online / {clients.length}
          </span>
        </div>
        {isLoadingClients ? <p className="mt-3 text-sm text-slate-400">Đang kiểm tra client...</p> : null}
        {clientError ? <p className="mt-3 text-sm text-rose-300">{clientError}</p> : null}
        {!isLoadingClients && !clientError && clients.length === 0 ? <p className="mt-3 text-sm text-amber-300">Chưa có client. Hãy mở FFP Amazon Crawler Agent.</p> : null}
        {clients.length > 0 ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {clients.map((client) => (
              <article className="rounded-lg border border-slate-700 bg-slate-900/70 p-3" key={client.id}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="truncate text-sm" title={client.displayName}>{client.displayName}</strong>
                  <span className={`text-xs font-semibold ${!client.isConnected || client.status === "offline" ? "text-rose-300" : client.status === "waiting_captcha" ? "text-amber-300" : "text-emerald-300"}`}>{client.isConnected ? client.status : "offline"}</span>
                </div>
                <p className="mt-1 text-xs text-slate-400">{client.activeTasks} đang chạy · {client.availableSlots}/{client.maxConcurrentInputs} slot trống</p>
                {client.leasedTasks === client.activeTasks ? null : <p className="mt-1 text-xs text-amber-300">{client.leasedTasks} lease trên server đang chờ đồng bộ</p>}
              </article>
            ))}
          </div>
        ) : null}
      </section>

      <label className="grid gap-2 text-sm font-medium text-slate-200">
        Amazon URLs hoặc ASIN, mỗi dòng một giá trị
        <textarea
          className="min-h-40 rounded-xl border border-slate-700 bg-slate-950 p-3 font-mono text-sm text-slate-100 outline-none focus:border-cyan-400"
          placeholder={"https://www.amazon.com/dp/B0...\nB0..."}
          value={urlText}
          onChange={(event) => setCrawlerUrlText(event.target.value)}
        />
      </label>

      {/* Cấu hình Đồng bộ Shopify, Phân loại & Định giá */}
      <section className="rounded-2xl border border-slate-700/80 bg-slate-950/70 p-5 sm:p-6 shadow-xl space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3.5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/20 text-emerald-400 text-xs font-bold border border-emerald-500/30">
                ⚡
              </span>
              <h2 className="text-base font-bold text-slate-100 tracking-tight">
                Cấu hình Shopify Store, Phân loại &amp; Định giá
              </h2>
              <span className="rounded-full bg-cyan-500/10 px-2 py-0.5 text-[11px] font-medium text-cyan-400 border border-cyan-500/20">
                Áp dụng toàn bộ batch
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Chọn store đồng bộ, collection, loại sản phẩm (Product Type) và công thức giá bán áp dụng đồng loạt cho mọi sản phẩm trong link cào.
            </p>
          </div>
          {settings.storeId && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-cyan-950 px-2.5 py-1 text-xs font-mono text-cyan-300 border border-cyan-800">
                🏬 Store: {settings.storeId}
              </span>
              <span className="rounded-md bg-purple-950 px-2.5 py-1 text-xs font-mono text-purple-300 border border-purple-800">
                🏷️ Vendor: {(settings.storeId.split("--")[0] || settings.storeId).trim().toUpperCase()}
              </span>
              {settings.productType && (
                <span className="rounded-md bg-emerald-950 px-2.5 py-1 text-xs font-mono text-emerald-300 border border-emerald-800">
                  📦 Type: {settings.productType}
                </span>
              )}
              {selectedCollections.length > 0 && (
                <span className="rounded-md bg-amber-950 px-2.5 py-1 text-xs font-mono text-amber-300 border border-amber-800">
                  📁 Collections: {selectedCollections.length} đã chọn
                </span>
              )}
            </div>
          )}
        </div>

        {/* Row 1: Store, Collection & Product Type */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Store selector */}
          <div className="space-y-1.5 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
            <label className="grid gap-1.5 text-sm text-slate-300">
              <span className="font-medium text-slate-200 flex items-center justify-between">
                <span>Shopify Store đích</span>
                <span className="text-[11px] font-mono text-purple-400">
                  Vendor: {((settings.storeId || "capozen").split("--")[0] || "CAPOZEN").trim().toUpperCase()}
                </span>
              </span>
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400 text-sm"
                value={settings.storeId || "capozen"}
                onChange={(e) => {
                  const nextStore = e.target.value;
                  updateSetting("storeId", nextStore);
                  updateSetting("collectionId", "");
                  updateSetting("collectionIds", []);
                  if (nextStore === "chillgen" && !settings.productType) {
                    updateSetting("productType", "Rug");
                  }
                }}
              >
                {availableStores.map((s) => (
                  <option key={s.storeId} value={s.storeId}>
                    {s.storeId} ({s.shopDomain})
                  </option>
                ))}
              </select>
            </label>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Store nhận sync. Vendor trên Shopify tự động gán là:{" "}
              <strong className="text-purple-300 font-mono">
                {((settings.storeId || "capozen").split("--")[0] || "CAPOZEN").trim().toUpperCase()}
              </strong>
            </p>
          </div>

          {/* Collection multi-selector */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200 flex items-center gap-1.5">
                <span>Collections đích</span>
                {selectedCollections.length > 0 && (
                  <span className="text-xs text-amber-400 font-mono font-semibold">
                    ({selectedCollections.length})
                  </span>
                )}
                {isLoadingCollections && (
                  <span className="text-[11px] text-cyan-400 animate-pulse font-normal">Đang tải...</span>
                )}
              </label>
              <div className="flex items-center gap-2 text-[11px]">
                {selectedCollections.length > 0 ? (
                  <button
                    type="button"
                    onClick={handleClearCollections}
                    className="text-rose-400 hover:text-rose-300 transition-colors font-medium"
                  >
                    Bỏ chọn hết
                  </button>
                ) : (
                  availableCollections.length > 0 && (
                    <button
                      type="button"
                      onClick={handleSelectAllCollections}
                      className="text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                    >
                      Chọn tất cả
                    </button>
                  )
                )}
              </div>
            </div>

            {/* Selected Pills */}
            {selectedCollections.length > 0 && (
              <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto pr-1">
                {selectedCollections.map((col) => (
                  <span
                    key={col.id}
                    className="inline-flex items-center gap-1 rounded bg-amber-950/80 border border-amber-700/70 px-2 py-0.5 text-xs text-amber-200 font-medium"
                  >
                    <span className="truncate max-w-[130px]">{col.title}</span>
                    <button
                      type="button"
                      onClick={() => toggleCollection(col.id)}
                      className="text-amber-400 hover:text-amber-100 font-bold ml-0.5 text-xs"
                      title="Bỏ chọn"
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            {/* Add Collection dropdown */}
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <select
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 outline-none focus:border-cyan-400 disabled:opacity-50 text-sm cursor-pointer"
                disabled={isLoadingCollections || availableCollections.length === 0}
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    toggleCollection(e.target.value);
                  }
                }}
              >
                <option value="">+ Thêm / Bỏ Collection...</option>
                {availableCollections.map((c) => {
                  const isSelected = activeCollectionIds.includes(c.id);
                  return (
                    <option key={c.id} value={c.id}>
                      {isSelected ? "✓ [Đã chọn] " : "+ "}{c.title} ({c.productsCount ?? 0} sp)
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                onClick={() => setIsCollectionListOpen(!isCollectionListOpen)}
                className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  isCollectionListOpen
                    ? "border-cyan-500 bg-cyan-950 text-cyan-200"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
                title="Bật/tắt danh sách checklist"
              >
                {isCollectionListOpen ? "Thu gọn" : "Chi tiết ▾"}
              </button>
            </div>

            {/* Expandable Checklist */}
            {isCollectionListOpen && availableCollections.length > 0 && (
              <div className="max-h-36 overflow-y-auto space-y-1 rounded-lg border border-slate-800 bg-slate-950/80 p-2 text-xs">
                {availableCollections.map((c) => {
                  const isChecked = activeCollectionIds.includes(c.id);
                  return (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 text-slate-300 hover:text-slate-100 cursor-pointer py-0.5 select-none"
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleCollection(c.id)}
                        className="rounded border-slate-700 text-cyan-500 focus:ring-0 cursor-pointer"
                      />
                      <span className={`truncate flex-1 ${isChecked ? "text-amber-200 font-medium" : ""}`}>
                        {c.title}
                      </span>
                      <span className="text-[10px] text-slate-500 font-mono">
                        {c.productsCount ?? 0} sp
                      </span>
                    </label>
                  );
                })}
              </div>
            )}

            <p className="text-[11px] text-slate-400 leading-relaxed">
              Tự động thêm sản phẩm vào tất cả các bộ sưu tập được chọn.
            </p>
          </div>

          {/* Product Type selector */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5 sm:col-span-2 lg:col-span-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                Loại sản phẩm (Product Type)
              </label>
              {settings.productType ? (
                <button
                  type="button"
                  onClick={() => updateSetting("productType", "")}
                  className="text-[11px] text-rose-400 hover:text-rose-300 transition-colors"
                >
                  Xóa / Theo gốc
                </button>
              ) : (
                <span className="text-[11px] text-slate-400 font-mono">
                  Theo Amazon
                </span>
              )}
            </div>

            {/* Quick Pills */}
            <div className="flex flex-wrap gap-1">
              {QUICK_PRODUCT_TYPE_PILLS.map((pill) => {
                const isActive = settings.productType?.toLowerCase() === pill.toLowerCase();
                return (
                  <button
                    key={pill}
                    type="button"
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition-colors ${
                      isActive
                        ? "bg-emerald-500 text-slate-950 font-semibold shadow-sm"
                        : "bg-slate-800/80 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                    }`}
                    onClick={() => updateSetting("productType", isActive ? "" : pill)}
                  >
                    {pill}
                  </button>
                );
              })}
            </div>

            {/* Dropdown & Direct Text Input Combo */}
            <div className="grid grid-cols-[1fr_auto] gap-1.5">
              <input
                type="text"
                placeholder="VD: Rug, Blanket, Quilt..."
                className="w-full rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-slate-100 outline-none focus:border-cyan-400 text-sm font-medium placeholder:text-slate-500"
                value={settings.productType || ""}
                onChange={(e) => updateSetting("productType", e.target.value)}
              />
              <select
                className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-slate-200 outline-none focus:border-cyan-400 text-xs cursor-pointer"
                value={
                  COMMON_PRODUCT_TYPES.some((t) => t.value === settings.productType)
                    ? settings.productType
                    : ""
                }
                onChange={(e) => {
                  if (e.target.value) {
                    updateSetting("productType", e.target.value);
                  }
                }}
              >
                <option value="">Mẫu...</option>
                {COMMON_PRODUCT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              Loại sp hiển thị trên Shopify (Chillgen: <span className="text-cyan-300 font-mono">Rug</span>, Jeminise: <span className="text-cyan-300 font-mono">Blanket</span>).
            </p>
          </div>
        </div>

        {/* Row 2: Price Addition & Compare-At Discount */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Price Addition */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                Giá cộng thêm ($)
              </label>
              <div className="flex flex-wrap gap-1">
                {[
                  { label: "+$0", value: 0 },
                  { label: "+$5.99", value: 5.99 },
                  { label: "+$6.95", value: 6.95 },
                  { label: "+$9.99", value: 9.99 },
                  { label: "+$14.99", value: 14.99 },
                ].map((btn) => (
                  <button
                    key={btn.label}
                    type="button"
                    className={`rounded px-2 py-0.5 text-xs font-semibold transition-colors ${
                      settings.priceAddition === btn.value
                        ? "bg-cyan-500 text-slate-950 shadow-sm"
                        : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                    }`}
                    onClick={() => updateSetting("priceAddition", btn.value)}
                  >
                    {btn.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-2 text-sm text-slate-500 pointer-events-none font-mono">$</span>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="0.00"
                className="w-full rounded-lg border border-slate-700 bg-slate-900 pl-7 pr-3 py-2 text-slate-100 outline-none focus:border-cyan-400 font-mono text-sm"
                value={settings.priceAddition ?? 0}
                onChange={(e) => {
                  const val = Math.max(0, Number(e.target.value) || 0);
                  updateSetting("priceAddition", val);
                }}
              />
            </div>
            <p className="text-[11px] text-slate-400">
              Số tiền cộng vào giá gốc Amazon trước khi bán (VD: +$6.95).
            </p>
          </div>

          {/* Compare-At Discount % */}
          <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900/40 p-3.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-slate-200">
                Giảm giá so sánh (% Compare-At)
              </label>
              <span className="text-xs font-mono text-cyan-300 font-semibold">
                {settings.discountPercent ?? 0}%
              </span>
            </div>
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <select
                className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-cyan-400 text-sm"
                value={
                  [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95].includes(
                    settings.discountPercent ?? 0
                  )
                    ? settings.discountPercent ?? 0
                    : "custom"
                }
                onChange={(e) => {
                  if (e.target.value !== "custom") {
                    updateSetting("discountPercent", Number(e.target.value));
                  }
                }}
              >
                <option value={0}>0% (Không hiển thị giá giảm)</option>
                {Array.from({ length: 19 }, (_, i) => (i + 1) * 5).map((pct) => (
                  <option key={pct} value={pct}>
                    Giảm {pct}%
                  </option>
                ))}
                {![0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95].includes(
                  settings.discountPercent ?? 0
                ) && (
                  <option value="custom">Tự nhập: {settings.discountPercent}%</option>
                )}
              </select>
              <div className="relative">
                <input
                  type="number"
                  step="1"
                  min="0"
                  max="95"
                  placeholder="%"
                  className="w-20 rounded-lg border border-slate-700 bg-slate-900 px-2 py-2 pr-6 text-slate-100 outline-none focus:border-cyan-400 font-mono text-sm text-right"
                  value={settings.discountPercent ?? 0}
                  onChange={(e) => {
                    const val = Math.min(95, Math.max(0, Number(e.target.value) || 0));
                    updateSetting("discountPercent", val);
                  }}
                />
                <span className="absolute right-2 top-2 text-xs text-slate-500 pointer-events-none">%</span>
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Tạo giá gạch ngang sao cho giá bán đã giảm đúng % này so với giá gốc.
            </p>
          </div>
        </div>

        {/* Live Calculation Preview Box */}
        {(() => {
          const sampleBase = 20.0;
          const addition = settings.priceAddition ?? 0;
          const discount = settings.discountPercent ?? 0;
          const selling = sampleBase + addition;
          const compareAt = discount > 0 && discount < 100 ? selling / (1 - discount / 100) : undefined;

          return (
            <div className="rounded-xl border border-cyan-900/60 bg-gradient-to-r from-slate-900/90 via-slate-900 to-cyan-950/30 p-4 text-xs text-slate-300 shadow-inner">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-800/80">
                <span className="font-semibold text-slate-200 flex items-center gap-1.5">
                  <span className="text-cyan-400 font-bold">📊 Xem trước kết quả</span>
                  <span className="text-slate-400 font-normal">(Ví dụ sản phẩm Amazon có giá gốc $20.00):</span>
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    Store: <strong className="text-cyan-300">{settings.storeId || "capozen"}</strong>
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    Vendor: <strong className="text-purple-300">{((settings.storeId || "capozen").split("--")[0] || "CAPOZEN").trim().toUpperCase()}</strong>
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    Type: <strong className="text-emerald-300">{settings.productType || "(Gốc Amazon)"}</strong>
                  </span>
                  <span className="rounded bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
                    Collections:{" "}
                    <strong className="text-amber-300">
                      {selectedCollections.length > 0
                        ? selectedCollections.map((c) => c.title).join(", ")
                        : "(Không gán)"}
                    </strong>
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                <span>
                  Giá bán thực tế:{" "}
                  <strong className="text-emerald-400 font-mono font-bold">${selling.toFixed(2)}</strong>{" "}
                  <span className="text-xs text-slate-500">($20.00 + ${addition.toFixed(2)})</span>
                </span>
                {compareAt !== undefined && (
                  <span>
                    Giá gạch ngang (Compare-At):{" "}
                    <strong className="text-amber-400 font-mono line-through font-bold">${compareAt.toFixed(2)}</strong>
                  </span>
                )}
                {discount > 0 ? (
                  <span className="rounded-md bg-rose-950/90 border border-rose-800 px-2 py-0.5 text-xs text-rose-300 font-bold tracking-wide">
                    Khách thấy: Tiết kiệm {discount}%
                  </span>
                ) : (
                  <span className="text-xs text-slate-500">
                    (Không áp dụng gạch ngang)
                  </span>
                )}
              </div>
            </div>
          );
        })()}
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="grid gap-1 text-sm text-slate-300">
          Profile
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            value={settings.profileSlug}
            onChange={(event) => {
              const nextProfile = event.target.value === "jeminise" ? "jeminise" : "default";
              updateSetting("profileSlug", nextProfile);
              if (nextProfile === "jeminise") {
                updateSetting("storeId", "jeminise");
                updateSetting("applyJeminisePreset", true);
              }
            }}
          >
            <option value="default">Default</option>
            <option value="jeminise">Jeminise</option>
          </select>
        </label>
        <label className="flex items-center gap-3 self-end rounded-lg border border-slate-700 p-2 text-sm text-slate-200">
          <input
            checked={settings.applyJeminisePreset}
            disabled={settings.profileSlug !== "jeminise"}
            type="checkbox"
            onChange={(event) => updateSetting("applyJeminisePreset", event.target.checked)}
          />
          Thay variants bằng preset Jeminise 47 variants
        </label>
        <label className="grid gap-1 text-sm text-slate-300">
          Xử lý ảnh
          <select
            className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2"
            value={settings.imageProfileSlug}
            onChange={(event) => {
              const slug = event.target.value;
              updateSetting("imageProfileSlug", slug);
              setEditingImageProfile(imageProfiles.find((profile) => profile.slug === slug) ?? null);
            }}
          >
            {imageProfiles.map((profile) => <option key={profile.slug} value={profile.slug}>{profile.name}{profile.enabled ? " · bật" : " · tắt"}</option>)}
          </select>
        </label>
        <div className="flex items-end gap-2">
          <button className="rounded-lg border border-cyan-700 px-3 py-2 text-sm text-cyan-200" type="button" onClick={() => setIsImageProfileEditorOpen((open) => !open)}>Cấu hình ảnh</button>
          <button className="rounded-lg border border-slate-700 px-3 py-2 text-sm" type="button" onClick={() => void handleCreateImageProfile()}>Tạo profile</button>
        </div>
      </div>

      {isImageProfileEditorOpen && editingImageProfile ? (
        <section className="space-y-4 rounded-xl border border-cyan-900 bg-slate-950/60 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold text-cyan-200">Image profile · {editingImageProfile.slug}</h2>
            <span className="text-xs text-slate-500">Revision {editingImageProfile.revision}</span>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-sm">Tên<input className="rounded border border-slate-700 bg-slate-900 px-3 py-2" value={editingImageProfile.name} onChange={(event) => setEditingImageProfile({ ...editingImageProfile, name: event.target.value })} /></label>
            <label className="flex items-center gap-2 self-end p-2 text-sm"><input checked={editingImageProfile.enabled} type="checkbox" onChange={(event) => setEditingImageProfile({ ...editingImageProfile, enabled: event.target.checked })} /> Bật xử lý ảnh</label>
            <label className="grid gap-2 text-sm">
              Logo PNG/JPEG/WebP
              {editingImageProfile.logoUrl ? (
                <span className="flex h-24 items-center justify-center overflow-hidden rounded-lg border border-slate-700 bg-white/90 p-2">
                  <img alt={`Logo hiện tại của ${editingImageProfile.name}`} className="max-h-full max-w-full object-contain" src={editingImageProfile.logoUrl} />
                </span>
              ) : (
                <span className="flex h-24 items-center justify-center rounded-lg border border-dashed border-slate-700 text-xs text-slate-500">Chưa có logo</span>
              )}
              <input accept="image/png,image/jpeg,image/webp" className="text-xs" type="file" onChange={(event) => void handleImageProfileLogo(event.target.files?.[0])} />
            </label>
            <label className="grid gap-1 text-sm">Ảnh thử preview<input accept="image/png,image/jpeg,image/webp" className="text-xs" type="file" onChange={(event) => void handleImageProfilePreview(event.target.files?.[0])} /></label>
            <NumberSetting label="Random pixels" min={0} max={10000} value={editingImageProfile.randomPixels} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, randomPixels: value })} />
            <NumberSetting label="Pixel delta" min={1} max={20} value={editingImageProfile.pixelDelta} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, pixelDelta: value })} />
            <NumberSetting label="JPEG quality" min={70} max={98} value={editingImageProfile.jpegQuality} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, jpegQuality: value })} />
            <NumberSetting label="Output width" min={100} max={4000} value={editingImageProfile.output.width} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, output: { ...editingImageProfile.output, width: value } })} />
            <NumberSetting label="Output height" min={100} max={4000} value={editingImageProfile.output.height} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, output: { ...editingImageProfile.output, height: value } })} />
            <label className="grid gap-1 text-sm">Fit<select className="rounded border border-slate-700 bg-slate-900 px-3 py-2" value={editingImageProfile.output.fit} onChange={(event) => setEditingImageProfile({ ...editingImageProfile, output: { ...editingImageProfile.output, fit: event.target.value === "cover" ? "cover" : "contain" } })}><option value="contain">Contain</option><option value="cover">Cover</option></select></label>
            <label className="grid gap-1 text-sm">Background<input className="h-10 rounded border border-slate-700 bg-slate-900" type="color" value={editingImageProfile.output.background} onChange={(event) => setEditingImageProfile({ ...editingImageProfile, output: { ...editingImageProfile.output, background: event.target.value } })} /></label>
            <label className="flex items-center gap-2 self-end p-2 text-sm"><input checked={editingImageProfile.logo.enabled} disabled={!editingImageProfile.hasLogo} type="checkbox" onChange={(event) => setEditingImageProfile({ ...editingImageProfile, logo: { ...editingImageProfile.logo, enabled: event.target.checked } })} /> Bật logo {editingImageProfile.hasLogo ? "" : "(chưa có file)"}</label>
            <label className="grid gap-1 text-sm">Vị trí logo<select className="rounded border border-slate-700 bg-slate-900 px-3 py-2" value={editingImageProfile.logo.position} onChange={(event) => setEditingImageProfile({ ...editingImageProfile, logo: { ...editingImageProfile.logo, position: event.target.value as ImageProcessingProfile["logo"]["position"] } })}><option value="top-left">Top left</option><option value="top-right">Top right</option><option value="bottom-left">Bottom left</option><option value="bottom-right">Bottom right</option></select></label>
            <NumberSetting label="Logo max %" min={1} max={100} value={editingImageProfile.logo.maxPercent} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, logo: { ...editingImageProfile.logo, maxPercent: value } })} />
            <NumberSetting label="Logo padding" min={0} max={4000} value={editingImageProfile.logo.padding} onChange={(value) => setEditingImageProfile({ ...editingImageProfile, logo: { ...editingImageProfile.logo, padding: value } })} />
          </div>
          {imageProfilePreview ? <img alt="Image processing preview" className="max-h-80 rounded-lg border border-slate-700 object-contain" src={imageProfilePreview} /> : null}
          <div className="flex gap-2">
            <button className="rounded bg-cyan-500 px-4 py-2 font-semibold text-slate-950" type="button" onClick={() => void handleSaveImageProfile()}>Lưu profile</button>
            <button className="rounded border border-rose-700 px-4 py-2 text-rose-300 disabled:opacity-40" disabled={editingImageProfile.slug === "default"} type="button" onClick={() => void handleDeleteImageProfile()}>Xóa profile</button>
          </div>
          {imageProfileMessage ? <p className="text-sm text-amber-200">{imageProfileMessage}</p> : null}
        </section>
      ) : null}

      <button className="text-sm font-semibold text-cyan-300" type="button" onClick={toggleCrawlerAdvancedOpen}>
        {isAdvancedOpen ? "Ẩn" : "Hiện"} Advanced Settings
      </button>
      {isAdvancedOpen ? (
        <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/50 p-4 sm:grid-cols-3">
          <NumberSetting label="Product threads" min={1} max={16} value={settings.productThreads} onChange={(value) => updateSetting("productThreads", value)} />
          <NumberSetting label="Variant threads" min={1} max={32} value={settings.variantThreads} onChange={(value) => updateSetting("variantThreads", value)} />
          <NumberSetting label="HTTP threads" min={1} max={64} value={settings.urllibThreads} onChange={(value) => updateSetting("urllibThreads", value)} />
          <NumberSetting label="Direct browser profiles" min={1} max={8} value={settings.browserProfiles} onChange={(value) => updateSetting("browserProfiles", value)} />
          <NumberSetting label="Tabs / profile" min={1} max={12} value={settings.browserTabs} onChange={(value) => updateSetting("browserTabs", value)} />
          <NumberSetting label="CAPTCHA timeout (s)" min={30} max={900} value={settings.captchaTimeoutSeconds} onChange={(value) => updateSetting("captchaTimeoutSeconds", value)} />
          <NumberSetting label="Matrix cap" min={1} max={5000} value={settings.maxMatrixVariants} onChange={(value) => updateSetting("maxMatrixVariants", value)} />
          <label className="grid gap-1 text-sm text-slate-300">Amazon ZIP<input className="rounded-lg border border-slate-700 bg-slate-950 px-3 py-2" value={settings.amazonZip} onChange={(event) => updateSetting("amazonZip", event.target.value)} /></label>
          <label className="flex items-center gap-2 self-end p-2 text-sm"><input checked={settings.headless} type="checkbox" onChange={(event) => updateSetting("headless", event.target.checked)} /> Headless browser</label>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <button className="rounded-lg bg-cyan-400 px-5 py-2 font-semibold text-slate-950 disabled:opacity-50" disabled={urls.length === 0 || isRunning} type="button" onClick={() => void handleStart()}>Start ({urls.length})</button>
        <button className="rounded-lg border border-rose-400 px-5 py-2 font-semibold text-rose-300 disabled:opacity-50" disabled={!isRunning} type="button" onClick={handleStop}>Stop</button>
        {output === null && resultProducts.length === 0 ? null : (
          <>
            {onHandoverToSeo ? (
              <button
                className="flex items-center gap-2 rounded-lg bg-emerald-500 px-5 py-2 font-semibold text-slate-950 shadow-sm transition-colors hover:bg-emerald-400 disabled:opacity-50"
                disabled={isRunning || isHandingOver || resultProducts.length === 0}
                type="button"
                onClick={() => void handleHandover()}
              >
                {isHandingOver ? (
                  <>
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-r-transparent" />
                    <span>Đang xử lý SEO ({resultProducts.length} SP)...</span>
                  </>
                ) : (
                  <>
                    <span>✨ Bàn giao sang SEO Review ({resultProducts.length})</span>
                  </>
                )}
              </button>
            ) : null}
            <button className="rounded-lg border border-cyan-500 px-5 py-2 font-semibold text-cyan-300" type="button" onClick={handleDownload}>Tải JSON</button>
            <button className="rounded-lg border border-slate-600 px-5 py-2 font-semibold text-slate-300 hover:border-rose-500 hover:text-rose-300 disabled:opacity-50" disabled={isRunning || isHandingOver} type="button" onClick={resetCrawlerOutput}>Xóa kết quả</button>
          </>
        )}
        <button className="rounded-lg border border-amber-500 px-5 py-2 font-semibold text-amber-300 disabled:opacity-50" disabled={isRunning || isClearingCache} type="button" onClick={() => void handleClearCache()}>{isClearingCache ? "Đang xóa cache..." : "Xóa cache"}</button>

        {recentJobs.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-1.5 ml-auto">
            <span className="text-xs text-slate-400 font-medium whitespace-nowrap">📋 Phiên cào gần đây:</span>
            <select
              value={lastJobId ?? ""}
              onChange={(e) => void handleSelectRecentJob(e.target.value)}
              className="rounded bg-slate-900 border border-slate-700 px-2 py-1 text-xs text-cyan-300 font-mono focus:border-cyan-500 focus:outline-none"
              disabled={isRunning || isHydratingJob}
            >
              <option value="" disabled>-- Chọn phiên cào để xem lại --</option>
              {recentJobs.map((j) => {
                const timeStr = j.createdAt ? new Date(j.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : "";
                const count = j.productCounts?.completed ?? j.acceptedInputs;
                return (
                  <option key={j.id} value={j.id}>
                    {timeStr ? `[${timeStr}] ` : ""}{j.id.slice(0, 8)}... ({count} SP · {j.status})
                  </option>
                );
              })}
            </select>
          </div>
        )}
      </div>
      {hydrateMessage && (
        <div className="flex items-center gap-2 rounded-lg border border-cyan-800/80 bg-cyan-950/30 px-3 py-2 text-xs text-cyan-200">
          {isHydratingJob && <span className="inline-block h-3 w-3 animate-spin rounded-full border border-cyan-300 border-r-transparent" />}
          <span>{hydrateMessage}</span>
        </div>
      )}
      {cacheMessage === null ? null : <p className="text-sm text-amber-200">{cacheMessage}</p>}
      {handoverError === null ? null : (
        <div className="rounded-xl border border-rose-600 bg-rose-950/40 p-4 text-sm text-rose-200">
          <p className="font-semibold text-rose-300">Không thể bàn giao sang SEO Review</p>
          <p className="mt-1">{handoverError}</p>
        </div>
      )}

      {progress === null ? null : (
        <div className={`space-y-4 rounded-xl border p-4 ${progress.phase === "captcha" ? "border-amber-400 bg-amber-950/30" : "border-slate-700 bg-slate-950/50"}`}>
          <div>
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <span>{progress.message}</span>
              <strong>{progress.completed}/{progress.total} products</strong>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded bg-slate-800">
              <div className="h-full bg-cyan-400 transition-[width]" style={{ width: `${progress.total > 0 ? Math.min(100, (progress.completed / progress.total) * 100) : 0}%` }} />
            </div>
            {progress.browserPool ? (
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400">
                <span>Direct: {progress.browserPool.directActive} active · {progress.browserPool.directQueued} queued / {progress.browserPool.directProfiles * progress.browserPool.tabsPerProfile} slots</span>
                <span>Proxy: {progress.browserPool.proxyActive} active · {progress.browserPool.proxyQueued} queued / {progress.browserPool.proxyProfiles * progress.browserPool.tabsPerProfile} fallback slots</span>
              </div>
            ) : null}
          </div>
          {(progress.items ?? []).length === 0 ? null : (
            <div className="grid gap-3 lg:grid-cols-2">
              {(progress.items ?? []).map((progressItem) => {
                const variantPercent = progressItem.variantTotal > 0
                  ? Math.min(100, (progressItem.variantCompleted / progressItem.variantTotal) * 100)
                  : 0;
                const statusStyle = progressItem.status === "completed"
                  ? "border-emerald-800 bg-emerald-950/20"
                  : progressItem.status === "failed"
                    ? "border-rose-800 bg-rose-950/20"
                    : progressItem.phase === "captcha"
                      ? "border-amber-600 bg-amber-950/30"
                      : "border-slate-700 bg-slate-900/60";
                return (
                  <article className={`min-w-0 rounded-lg border p-3 ${statusStyle}`} key={progressItem.source}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-xs text-cyan-200" title={progressItem.source}>{progressItem.asin}</p>
                        <p className="mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{progressPhaseLabel(progressItem.phase)}</p>
                      </div>
                      <strong className="shrink-0 text-sm">
                        {progressItem.variantTotal > 0 ? `${progressItem.variantCompleted}/${progressItem.variantTotal}` : progressItem.status}
                      </strong>
                    </div>
                    <p className="mt-2 text-sm text-slate-200">{progressItem.message}</p>
                    {progressItem.currentOptions === undefined ? null : (
                      <p className="mt-1 text-xs text-slate-400">
                        {optionLabel(progressItem.currentOptions)}{progressItem.currentAsin ? ` · ${progressItem.currentAsin}` : ""}
                      </p>
                    )}
                    {progressItem.networkRoute === undefined ? null : (
                      <p className="mt-1 text-xs text-cyan-300">
                        Browser: {progressItem.networkRoute}{progressItem.browserProfile ? ` · ${progressItem.browserProfile}` : ""}
                      </p>
                    )}
                    {progressItem.variantTotal > 0 ? (
                      <div className="mt-2 h-1.5 overflow-hidden rounded bg-slate-800">
                        <div className="h-full bg-violet-400 transition-[width]" style={{ width: `${variantPercent}%` }} />
                      </div>
                    ) : null}
                    {(progressItem.activeVariants ?? []).length === 0 ? null : (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(progressItem.activeVariants ?? []).map((variant) => (
                          <span className="rounded bg-slate-800 px-2 py-1 text-[11px] text-slate-300" key={variant.asin}>
                            {optionLabel(variant.options)} · {variant.asin}
                          </span>
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      )}
      {error === null ? null : <p className="rounded-xl border border-rose-600 bg-rose-950/30 p-4 text-rose-200">{error}</p>}

      {output === null && resultProducts.length === 0 ? null : (
        <section className="space-y-4">
          {output ? (
            <div className="grid gap-3 rounded-xl border border-slate-700 bg-slate-950/40 p-4 sm:grid-cols-4">
              <p><span className="block text-xs text-slate-400">Products</span>{output.statistics.products}</p>
              <p><span className="block text-xs text-slate-400">Source variants</span>{output.statistics.sourceVariants}</p>
              <p><span className="block text-xs text-slate-400">Final variants</span>{output.statistics.finalVariants}</p>
              <p><span className="block text-xs text-slate-400">Errors</span>{output.errors.length}</p>
            </div>
          ) : (
            <p className="rounded-xl border border-cyan-800 bg-cyan-950/20 p-3 text-sm text-cyan-200">
              Product sẽ xuất hiện tại đây ngay khi từng nhóm split hoàn tất; chuẩn hóa và Shopify tiếp tục chạy ở server.
            </p>
          )}
          {resultProducts.length === 0 ? (
            <p className="rounded-xl border border-slate-700 p-6 text-slate-400">Không có sản phẩm hợp lệ trong kết quả crawl.</p>
          ) : (
            <div className="grid items-start gap-5 lg:grid-cols-[minmax(17rem,22rem)_minmax(0,1fr)]">
              <aside className="max-h-[70vh] space-y-2 overflow-auto rounded-xl border border-slate-700 bg-slate-950/40 p-3">
                <div className="flex items-center justify-between px-2 pb-2">
                  <h2 className="text-sm font-semibold text-slate-200">Tất cả sản phẩm</h2>
                  {onHandoverToSeo ? (
                    <button
                      className="rounded bg-emerald-500 hover:bg-emerald-400 px-2 py-1 text-xs font-semibold text-slate-950 disabled:opacity-50 transition-colors"
                      disabled={isRunning || isHandingOver}
                      type="button"
                      onClick={() => void handleHandover()}
                      title="Bàn giao toàn bộ sản phẩm sang SEO Review"
                    >
                      {isHandingOver ? "Đang xử lý..." : "Bàn giao SEO ➔"}
                    </button>
                  ) : null}
                </div>
                {resultProducts.map((product) => {
                  const isSelected = product.id === selectedProduct?.id;
                  return (
                    <button
                      key={product.id}
                      className={`grid w-full grid-cols-[3.5rem_1fr] gap-3 rounded-lg border p-2 text-left ${isSelected ? "border-cyan-400 bg-cyan-950/40" : "border-slate-800 bg-slate-900/60 hover:border-slate-600"}`}
                      type="button"
                      onClick={() => handleSelectProduct(product.id)}
                    >
                      {product.media[0]?.url ? <img alt="" className="h-14 w-14 rounded-md bg-white object-contain" src={product.media[0].url} /> : <span className="flex h-14 w-14 items-center justify-center rounded-md bg-slate-800 text-xs text-slate-500">No image</span>}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-slate-100">{product.title}</span>
                        <span className="mt-1 block text-xs text-slate-400">{product.splitContext.attribute && product.splitContext.value ? `${product.splitContext.attribute}: ${product.splitContext.value}` : product.parentAsin}</span>
                        <span className="mt-1 block text-xs text-slate-300">{product.sourceVariants.length} source · {product.variants.length} final</span>
                        <span className="mt-1 flex flex-wrap gap-1 text-[11px]">
                          {product.customization ? <span className="rounded bg-violet-900/60 px-1.5 py-0.5 text-violet-200">Customize</span> : null}
                          {product.preset ? <span className="rounded bg-cyan-900/60 px-1.5 py-0.5 text-cyan-200">{product.preset}</span> : null}
                          {product.pipeline ? <span className={`rounded px-1.5 py-0.5 ${product.pipeline.status === "completed" ? "bg-emerald-900/60 text-emerald-200" : product.pipeline.status === "failed" || product.pipeline.status === "reconciliation_required" ? "bg-rose-900/60 text-rose-200" : "bg-blue-900/60 text-blue-200"}`}>Pipeline: {product.pipeline.status}</span> : null}
                          {product.warnings.length ? <span className="rounded bg-amber-900/60 px-1.5 py-0.5 text-amber-200">{product.warnings.length} warning</span> : null}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </aside>

              {selectedProduct === null ? (
                <div className="rounded-xl border border-slate-700 p-8 text-center text-slate-400">Chọn một sản phẩm để xem chi tiết.</div>
              ) : (
                <article className="min-w-0 space-y-5 rounded-xl border border-slate-700 bg-slate-950/30 p-4 sm:p-5">
                  <div className="grid gap-5 xl:grid-cols-[minmax(16rem,22rem)_minmax(0,1fr)]">
                    <div>
                      {activeMediaUrl ? (
                        <img alt={selectedProduct.title} className="aspect-square w-full rounded-xl bg-white object-contain" src={activeMediaUrl} />
                      ) : (
                        <div className="flex aspect-square items-center justify-center rounded-xl bg-slate-900 text-sm text-slate-500">Không có ảnh</div>
                      )}
                      {selectedProduct.media.length > 1 ? (
                        <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                          {selectedProduct.media.map((media) => (
                            <button key={media.url} className={`shrink-0 rounded-md border p-1 ${activeMediaUrl === media.url ? "border-cyan-400" : "border-slate-700"}`} type="button" onClick={() => setCrawlerSelectedMediaUrl(media.url)}>
                              {media.kind === "image" ? <img alt="" className="h-14 w-14 bg-white object-contain" src={media.url} /> : <span className="flex h-14 w-14 items-center justify-center text-xs">Video</span>}
                            </button>
                          ))}
                        </div>
                      ) : null}
                    </div>

                    <div className="min-w-0">
                      <h3 className="text-xl font-bold text-slate-100">{selectedProduct.title}</h3>
                      <p className="mt-2 font-mono text-xs text-cyan-300">ASIN gốc: {selectedProduct.parentAsin}</p>
                      <dl className="mt-4 grid gap-x-5 gap-y-2 text-sm sm:grid-cols-2">
                        <div><dt className="text-slate-500">Matrix</dt><dd>{selectedProduct.variantMatrix.discoveredCount}/{selectedProduct.variantMatrix.expectedCount} · {selectedProduct.variantMatrix.complete ? "Complete" : "Incomplete"}</dd></div>
                        <div><dt className="text-slate-500">Preset</dt><dd>{selectedProduct.preset ?? "—"}</dd></div>
                        <div><dt className="text-slate-500">Pipeline</dt><dd>{selectedProduct.pipeline?.status ?? "Chưa nhận"}</dd></div>
                        <div><dt className="text-slate-500">SEO</dt><dd>{selectedProduct.pipeline?.seo.status ?? "pending"}{selectedProduct.pipeline?.seo.engine ? ` · ${selectedProduct.pipeline.seo.engine}` : ""}</dd></div>
                        <div><dt className="text-slate-500">Ảnh</dt><dd>{selectedProduct.pipeline?.imageProcessing?.status ?? "pending"}{selectedProduct.pipeline?.imageProcessing?.profileSlug ? ` · ${selectedProduct.pipeline.imageProcessing.profileSlug}` : ""}</dd></div>
                        <div><dt className="text-slate-500">Proxy Shopify</dt><dd>{selectedProduct.pipeline?.shopify.proxyProfile ?? "—"}</dd></div>
                      </dl>
                      <a className="mt-4 inline-block text-sm font-semibold text-cyan-300 hover:text-cyan-200" href={selectedProduct.canonicalUrl} rel="noreferrer" target="_blank">Mở trên Amazon ↗</a>
                      {selectedProduct.pipeline?.shopify.adminUrl ? <a className="ml-4 mt-4 inline-block text-sm font-semibold text-emerald-300 hover:text-emerald-200" href={selectedProduct.pipeline.shopify.adminUrl} rel="noreferrer" target="_blank">Mở trên Shopify ↗</a> : null}
                      {selectedPipelineTimings.length > 0 ? (
                        <div className="mt-4 rounded-lg border border-slate-700 bg-slate-900/70 p-3">
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Thời gian xử lý</p>
                          <div className="mt-2 grid gap-1 text-xs text-slate-300 sm:grid-cols-2">
                            {selectedPipelineTimings.map((timing) => <span key={timing}>{timing}</span>)}
                          </div>
                        </div>
                      ) : null}
                      {selectedProduct.pipeline?.shopify.error ? <p className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">Shopify: {selectedProduct.pipeline.shopify.error}</p> : null}
                      {selectedProduct.pipeline?.seo.fallbackStages?.length ? <p className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">SEO fallback: {selectedProduct.pipeline.seo.fallbackStages.join(", ")}</p> : null}
                      {selectedProduct.pipeline?.seo.warnings?.map((warning) => <p key={warning} className="mt-3 rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-sm text-amber-200">SEO: {warning}</p>)}
                      {selectedProduct.pipeline?.seo.error ? <p className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">SEO: {selectedProduct.pipeline.seo.error}</p> : null}
                      {selectedProduct.pipeline?.imageProcessing?.error ? <p className="mt-3 rounded-lg border border-rose-800 bg-rose-950/30 p-3 text-sm text-rose-200">Ảnh: {selectedProduct.pipeline.imageProcessing.error}</p> : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2 border-b border-slate-700 pb-3">
                    {(["overview", "source", "final", "customize", "json"] as const).map((tab) => (
                      <button key={tab} className={`rounded-lg px-3 py-2 text-sm ${activeTab === tab ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-300"}`} type="button" onClick={() => setCrawlerActiveTab(tab)}>
                        {{ overview: "Thông tin", source: "Source variants", final: "Final variants", customize: "Customize", json: "Product JSON" }[tab]}
                      </button>
                    ))}
                  </div>

                  {activeTab === "overview" ? (
                    <div className="space-y-4 text-sm">
                      {selectedProduct.description ? <p className="whitespace-pre-wrap text-slate-300">{selectedProduct.description}</p> : null}
                      {selectedProduct.bulletPoints.length ? <ul className="list-disc space-y-1 pl-5 text-slate-300">{selectedProduct.bulletPoints.map((point) => <li key={point}>{point}</li>)}</ul> : null}
                      <p className="text-slate-400">Categories: {selectedProduct.categories.join(" / ") || "—"}</p>
                      {Object.keys(selectedProduct.productDetails).length ? <dl className="grid gap-2 rounded-lg border border-slate-800 p-3 sm:grid-cols-2">{Object.entries(selectedProduct.productDetails).map(([name, value]) => <div key={name}><dt className="text-slate-500">{name}</dt><dd>{value}</dd></div>)}</dl> : null}
                      {selectedProduct.warnings.map((warning) => <p key={warning} className="rounded-lg border border-amber-800 bg-amber-950/30 p-3 text-amber-200">⚠ {warning}</p>)}
                    </div>
                  ) : null}
                  {activeTab === "source" ? (
                    <div className="space-y-2">{selectedProduct.sourceVariants.map((variant) => <div key={variant.asin} className="rounded-lg border border-slate-800 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{variant.asin}</strong><span>{moneyLabel(variant.price?.raw, variant.price?.amount)}{variant.priceInference.isInferred ? " · inferred" : ""}</span></div><p className="mt-1 text-slate-300">{optionLabel(variant.options)}</p>{variant.diagnostics ? <p className="mt-1 text-xs text-slate-500">Fetch: {variant.diagnostics.fetchMode} · {variant.diagnostics.attempts} attempts{variant.diagnostics.captchaEncountered ? " · CAPTCHA" : ""}</p> : null}{variant.warnings.map((warning) => <p key={warning} className="mt-1 text-xs text-amber-300">⚠ {warning}</p>)}{variant.diagnostics?.fetchTrace ? <details className="mt-2"><summary className="cursor-pointer text-xs font-semibold text-cyan-300">Fetch debug</summary><pre className="mt-2 max-h-72 overflow-auto rounded bg-slate-950 p-3 text-[11px] text-slate-300">{JSON.stringify(variant.diagnostics.fetchTrace, null, 2)}</pre></details> : null}</div>)}</div>
                  ) : null}
                  {activeTab === "final" ? (
                    <div className="max-h-[42rem] space-y-2 overflow-auto pr-1">{selectedProduct.variants.map((variant) => <div key={variant.id} className="rounded-lg border border-slate-800 p-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{variant.sku}</strong><span>{moneyLabel(variant.price?.raw, variant.price?.amount)}</span></div><p className="mt-1 text-slate-300">{optionLabel(variant.options)}</p><p className="mt-1 text-xs text-slate-500">Source: {variant.sourceAsin ?? "preset"} · Base: {variant.price && variant.surcharge ? `$${(variant.price.amount - variant.surcharge.amount).toFixed(2)}` : moneyLabel(variant.price?.raw, variant.price?.amount)} · Surcharge: {moneyLabel(variant.surcharge?.raw, variant.surcharge?.amount)}</p></div>)}</div>
                  ) : null}
                  {activeTab === "customize" ? (
                    selectedProduct.customization ? <div className="space-y-4"><div className="rounded-lg border border-violet-800 bg-violet-950/20 p-3 text-sm"><p className="font-semibold text-violet-200">Paid groups đã chuyển thành variants: {selectedProduct.customization.pricing.paidOptionGroups.length}</p>{selectedProduct.customization.pricing.paidOptionGroups.map((group) => <p key={group.id} className="mt-1 text-slate-300">{group.label}: {group.options.map((option) => `${option.label} (${moneyLabel(option.price.raw, option.price.amount)})`).join(" · ")}</p>)}</div><p className="text-sm text-slate-400">Controls còn lại: {selectedProduct.customization.optionGroups.length + selectedProduct.customization.textInputs.length + selectedProduct.customization.imageInputs.length + selectedProduct.customization.fontGroups.length + selectedProduct.customization.colorGroups.length}</p><pre className="max-h-[36rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-slate-300">{JSON.stringify(selectedProduct.customization, null, 2)}</pre></div> : <p className="text-sm text-slate-400">Sản phẩm này không có Amazon Customize.</p>
                  ) : null}
                  {activeTab === "json" ? <pre className="max-h-[42rem] overflow-auto rounded-lg bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(selectedProduct, null, 2)}</pre> : null}
                </article>
              )}
            </div>
          )}
          {output?.errors.map((crawlError) => <p key={`${crawlError.source}-${crawlError.code}`} className="rounded-lg border border-rose-700 p-3 text-rose-200">{crawlError.source}: {crawlError.message}</p>)}
          {output?.status === "partial" ? <button className="rounded-lg border border-amber-600 px-3 py-2 text-sm font-semibold text-amber-200 disabled:opacity-50" disabled={isRetryingSync} type="button" onClick={() => void handleRetrySyncs()}>{isRetryingSync ? "Đang retry..." : "Retry Shopify lỗi"}</button> : null}
          {syncMessage ? <p className="text-sm text-amber-200">{syncMessage}</p> : null}
          {output ? <button className="text-sm font-semibold text-cyan-300" type="button" onClick={toggleCrawlerBatchJsonOpen}>{isBatchJsonOpen ? "Ẩn" : "Hiện"} Raw JSON toàn batch</button> : null}
          {isBatchJsonOpen && output ? <pre className="max-h-[42rem] overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-cyan-100">{JSON.stringify(output, null, 2)}</pre> : null}
        </section>
      )}
    </div>
  );
}
