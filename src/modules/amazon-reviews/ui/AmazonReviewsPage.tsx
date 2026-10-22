import { useEffect, useMemo, useRef, useState } from "react";

import { hasUsableReviewContext } from "../product-context";
import { mergeReviewPictureUrls } from "../picture-urls";
import { isMissingReviewJobError, isReviewJobConflictError, reviewGenerationErrorMessage } from "../service";
import { getContextPresentation, isSameContextSource, recoverContextIssue } from "../context-status";
import type { ReviewContextIssue } from "../context-status";
import type { AmazonReview, AmazonReviewJob, ReviewClient, ReviewGenerationJob, ReviewProduct, ReviewShopifyAccess } from "../types";

interface AmazonReviewsPageProps {
  readonly client: ReviewClient;
  readonly shopify: ReviewShopifyAccess;
  readonly selectedStoreId?: string;
  readonly onSelectedStoreIdChange?: (storeId: string) => void;
  readonly generatedPictureUrls?: readonly string[];
  readonly embedded?: boolean;
  readonly showStoreSelector?: boolean;
}

const TERMINAL_STATUSES = new Set(["completed", "partial", "failed", "cancelled"]);
const AMAZON_REVIEWS_SESSION_KEY = "ffp_amazon_reviews_session_v1";
const GENERATION_ACTIVE = new Set(["queued", "running", "validating", "saving"]);
const GENERATION_LABELS: Readonly<Record<ReviewGenerationJob["status"], string>> = {
  queued: "Đang chờ ChatGPT hoàn tất tác vụ hiện tại", running: "Đang chờ Bridge nhận câu trả lời từ ChatGPT",
  validating: "Đang kiểm tra nội dung", saving: "Đang lưu review", save_failed: "Đã tạo review, chưa lưu được",
  completed: "Đã tạo và lưu review", partial: "Đã lưu các mẫu đạt yêu cầu", failed: "Chưa tạo được review",
  cancelled: "Đã hủy", interrupted: "Tác vụ bị gián đoạn",
};
const GENERATION_PHASE_LABELS = {
  waiting_response: "Đã gửi yêu cầu · đang chờ câu trả lời ChatGPT",
  reading_response: "Đang đọc câu trả lời · chờ ChatGPT hoàn tất",
  sending_response: "ChatGPT đã xong · đang gửi kết quả về server",
} as const;

interface PersistedAmazonReviewsSession {
  readonly source: string;
  readonly storeId: string;
  readonly productQuery: string;
  readonly products: readonly ReviewProduct[];
  readonly nextCursor?: string;
  readonly selectedProducts: readonly string[];
  readonly selectedReviews: readonly string[];
  readonly reviewFilter: "all" | "real" | "ai";
  readonly minRating: number;
  readonly sampleCount: number;
  readonly randomizeReviewCount: boolean;
  readonly minReviewsPerProduct: number;
  readonly extraPictureText: string;
  readonly selectedGeneratedUrls: readonly string[];
}

function readAmazonReviewsSession(): PersistedAmazonReviewsSession {
  const empty: PersistedAmazonReviewsSession = {
    source: "",
    storeId: "",
    productQuery: "",
    products: [],
    selectedProducts: [],
    selectedReviews: [],
    reviewFilter: "all",
    minRating: 3,
    sampleCount: 10,
    randomizeReviewCount: false,
    minReviewsPerProduct: 1,
    extraPictureText: "",
    selectedGeneratedUrls: [],
  };
  if (typeof window === "undefined") return empty;
  try {
    const raw = window.localStorage.getItem(AMAZON_REVIEWS_SESSION_KEY);
    if (!raw) return empty;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return empty;
    const record = parsed as Record<string, unknown>;
    const products: ReviewProduct[] = Array.isArray(record.products)
      ? record.products.filter(
          (item): item is ReviewProduct =>
            Boolean(item) &&
            typeof item === "object" &&
            !Array.isArray(item) &&
            typeof (item as Record<string, unknown>).id === "string" &&
            typeof (item as Record<string, unknown>).handle === "string" &&
            typeof (item as Record<string, unknown>).title === "string",
        )
      : [];
    const readStrings = (value: unknown): readonly string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const reviewFilter =
      record.reviewFilter === "real" || record.reviewFilter === "ai" ? record.reviewFilter : "all";
    return {
      source: typeof record.source === "string" ? record.source : "",
      storeId: typeof record.storeId === "string" ? record.storeId : "",
      productQuery: typeof record.productQuery === "string" ? record.productQuery : "",
      products,
      ...(typeof record.nextCursor === "string" && record.nextCursor ? { nextCursor: record.nextCursor } : {}),
      selectedProducts: readStrings(record.selectedProducts),
      selectedReviews: readStrings(record.selectedReviews),
      reviewFilter,
      minRating: typeof record.minRating === "number" && record.minRating >= 1 && record.minRating <= 5 ? record.minRating : 3,
      sampleCount: typeof record.sampleCount === "number" && record.sampleCount >= 1 && record.sampleCount <= 50 ? record.sampleCount : 10,
      randomizeReviewCount: typeof record.randomizeReviewCount === "boolean" ? record.randomizeReviewCount : false,
      minReviewsPerProduct: typeof record.minReviewsPerProduct === "number" && record.minReviewsPerProduct >= 1 ? record.minReviewsPerProduct : 1,
      extraPictureText: typeof record.extraPictureText === "string" ? record.extraPictureText : "",
      selectedGeneratedUrls: readStrings(record.selectedGeneratedUrls),
    };
  } catch {
    return empty;
  }
}

function writeAmazonReviewsSession(session: PersistedAmazonReviewsSession): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(AMAZON_REVIEWS_SESSION_KEY, JSON.stringify(session));
  } catch {
    // Ignore storage quota or private-browsing errors.
  }
}

export function AmazonReviewsPage({ client, shopify, selectedStoreId, onSelectedStoreIdChange, generatedPictureUrls = [], embedded = false, showStoreSelector = true }: AmazonReviewsPageProps): React.JSX.Element {
  const initialSession = useMemo(() => readAmazonReviewsSession(), []);
  const [source, setSource] = useState(initialSession.source);
  const [jobId, setJobId] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("ffp_amazon_reviews_job_v1") ?? "");
  const [job, setJob] = useState<AmazonReviewJob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generation, setGeneration] = useState<ReviewGenerationJob | null>(null);
  const [generationIssue, setGenerationIssue] = useState("");
  const [generationActionError, setGenerationActionError] = useState("");
  const attemptedGenerationRef = useRef(false);
  const refreshedGenerationRef = useRef("");
  const [isClearing, setIsClearing] = useState(false);
  const [productSearchStatus, setProductSearchStatus] = useState<"idle" | "searching" | "loading-more">("idle");
  const jobRevisionRef = useRef(0);
  const [error, setError] = useState("");
  const [contextIssue, setContextIssue] = useState<ReviewContextIssue | null>(null);
  const [isFetchingContext, setIsFetchingContext] = useState(false);
  const [notice, setNotice] = useState("");
  const [stores, setStores] = useState<readonly string[]>([]);
  const [internalStoreId, setInternalStoreId] = useState(initialSession.storeId);
  const [productQuery, setProductQuery] = useState(initialSession.productQuery);
  const [products, setProducts] = useState<readonly ReviewProduct[]>(initialSession.products);
  const [nextCursor, setNextCursor] = useState<string | undefined>(initialSession.nextCursor);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(() => new Set(initialSession.selectedProducts));
  const [selectedReviews, setSelectedReviews] = useState<Set<string>>(() => new Set(initialSession.selectedReviews));
  const [reviewFilter, setReviewFilter] = useState<"all" | "real" | "ai">(initialSession.reviewFilter);
  const [minRating, setMinRating] = useState(initialSession.minRating);
  const [sampleCount, setSampleCount] = useState(initialSession.sampleCount);
  const [randomizeReviewCount, setRandomizeReviewCount] = useState(initialSession.randomizeReviewCount);
  const [minReviewsPerProduct, setMinReviewsPerProduct] = useState(initialSession.minReviewsPerProduct);
  const [extraPictureText, setExtraPictureText] = useState(initialSession.extraPictureText);
  const [selectedGeneratedUrls, setSelectedGeneratedUrls] = useState<Set<string>>(
    () => new Set(initialSession.selectedGeneratedUrls),
  );
  const storeId = selectedStoreId ?? internalStoreId;
  const scopedGeneration = generation?.contextJobId === jobId && generation.storeId === storeId ? generation : null;
  const hasActiveGeneration = Boolean(scopedGeneration && GENERATION_ACTIVE.has(scopedGeneration.status));
  const previousStoreIdRef = useRef(initialSession.storeId || storeId);

  function handleStoreChange(nextStoreId: string): void {
    if (selectedStoreId === undefined) setInternalStoreId(nextStoreId);
    onSelectedStoreIdChange?.(nextStoreId);
    setProducts([]);
    setSelectedProducts(new Set());
    setNextCursor(undefined);
  }

  useEffect(() => {
    if (!storeId) return;
    if (previousStoreIdRef.current && previousStoreIdRef.current !== storeId) {
      setProducts([]);
      setSelectedProducts(new Set());
      setNextCursor(undefined);
    }
    previousStoreIdRef.current = storeId;
  }, [storeId]);

  useEffect(() => {
    writeAmazonReviewsSession({
      source,
      storeId,
      productQuery,
      products,
      ...(nextCursor ? { nextCursor } : {}),
      selectedProducts: [...selectedProducts],
      selectedReviews: [...selectedReviews],
      reviewFilter,
      minRating,
      sampleCount,
      randomizeReviewCount,
      minReviewsPerProduct,
      extraPictureText,
      selectedGeneratedUrls: [...selectedGeneratedUrls],
    });
  }, [
    extraPictureText,
    minRating,
    minReviewsPerProduct,
    nextCursor,
    productQuery,
    products,
    randomizeReviewCount,
    reviewFilter,
    sampleCount,
    selectedGeneratedUrls,
    selectedProducts,
    selectedReviews,
    source,
    storeId,
  ]);

  useEffect(() => {
    if (jobId) window.localStorage.setItem("ffp_amazon_reviews_job_v1", jobId);
    else window.localStorage.removeItem("ffp_amazon_reviews_job_v1");
  }, [jobId]);

  useEffect(() => {
    void shopify.listStores().then((availableStores) => {
      setStores(availableStores);
      if (selectedStoreId === undefined) {
        setInternalStoreId((current) =>
          current && availableStores.includes(current) ? current : (availableStores[0] ?? ""),
        );
      }
    }).catch(() => setStores([]));
  }, [shopify, selectedStoreId]);

  useEffect(() => {
    setSelectedGeneratedUrls((current) => new Set([
      ...[...current].filter((url) => generatedPictureUrls.includes(url)),
      ...generatedPictureUrls.filter((url) => !current.has(url)),
    ]));
  }, [generatedPictureUrls]);

  useEffect(() => {
    if (!jobId) return;
    let isDisposed = false;
    let isLoading = false;
    const jobRevision = jobRevisionRef.current;
    const load = async (): Promise<void> => {
      if (isLoading) return;
      isLoading = true;
      try {
        const loaded = await client.get(jobId);
        if (isDisposed || jobRevision !== jobRevisionRef.current) return;
        setJob(loaded);
        setContextIssue((current) => recoverContextIssue(current, loaded));
        setSelectedReviews((current) => {
          if (current.size) return current;
          return new Set([...(loaded.reviewData.reviews ?? []), ...loaded.samples].map((review) => review.reviewId));
        });
        setProductQuery((current) => current || `tag:amazon-parent-${loaded.asin.toLowerCase()}`);
      } catch (cause) {
        if (isDisposed || jobRevision !== jobRevisionRef.current) return;
        if (isMissingReviewJobError(cause)) {
          isDisposed = true;
          jobRevisionRef.current += 1;
          setJobId("");
          setJob(null);
          setSelectedReviews(new Set());
          setNotice("Kết quả cũ không còn trên coordinator và đã được dọn. Hãy nhập URL hoặc ASIN để lấy ngữ cảnh mới.");
          setContextIssue(null);
          return;
        }
        setContextIssue({ jobId, source: "", message: "Tạm thời chưa cập nhật được tiến độ. Đang thử kết nối lại; dữ liệu đã nhận được giữ nguyên." });
      } finally {
        isLoading = false;
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!isDisposed && (!TERMINAL_STATUSES.has(job?.status ?? "") || contextIssue?.jobId === jobId)) void load();
    }, 2000);
    return () => { isDisposed = true; window.clearInterval(timer); };
  }, [client, jobId, job?.status, contextIssue?.jobId]);

  useEffect(() => {
    setGeneration(null); setGenerationIssue(""); setGenerationActionError(""); attemptedGenerationRef.current = false; refreshedGenerationRef.current = "";
    if (!jobId || !storeId) return;
    let disposed = false;
    let loading = false;
    const refresh = async (): Promise<void> => {
      if (loading) return;
      loading = true;
      try {
        const latest = await client.latestGeneration(jobId, storeId);
        if (disposed) return;
        setGeneration(current => current && latest && current.createdAt > latest.createdAt ? current : latest);
        setGenerationIssue("");
        if (latest && attemptedGenerationRef.current && GENERATION_ACTIVE.has(latest.status)) setGenerationActionError("");
        if (latest && ["completed", "partial"].includes(latest.status) && refreshedGenerationRef.current !== latest.id) {
          const loaded = await client.get(jobId);
          if (disposed) return;
          setJob(loaded);
          setSelectedReviews(new Set([...(loaded.reviewData.reviews ?? []), ...loaded.samples].map(review => review.reviewId)));
          refreshedGenerationRef.current = latest.id;
          setGenerationActionError("");
        }
      } catch {
        if (!disposed) setGenerationIssue("Chưa cập nhật được trạng thái tạo review. Đang thử kết nối lại; không cần bấm tạo thêm.");
      } finally { loading = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2500);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [client, jobId, storeId]);

  const reviews = useMemo(() => [...(job?.reviewData.reviews ?? []), ...(job?.samples ?? [])], [job]);
  const hasAiContext = hasUsableReviewContext(job?.reviewData.context);
  const hasAmazonReviews = (job?.reviewData.reviews?.length ?? 0) > 0;
  const isContextPending = Boolean(jobId && (!job || !TERMINAL_STATUSES.has(job.status)));
  const contextPresentation = job ? getContextPresentation(job) : null;
  const canExport = selectedProducts.size > 0 && selectedReviews.size > 0;
  const cardClass = "space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900";
  const fieldClass = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900";
  const primaryButtonClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50";
  const visibleReviews = reviews.filter((review) =>
    review.rating >= minRating && (reviewFilter === "all" || (reviewFilter === "ai") === review.synthetic));

  async function handleFetchContext(): Promise<void> {
    if (isBusy || isContextPending || hasActiveGeneration) return;
    if (job && hasAiContext && isSameContextSource(source, job)) {
      setContextIssue(null);
      setNotice("Ngữ cảnh của ASIN này đã sẵn sàng bên dưới. Không cần lấy lại; chọn Xóa kết quả nếu muốn bắt đầu mới.");
      return;
    }
    setIsBusy(true); setIsFetchingContext(true); setContextIssue(null); setNotice("");
    try {
      const created = await client.create(source.trim());
      jobRevisionRef.current += 1;
      setJob(null); setSelectedReviews(new Set()); setSelectedProducts(new Set()); setProducts([]); setNextCursor(undefined); setProductQuery(""); setReviewFilter("all");
      setJobId(created.jobId);
    } catch (cause) {
      setContextIssue({ jobId: null, source: source.trim(), message: isReviewJobConflictError(cause)
        ? "Đang có tác vụ chưa kết thúc trên server. Theo dõi tác vụ hiện tại và kiểm tra agent đã tiếp tục nhận việc; không cần gửi yêu cầu liên tục."
        : "Không tạo được lượt lấy ngữ cảnh mới. Kiểm tra URL/ASIN và kết nối; kết quả trước đó vẫn được giữ nguyên." });
    } finally { setIsBusy(false); setIsFetchingContext(false); }
  }

  async function handleProductSearch(cursor?: string): Promise<void> {
    if (isBusy) return;
    if (!storeId) { setError("Hãy chọn Shopify store."); return; }
    setIsBusy(true); setError("");
    setProductSearchStatus(cursor ? "loading-more" : "searching");
    setNotice(cursor ? "Đang tải thêm Shopify product. Vui lòng chờ…" : "Đang tìm Shopify product. Vui lòng chờ…");
    try {
      const page = await shopify.findProducts(storeId, productQuery.trim(), cursor);
      setProducts((current) => cursor ? [...current, ...page.products] : page.products);
      setSelectedProducts((current) => new Set([
        ...(cursor ? current : []), ...page.products.map((product) => product.id),
      ]));
      setNextCursor(page.nextCursor);
      setNotice(cursor ? `Đã tải thêm ${page.products.length} product.` : `Tìm thấy ${page.products.length} product.`);
    } catch { setNotice(""); setError("Không tìm được Shopify product. Kiểm tra store và kết nối gateway."); }
    finally { setIsBusy(false); setProductSearchStatus("idle"); }
  }

  async function handleClearResults(): Promise<void> {
    if (!jobId || isBusy || hasActiveGeneration || scopedGeneration?.status === "save_failed") return;
    setIsBusy(true); setIsClearing(true); setError(""); setNotice("");
    try {
      await client.clear(jobId);
      // Ignore responses from polling that started before the saved job was deleted.
      jobRevisionRef.current += 1;
      if (!source.trim()) setSource(job?.sourceUrl || job?.asin || "");
      setJobId(""); setJob(null); setSelectedReviews(new Set());
      setContextIssue(null);
      setProducts([]); setSelectedProducts(new Set()); setNextCursor(undefined);
      setProductQuery(""); setReviewFilter("all");
      setNotice("Đã xóa ngữ cảnh và toàn bộ review mẫu. Bạn có thể lấy ngữ cảnh và tạo lại.");
    } catch {
      setError("Không xóa được kết quả. Kiểm tra kết nối coordinator rồi thử lại.");
    } finally { setIsBusy(false); setIsClearing(false); }
  }

  async function handleGenerateSamples(): Promise<void> {
    if (!job || !hasAiContext || !storeId || hasActiveGeneration || isBusy || scopedGeneration?.status === "save_failed") return;
    if (!Number.isInteger(sampleCount) || sampleCount < 1 || sampleCount > 50) { setError("Nhập số mẫu từ 1 đến 50."); return; }
    const revision = jobRevisionRef.current;
    const requestKey = `ffp_review_text_request:${job.jobId}:${storeId}:${sampleCount}`;
    setIsBusy(true); setIsGenerating(true); setGenerationActionError(""); attemptedGenerationRef.current = true;
    setNotice("");
    try {
      const requestId = window.localStorage.getItem(requestKey) || crypto.randomUUID();
      window.localStorage.setItem(requestKey, requestId);
      const created = await client.generate({ contextJobId: job.jobId, storeId, count: sampleCount, requestId });
      window.localStorage.removeItem(requestKey);
      if (revision === jobRevisionRef.current) { setGeneration(created); setGenerationIssue(""); }
    } catch (cause) { setGenerationActionError(reviewGenerationErrorMessage(cause)); }
    finally { setIsBusy(false); setIsGenerating(false); }
  }

  async function handleGenerationAction(action: "cancel" | "retry"): Promise<void> {
    if (!scopedGeneration || isBusy) return;
    setIsBusy(true); setGenerationActionError("");
    try {
      setGeneration(await (action === "cancel" ? client.cancelGeneration(scopedGeneration.id) : client.retryGenerationSave(scopedGeneration.id)));
    } catch (cause) { setGenerationActionError(reviewGenerationErrorMessage(cause)); }
    finally { setIsBusy(false); }
  }

  async function handleExport(kind: "real" | "ai" | "preview"): Promise<void> {
    if (!job) return;
    if (!canExport) { setError("Chọn ít nhất một sản phẩm Shopify và một review trước khi xuất file."); return; }
    setIsBusy(true); setError("");
    try {
      const chosenProducts = products.filter((product) => selectedProducts.has(product.id));
      const blob = await client.export(job.jobId, {
        kind, reviewIds: [...selectedReviews], products: chosenProducts,
        extraPictureUrls: mergeReviewPictureUrls([...selectedGeneratedUrls], extraPictureText),
        randomizeReviewCount, minReviewsPerProduct,
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = `${job.asin}.${kind === "real" ? "judgeme-import" : kind === "ai" ? "qa-ai-samples" : "qa-review-preview"}.xlsx`;
      document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url);
      setNotice(`Đã xuất ${kind === "real" ? "review Amazon thật" : "file QA"}.`);
    } catch { setError("Không xuất được XLSX. Kiểm tra review đã chọn và kết nối coordinator."); }
    finally { setIsBusy(false); }
  }

  function toggleReview(review: AmazonReview): void {
    setSelectedReviews((current) => {
      const next = new Set(current);
      if (next.has(review.reviewId)) next.delete(review.reviewId); else next.add(review.reviewId);
      return next;
    });
  }

  return (
    <section className="space-y-6 text-slate-900 dark:text-slate-100">
      {!embedded ? <div><h1 className="text-2xl font-semibold">Amazon Reviews</h1><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Lấy ngữ cảnh sản phẩm Amazon và tạo mẫu AI để kiểm tra trong file QA.</p></div> : null}
      <section className={cardClass}>
        <h2 className="font-semibold">1. Lấy thông tin sản phẩm</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">Chỉ lấy dữ kiện sản phẩm để tạo mẫu AI, không thu thập đánh giá của khách hàng Amazon.</p>
        <form className="grid items-end gap-3 md:grid-cols-[1fr_auto_auto]" onSubmit={(event) => { event.preventDefault(); void handleFetchContext(); }}>
          <label className="grid gap-1.5 text-sm">URL Amazon hoặc ASIN<input className={fieldClass} value={source} onChange={(event) => setSource(event.target.value)} required /></label>
          <button className={primaryButtonClass} type="submit" disabled={isBusy || isContextPending || hasActiveGeneration}>{isFetchingContext || isContextPending ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />Đang lấy ngữ cảnh…</> : "Lấy ngữ cảnh"}</button>
          <button className="rounded-lg border border-rose-200 px-4 py-2 text-sm font-medium text-rose-700 disabled:opacity-50 dark:border-rose-800 dark:text-rose-300" type="button" disabled={isBusy || !jobId || hasActiveGeneration || scopedGeneration?.status === "save_failed"} onClick={() => void handleClearResults()} title="Hủy tác vụ tạo review trước khi xóa ngữ cảnh">{isClearing ? "Đang xóa…" : "Xóa kết quả"}</button>
        </form>
        {contextIssue ? <p role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">{contextIssue.message}</p> : null}
        {isContextPending && !job ? <p role="status" className="text-sm text-blue-700 dark:text-blue-300">Đang tải trạng thái tác vụ. Kết quả sẽ tự cập nhật.</p> : null}
      </section>
      {error ? <p role="alert" className="rounded border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/60 p-3 text-rose-700 dark:text-rose-300">{error}</p> : null}
      {notice ? <p role="status" className="rounded border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/60 p-3 text-blue-700 dark:text-blue-300">{notice}</p> : null}
      {job && contextPresentation ? <div className={`space-y-2 rounded-xl border p-4 text-sm ${contextPresentation.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : contextPresentation.tone === "progress" ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
        <div role="status" className="flex flex-wrap items-center gap-2 font-semibold">
          {contextPresentation.tone === "progress" ? <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-blue-300 border-t-blue-700 motion-reduce:animate-none" /> : <span aria-hidden="true">{hasAiContext ? "✓" : "!"}</span>}
          {contextPresentation.title}<span className="rounded border border-current/20 px-2 py-0.5 font-mono text-xs">{job.asin}</span>
        </div>
        {hasAiContext ? <p className="font-medium">{job.reviewData.context?.title || job.asin}</p> : null}
        <p>{contextPresentation.description}</p>
        {hasAiContext ? <details className="pt-1"><summary className="cursor-pointer text-xs font-medium underline underline-offset-4">Xem dữ kiện đã lấy</summary>
          {job.reviewData.context?.description ? <p className="mt-2">Mô tả: {job.reviewData.context.description}</p> : null}
          {job.reviewData.context?.bullets?.length ? <p className="mt-2">Điểm nổi bật: {job.reviewData.context.bullets.join(" · ")}</p> : null}
          {Object.keys(job.reviewData.context?.details ?? {}).length ? <p className="mt-2">Chi tiết: {Object.entries(job.reviewData.context?.details ?? {}).map(([name, value]) => `${name}: ${value}`).join(" · ")}</p> : null}
        </details> : null}
      </div> : null}
      {job ? <div className="grid gap-4 lg:grid-cols-2">
        <section aria-busy={productSearchStatus !== "idle"} className={cardClass}>
          <h2 className="font-semibold">2. Chọn sản phẩm Shopify</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Chọn sản phẩm nhận dữ liệu trong file XLSX. Chưa ghi review lên Shopify ở bước này.</p>
          {showStoreSelector ? <label className="grid gap-1 text-sm">Store<select className={fieldClass} value={storeId} onChange={(event) => handleStoreChange(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label> : null}
          <label className="grid gap-1.5 text-sm">Tìm theo ASIN tag hoặc từ khóa<input className={fieldClass} value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></label>
          <button type="button" className="flex items-center gap-2 rounded bg-slate-100 dark:bg-slate-700 px-3 py-2 text-sm disabled:opacity-50" disabled={isBusy} onClick={() => void handleProductSearch()}>{productSearchStatus === "searching" ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />Đang tìm product…</> : "Tìm product"}</button>
          <div className="max-h-64 space-y-2 overflow-auto">{products.map((product) => <label key={product.id} className="flex gap-2 rounded border border-slate-200 dark:border-slate-700 p-2 text-sm"><input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => setSelectedProducts((current) => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} /><span>{product.title}<br /><small className="text-slate-600 dark:text-slate-400">{product.handle} · {product.status}</small></span></label>)}</div>
          <p className="text-xs text-slate-500 dark:text-slate-400">{products.length ? `Đã chọn ${selectedProducts.size}/${products.length} sản phẩm.` : "Chưa có sản phẩm được chọn. Bấm Tìm product để tìm trong store hiện tại."}</p>
          {nextCursor ? <button type="button" className="text-sm text-blue-700 dark:text-blue-300 disabled:opacity-50" disabled={isBusy} onClick={() => void handleProductSearch(nextCursor)}>{productSearchStatus === "loading-more" ? "Đang tải thêm product…" : "Tải thêm product"}</button> : null}
        </section>
        <section aria-busy={isGenerating} className={cardClass}>
          <h2 className="font-semibold">3. Tạo review AI để kiểm tra</h2>
          <p className="text-sm text-slate-500 dark:text-slate-400">Mẫu AI phục vụ QA, không phải đánh giá thật của khách hàng.</p>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5 text-sm">Số mẫu AI<input className={`${fieldClass} max-w-24`} type="number" min="1" max="50" disabled={isGenerating || hasActiveGeneration} value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))} /></label>
            <button type="button" className={primaryButtonClass} disabled={isBusy || !hasAiContext || !storeId || hasActiveGeneration || scopedGeneration?.status === "save_failed"} onClick={() => void handleGenerateSamples()}>{isGenerating || hasActiveGeneration ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none" />Đang xử lý…</> : "Tạo review bằng ChatGPT"}</button>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">Dùng tab ChatGPT đã ghim trong Bridge 1.5.0+. Tác vụ text và ảnh chạy lần lượt, không cần Vertex API.</p>
          {generationIssue ? <p role="alert" className="text-sm text-amber-700 dark:text-amber-300">{generationIssue}</p> : null}
          {generationActionError ? <p role="alert" className="text-sm text-rose-700 dark:text-rose-300">{generationActionError}</p> : null}
          {scopedGeneration ? <div role="status" className={`space-y-2 rounded-lg border p-3 text-sm ${hasActiveGeneration ? "border-blue-200 bg-blue-50 text-blue-900 dark:border-blue-800 dark:bg-blue-950/30 dark:text-blue-200" : ["completed", "partial"].includes(scopedGeneration.status) ? "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200" : "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"}`}>
            <p className="font-semibold">{scopedGeneration.status === "running" && scopedGeneration.phase ? GENERATION_PHASE_LABELS[scopedGeneration.phase] : GENERATION_LABELS[scopedGeneration.status]}</p>
            {scopedGeneration.accepted > 0 ? <p>{scopedGeneration.accepted}/{scopedGeneration.count} mẫu đạt yêu cầu · {scopedGeneration.rejected} mẫu chưa đạt</p> : null}
            {scopedGeneration.error ? <p>{scopedGeneration.error.startsWith("REVIEW_") ? reviewGenerationErrorMessage(new Error(scopedGeneration.error)) : scopedGeneration.error}</p> : null}
            {scopedGeneration.warnings.length ? <details><summary className="cursor-pointer">Chi tiết kiểm tra chất lượng</summary><ul className="mt-2 list-inside list-disc">{scopedGeneration.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul></details> : null}
            {scopedGeneration.status === "save_failed" ? <button type="button" className={primaryButtonClass} disabled={isBusy} onClick={() => void handleGenerationAction("retry")}>Thử lưu lại</button> : null}
            {(hasActiveGeneration && scopedGeneration.status !== "saving" || scopedGeneration.status === "save_failed") ? <button type="button" className="ml-2 underline disabled:opacity-50" disabled={isBusy} onClick={() => void handleGenerationAction("cancel")}>Hủy tạo review</button> : null}
          </div> : null}
          <p className="text-sm text-slate-500 dark:text-slate-400">{!hasAiContext ? "Cần lấy ngữ cảnh thành công trước khi tạo mẫu." : reviews.length ? `Đã có ${reviews.length} review. Xem và chọn mẫu cần xuất ở bước 4.` : "Ngữ cảnh đã sẵn sàng. Bấm tạo mẫu để có nội dung xem và xuất file."}</p>
        </section>
      </div> : null}
      {job ? <section className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">4. Kiểm tra và xuất XLSX</h2><p className="text-sm text-slate-500 dark:text-slate-400">{selectedReviews.size} review đã chọn · {selectedProducts.size} sản phẩm</p></div>
        {reviews.length ? <>
          <div className="flex flex-wrap items-end gap-3 text-sm">
            {hasAmazonReviews ? <label>Bộ lọc <select className={fieldClass} value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as "all" | "real" | "ai")}><option value="all">Tất cả</option><option value="real">Amazon thật</option><option value="ai">AI QA</option></select></label> : null}
            <label>Hiển thị từ <input className={`${fieldClass} max-w-20`} aria-label="Rating tối thiểu" type="number" min="1" max="5" value={minRating} onChange={(event) => setMinRating(Number(event.target.value))} /></label>
            <button type="button" className="py-2 text-blue-700 dark:text-blue-300" onClick={() => setSelectedReviews(new Set(visibleReviews.map((review) => review.reviewId)))}>Chọn review đang hiển thị ({visibleReviews.length})</button>
          </div>
          <div className="grid max-h-80 gap-2 overflow-auto md:grid-cols-2">{visibleReviews.map((review) => <label key={review.reviewId} className="flex gap-2 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700"><input type="checkbox" checked={selectedReviews.has(review.reviewId)} onChange={() => toggleReview(review)} /><span><strong>{review.author || "Ẩn danh"}</strong> · {review.rating}★ · {review.synthetic ? "AI QA" : "Amazon"}<br />{review.body}</span></label>)}</div>
          {!visibleReviews.length ? <p className="text-sm text-slate-500">Không có review phù hợp với bộ lọc. Giảm mức rating để xem các mẫu khác.</p> : null}
        </> : <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600 dark:bg-slate-800 dark:text-slate-300">Chưa tạo review AI. Đây không phải lỗi lấy ngữ cảnh — hãy tạo mẫu ở bước 3.</p>}
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-sm font-medium">Tùy chọn ảnh và phân bổ review</summary><div className="mt-3 space-y-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={randomizeReviewCount} onChange={(event) => setRandomizeReviewCount(event.target.checked)} />Số review ngẫu nhiên theo product</label>
        {randomizeReviewCount ? <label className="grid max-w-48 gap-1 text-sm">Tối thiểu mỗi product<input className={fieldClass} type="number" min="1" value={minReviewsPerProduct} onChange={(event) => setMinReviewsPerProduct(Number(event.target.value))} /></label> : null}
        {generatedPictureUrls.length > 0 ? <fieldset className="space-y-2 rounded border border-slate-300 dark:border-slate-700 p-3 text-sm"><legend className="px-1 font-medium">Ảnh review đã upload lên Shopify</legend>{generatedPictureUrls.map((url) => <label key={url} className="flex items-start gap-2"><input type="checkbox" checked={selectedGeneratedUrls.has(url)} onChange={() => setSelectedGeneratedUrls((current) => { const next = new Set(current); if (next.has(url)) next.delete(url); else next.add(url); return next; })} /><span className="min-w-0 break-all text-blue-700 dark:text-blue-300">{url}</span></label>)}</fieldset> : null}
        <label className="grid gap-1 text-sm">Link ảnh bổ sung thủ công (mỗi link một dòng)<textarea className={`${fieldClass} min-h-20`} value={extraPictureText} onChange={(event) => setExtraPictureText(event.target.value)} /></label>
        </div></details>
        <div className="flex flex-wrap gap-2">{hasAmazonReviews ? <button type="button" className="rounded bg-emerald-50 dark:bg-emerald-950/60 px-3 py-2 disabled:opacity-50" disabled={isBusy || !canExport || !reviews.some((review) => selectedReviews.has(review.reviewId) && !review.synthetic)} onClick={() => void handleExport("real")}>XLSX review thật · Judge.me</button> : null}<button type="button" className={primaryButtonClass} disabled={isBusy || !canExport || !reviews.some((review) => selectedReviews.has(review.reviewId) && review.synthetic)} onClick={() => void handleExport("ai")}>XLSX AI · QA</button>{hasAmazonReviews ? <button type="button" className="rounded bg-slate-100 dark:bg-slate-700 px-3 py-2 disabled:opacity-50" disabled={isBusy || !canExport} onClick={() => void handleExport("preview")}>XLSX kết hợp · QA preview</button> : null}</div>
        {!canExport ? <p className="text-xs text-slate-500 dark:text-slate-400">Để xuất file, chọn ít nhất một sản phẩm Shopify ở bước 2 và một review ở đây.</p> : null}
      </section> : null}
    </section>
  );
}
