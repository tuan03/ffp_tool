import { useEffect, useMemo, useRef, useState } from "react";

import { hasUsableReviewContext } from "../product-context";
import { mergeReviewPictureUrls } from "../picture-urls";
import { isMissingReviewJobError } from "../service";
import type { AmazonReview, AmazonReviewJob, ReviewClient, ReviewProduct, ReviewShopifyAccess } from "../types";

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

export function AmazonReviewsPage({ client, shopify, selectedStoreId, onSelectedStoreIdChange, generatedPictureUrls = [], embedded = false, showStoreSelector = true }: AmazonReviewsPageProps): React.JSX.Element {
  const [source, setSource] = useState("");
  const [jobId, setJobId] = useState(() => typeof window === "undefined" ? "" : window.localStorage.getItem("ffp_amazon_reviews_job_v1") ?? "");
  const [job, setJob] = useState<AmazonReviewJob | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [productSearchStatus, setProductSearchStatus] = useState<"idle" | "searching" | "loading-more">("idle");
  const jobRevisionRef = useRef(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [stores, setStores] = useState<readonly string[]>([]);
  const [internalStoreId, setInternalStoreId] = useState("");
  const [productQuery, setProductQuery] = useState("");
  const [products, setProducts] = useState<readonly ReviewProduct[]>([]);
  const [nextCursor, setNextCursor] = useState<string | undefined>();
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [selectedReviews, setSelectedReviews] = useState<Set<string>>(new Set());
  const [reviewFilter, setReviewFilter] = useState<"all" | "real" | "ai">("all");
  const [minRating, setMinRating] = useState(3);
  const [sampleCount, setSampleCount] = useState(10);
  const [randomizeReviewCount, setRandomizeReviewCount] = useState(false);
  const [minReviewsPerProduct, setMinReviewsPerProduct] = useState(1);
  const [extraPictureText, setExtraPictureText] = useState("");
  const [selectedGeneratedUrls, setSelectedGeneratedUrls] = useState<Set<string>>(new Set());
  const storeId = selectedStoreId ?? internalStoreId;

  function handleStoreChange(nextStoreId: string): void {
    if (selectedStoreId === undefined) setInternalStoreId(nextStoreId);
    onSelectedStoreIdChange?.(nextStoreId);
    setProducts([]);
    setSelectedProducts(new Set());
    setNextCursor(undefined);
  }

  useEffect(() => {
    if (jobId) window.localStorage.setItem("ffp_amazon_reviews_job_v1", jobId);
    else window.localStorage.removeItem("ffp_amazon_reviews_job_v1");
  }, [jobId]);

  useEffect(() => {
    void shopify.listStores().then((availableStores) => {
      setStores(availableStores);
      if (selectedStoreId === undefined) setInternalStoreId((current) => current || availableStores[0] || "");
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
    const jobRevision = jobRevisionRef.current;
    const load = async (): Promise<void> => {
      try {
        const loaded = await client.get(jobId);
        if (isDisposed || jobRevision !== jobRevisionRef.current) return;
        setJob(loaded);
        setSelectedReviews((current) => {
          if (current.size) return current;
          return new Set([...(loaded.reviewData.reviews ?? []), ...loaded.samples].map((review) => review.reviewId));
        });
        if (!productQuery) setProductQuery(`tag:amazon-parent-${loaded.asin.toLowerCase()}`);
      } catch (cause) {
        if (isDisposed || jobRevision !== jobRevisionRef.current) return;
        if (isMissingReviewJobError(cause)) {
          isDisposed = true;
          jobRevisionRef.current += 1;
          setJobId("");
          setJob(null);
          setSelectedReviews(new Set());
          setNotice("Kết quả cũ không còn trên coordinator và đã được dọn. Hãy nhập URL hoặc ASIN để lấy ngữ cảnh mới.");
          setError("");
          return;
        }
        setError("Không tải được ngữ cảnh sản phẩm. Kiểm tra kết nối coordinator.");
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (!isDisposed && !TERMINAL_STATUSES.has(job?.status ?? "")) void load();
    }, 2000);
    return () => { isDisposed = true; window.clearInterval(timer); };
  }, [client, jobId, job?.status, productQuery]);

  const reviews = useMemo(() => [...(job?.reviewData.reviews ?? []), ...(job?.samples ?? [])], [job]);
  const hasAiContext = hasUsableReviewContext(job?.reviewData.context);
  const hasAmazonReviews = (job?.reviewData.reviews?.length ?? 0) > 0;
  const visibleReviews = reviews.filter((review) =>
    review.rating >= minRating && (reviewFilter === "all" || (reviewFilter === "ai") === review.synthetic));

  async function handleFetchContext(): Promise<void> {
    setIsBusy(true); setError(""); setNotice(""); setJob(null); setSelectedReviews(new Set()); setSelectedProducts(new Set());
    setReviewFilter("all");
    try {
      const created = await client.create(source.trim());
      setJobId(created.jobId);
      setNotice("Đã yêu cầu lấy ngữ cảnh sản phẩm. Tiến độ sẽ tự cập nhật.");
    } catch {
      setError("Không lấy được ngữ cảnh sản phẩm. Kiểm tra URL/ASIN và kết nối coordinator.");
    } finally { setIsBusy(false); }
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
    if (!jobId || isBusy) return;
    setIsBusy(true); setIsClearing(true); setError(""); setNotice("");
    try {
      await client.clear(jobId);
      // Ignore responses from polling that started before the saved job was deleted.
      jobRevisionRef.current += 1;
      if (!source.trim()) setSource(job?.sourceUrl || job?.asin || "");
      setJobId(""); setJob(null); setSelectedReviews(new Set());
      setProducts([]); setSelectedProducts(new Set()); setNextCursor(undefined);
      setProductQuery(""); setReviewFilter("all");
      setNotice("Đã xóa ngữ cảnh và toàn bộ review mẫu. Bạn có thể lấy ngữ cảnh và tạo lại.");
    } catch {
      setError("Không xóa được kết quả. Kiểm tra kết nối coordinator rồi thử lại.");
    } finally { setIsBusy(false); setIsClearing(false); }
  }

  async function handleGenerateSamples(): Promise<void> {
    const context = job?.reviewData.context;
    if (!job || !hasUsableReviewContext(context)) { setError("Chưa có dữ kiện sản phẩm đủ dùng để tạo review AI. Hãy lấy lại ngữ cảnh sau khi xử lý đăng nhập hoặc CAPTCHA."); return; }
    setIsBusy(true); setIsGenerating(true); setError("");
    setNotice(`Đang tạo ${sampleCount} review AI. Vui lòng chờ…`);
    try {
      const generated = await client.generate({
        asin: job.asin, count: sampleCount, startIndex: job.samples.length + 1,
        product: context, sourceReviews: job.reviewData.reviews ?? [], priorSamples: job.samples,
      });
      setNotice("Đang lưu review AI vừa tạo…");
      await client.saveSamples(job.jobId, generated.samples);
      const updatedJob = await client.get(job.jobId);
      setJob(updatedJob);
      setSelectedReviews(new Set([
        ...(updatedJob.reviewData.reviews ?? []), ...updatedJob.samples,
      ].map((review) => review.reviewId)));
      setNotice(`Đã tạo ${generated.samples.length} mẫu QA${generated.rejected ? `; loại ${generated.rejected} mẫu chưa đạt` : ""}. ${generated.warnings.join(" ")}`);
    } catch { setNotice(""); setError("Không tạo được review AI. Kiểm tra ngữ cảnh sản phẩm và cấu hình Vertex AI."); }
    finally { setIsBusy(false); setIsGenerating(false); }
  }

  async function handleExport(kind: "real" | "ai" | "preview"): Promise<void> {
    if (!job) return;
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
    <section className="space-y-6 text-slate-100">
      {!embedded ? <div><h1 className="text-2xl font-semibold">Amazon Reviews</h1><p className="mt-1 text-sm text-slate-400">Lấy ngữ cảnh sản phẩm Amazon và tạo mẫu AI để kiểm tra trong file QA.</p></div> : null}
      <form className="grid gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 md:grid-cols-[1fr_auto_auto]" onSubmit={(event) => { event.preventDefault(); void handleFetchContext(); }}>
        <label className="grid gap-1 text-sm">URL Amazon hoặc ASIN<input className="rounded border border-slate-700 bg-slate-950 px-3 py-2" value={source} onChange={(event) => setSource(event.target.value)} required /></label>
        <button className="self-end rounded bg-cyan-600 px-4 py-2 font-medium disabled:opacity-50" type="submit" disabled={isBusy}>Lấy ngữ cảnh</button>
        <button className="self-end rounded border border-rose-800 px-4 py-2 font-medium text-rose-200 disabled:opacity-50" type="button" disabled={isBusy || !jobId} onClick={() => void handleClearResults()} title="Xóa ngữ cảnh và toàn bộ review mẫu của lần đang mở">{isClearing ? "Đang xóa…" : "Xóa kết quả"}</button>
      </form>
      {error ? <p role="alert" className="rounded border border-rose-800 bg-rose-950/40 p-3 text-rose-200">{error}</p> : null}
      {notice ? <p role="status" className="rounded border border-cyan-800 bg-cyan-950/40 p-3 text-cyan-200">{notice}</p> : null}
      {job ? <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm">
        <p><strong>{job.asin}</strong> · {job.status} · {job.samples.length} mẫu QA</p>
        <p className="mt-1 text-slate-400">{job.progress?.message || (hasAiContext ? "Đã lấy ngữ cảnh sản phẩm." : TERMINAL_STATUSES.has(job.status) ? "Chưa lấy được ngữ cảnh sản phẩm." : "Đang chờ agent lấy ngữ cảnh sản phẩm.")}</p>
        {job.reviewData.stopReason === "captcha" || job.reviewData.stopReason === "signin" ? <p className="mt-2 text-amber-300">Mở browser của crawler agent để xử lý đăng nhập hoặc CAPTCHA, rồi chạy lại job.</p> : null}
        {job.error ? <p className="mt-2 text-rose-300">Agent gặp lỗi khi lấy ngữ cảnh. Kiểm tra trạng thái agent rồi thử lại.</p> : null}
        {hasAiContext ? <details className="mt-2 rounded border border-slate-700 p-2"><summary className="cursor-pointer">Ngữ cảnh sản phẩm dùng cho AI: {job.reviewData.context?.title || job.asin}</summary>
          {job.reviewData.context?.description ? <p className="mt-2">Mô tả: {job.reviewData.context.description}</p> : null}
          {job.reviewData.context?.bullets?.length ? <p className="mt-2">Điểm nổi bật: {job.reviewData.context.bullets.join(" · ")}</p> : null}
          {Object.keys(job.reviewData.context?.details ?? {}).length ? <p className="mt-2">Chi tiết: {Object.entries(job.reviewData.context?.details ?? {}).map(([name, value]) => `${name}: ${value}`).join(" · ")}</p> : null}
        </details> : <p className="mt-2 text-amber-300">Chưa lấy được ngữ cảnh sản phẩm đủ dùng cho AI. Hãy đợi agent hoàn tất hoặc lấy lại ngữ cảnh nếu có lỗi.</p>}
      </div> : null}
      {job ? <div className="grid gap-4 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-semibold">Review ({visibleReviews.length}/{reviews.length})</h2>
          <div className="flex flex-wrap gap-3 text-sm">{hasAmazonReviews ? <label>Bộ lọc <select className="ml-1 rounded bg-slate-950 p-1" value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as "all" | "real" | "ai")}><option value="all">Tất cả</option><option value="real">Amazon thật</option><option value="ai">AI QA</option></select></label> : null}<label>Rating từ <input className="ml-1 w-14 rounded bg-slate-950 p-1" type="number" min="1" max="5" value={minRating} onChange={(event) => setMinRating(Number(event.target.value))} /></label></div>
          <p className="text-xs text-slate-400">Rating từ là bộ lọc hiển thị. Mẫu AI mới được phân bổ từ 3 đến 5 sao.</p>
          <button type="button" className="text-sm text-cyan-300" onClick={() => setSelectedReviews(new Set(visibleReviews.map((review) => review.reviewId)))}>Chọn review đang hiển thị</button>
          <div className="max-h-96 space-y-2 overflow-auto">{visibleReviews.length ? visibleReviews.map((review) => <label key={review.reviewId} className="flex gap-2 rounded border border-slate-800 p-2 text-sm"><input type="checkbox" checked={selectedReviews.has(review.reviewId)} onChange={() => toggleReview(review)} /><span><strong>{review.author || "Ẩn danh"}</strong> · {review.rating}★ · {review.synthetic ? "AI QA" : "Amazon"}<br />{review.body}</span></label>) : <p className="text-sm text-slate-400">Không có review phù hợp.</p>}</div>
        </section>
        <section aria-busy={productSearchStatus !== "idle"} className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4">
          <h2 className="font-semibold">Shopify product</h2>
          {showStoreSelector ? <label className="grid gap-1 text-sm">Store<select className="rounded bg-slate-950 p-2" value={storeId} onChange={(event) => handleStoreChange(event.target.value)}>{stores.map((store) => <option key={store} value={store}>{store}</option>)}</select></label> : null}
          <label className="grid gap-1 text-sm">Tìm theo ASIN tag hoặc từ khóa<input className="rounded bg-slate-950 p-2" value={productQuery} onChange={(event) => setProductQuery(event.target.value)} /></label>
          <button type="button" className="flex items-center gap-2 rounded bg-slate-700 px-3 py-2 text-sm disabled:opacity-50" disabled={isBusy} onClick={() => void handleProductSearch()}>{productSearchStatus === "searching" ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />Đang tìm product…</> : "Tìm product"}</button>
          <div className="max-h-64 space-y-2 overflow-auto">{products.map((product) => <label key={product.id} className="flex gap-2 rounded border border-slate-800 p-2 text-sm"><input type="checkbox" checked={selectedProducts.has(product.id)} onChange={() => setSelectedProducts((current) => { const next = new Set(current); if (next.has(product.id)) next.delete(product.id); else next.add(product.id); return next; })} /><span>{product.title}<br /><small className="text-slate-400">{product.handle} · {product.status}</small></span></label>)}</div>
          {nextCursor ? <button type="button" className="text-sm text-cyan-300 disabled:opacity-50" disabled={isBusy} onClick={() => void handleProductSearch(nextCursor)}>{productSearchStatus === "loading-more" ? "Đang tải thêm product…" : "Tải thêm product"}</button> : null}
        </section>
      </div> : null}
      {job ? <section aria-busy={isGenerating} className="space-y-4 rounded-xl border border-slate-800 bg-slate-900 p-4">
        <h2 className="font-semibold">Tạo mẫu AI và xuất XLSX</h2>
        <div className="flex flex-wrap items-end gap-3"><label className="grid gap-1 text-sm">Số mẫu AI<input className="w-28 rounded bg-slate-950 p-2" type="number" min="1" max="50" disabled={isGenerating} value={sampleCount} onChange={(event) => setSampleCount(Number(event.target.value))} /></label><button type="button" className="flex items-center gap-2 rounded bg-violet-700 px-4 py-2 disabled:opacity-50" disabled={isBusy || !hasAiContext} onClick={() => void handleGenerateSamples()}>{isGenerating ? <><span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white motion-reduce:animate-none" />Đang tạo review AI…</> : "Tạo review AI cho QA"}</button></div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={randomizeReviewCount} onChange={(event) => setRandomizeReviewCount(event.target.checked)} />Số review ngẫu nhiên theo product</label>
        {randomizeReviewCount ? <label className="grid max-w-48 gap-1 text-sm">Tối thiểu mỗi product<input className="rounded bg-slate-950 p-2" type="number" min="1" value={minReviewsPerProduct} onChange={(event) => setMinReviewsPerProduct(Number(event.target.value))} /></label> : null}
        {generatedPictureUrls.length > 0 ? <fieldset className="space-y-2 rounded border border-slate-700 p-3 text-sm"><legend className="px-1 font-medium">Ảnh review đã upload lên Shopify</legend>{generatedPictureUrls.map((url) => <label key={url} className="flex items-start gap-2"><input type="checkbox" checked={selectedGeneratedUrls.has(url)} onChange={() => setSelectedGeneratedUrls((current) => { const next = new Set(current); if (next.has(url)) next.delete(url); else next.add(url); return next; })} /><span className="min-w-0 break-all text-cyan-300">{url}</span></label>)}</fieldset> : null}
        <label className="grid gap-1 text-sm">Link ảnh bổ sung thủ công (mỗi link một dòng)<textarea className="min-h-20 rounded bg-slate-950 p-2" value={extraPictureText} onChange={(event) => setExtraPictureText(event.target.value)} /></label>
        <div className="flex flex-wrap gap-2">{hasAmazonReviews ? <button type="button" className="rounded bg-emerald-700 px-3 py-2 disabled:opacity-50" disabled={isBusy || !reviews.some((review) => selectedReviews.has(review.reviewId) && !review.synthetic)} onClick={() => void handleExport("real")}>XLSX review thật · Judge.me</button> : null}<button type="button" className="rounded bg-violet-700 px-3 py-2 disabled:opacity-50" disabled={isBusy || !reviews.some((review) => selectedReviews.has(review.reviewId) && review.synthetic)} onClick={() => void handleExport("ai")}>XLSX AI · QA</button><button type="button" className="rounded bg-slate-700 px-3 py-2 disabled:opacity-50" disabled={isBusy || selectedReviews.size === 0} onClick={() => void handleExport("preview")}>XLSX kết hợp · QA preview</button></div>
      </section> : null}
    </section>
  );
}
