import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { sanitizeHtmlDescription } from "../sanitize-html";
import { buildProductZoomImages } from "../zoom-image-helper";
import type { SeoProductUiViewModel, ZoomImageItem } from "../types";

interface ReviewResultContentProps {
  readonly product: SeoProductUiViewModel;
  readonly onZoomImage?: (images: readonly ZoomImageItem[], initialIndex?: number) => void;
}

const SECTION_LABELS = ["Nội dung SEO", "Ảnh & Alt", "AEO", "Nguồn & kết quả"] as const;
const controlClass = "rounded-md px-2.5 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-blue-600 dark:text-slate-400 dark:hover:bg-slate-800";
const descriptionClass = "max-w-none space-y-3 break-words text-sm leading-7 text-slate-700 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-4 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_p]:my-3 [&_a]:text-blue-700 [&_a]:underline [&_img]:max-w-full [&_table]:block [&_table]:overflow-auto dark:text-slate-300 dark:[&_a]:text-blue-300";

export function ReviewSourceComparison({ product }: { readonly product: SeoProductUiViewModel }): React.JSX.Element {
  const backup = product.originalBackup;
  if (!backup) return <div className="rounded-lg bg-slate-50 p-6 dark:bg-slate-800">
    <h4 className="font-semibold text-slate-900 dark:text-slate-100">Chưa có bản nguồn đã lưu</h4>
    <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">Bản ghi này không kèm backup để đối chiếu. Bạn vẫn có thể xem nội dung SEO ở tab bên cạnh.</p>
  </div>;
  const fields = [
    { label: "Tên sản phẩm", before: backup.productTitle, after: product.productTitle.value },
    { label: "Handle", before: backup.handle, after: product.handle.value },
    { label: "SEO title", before: backup.seoTitle, after: product.seoTitle.value },
    { label: "Meta description", before: backup.seoDescription, after: product.seoDescription.value },
    { label: "Mô tả (HTML)", before: backup.productDescription, after: product.productDescription.value },
  ];
  return <section aria-label="Đối chiếu nguồn và kết quả" className="space-y-4">
    <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">Đối chiếu với bản nguồn tại thời điểm lưu; không phải dữ liệu Shopify trực tiếp.</p>
    <div className="grid grid-cols-2 gap-5 border-b border-slate-200 pb-3 text-sm font-semibold dark:border-slate-700">
      <span className="text-slate-600 dark:text-slate-400">Bản nguồn đã lưu</span>
      <span className="text-blue-700 dark:text-blue-300">Kết quả SEO</span>
    </div>
    {fields.map(field => <div key={field.label} className="border-b border-slate-100 pb-4 last:border-0 dark:border-slate-800">
      <div className="mb-2 flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400">
        <h4>{field.label}</h4>
        {field.before !== undefined && <span className="text-slate-400">{field.before === field.after ? "Không đổi" : "Đã thay đổi"}</span>}
      </div>
      <div className="grid grid-cols-2 gap-5 text-sm leading-6">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-slate-600 dark:text-slate-400">{field.before === undefined ? "Không có trong bản nguồn" : field.before || "Trống"}</pre>
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-sans text-slate-900 dark:text-slate-100">{field.after || "Trống"}</pre>
      </div>
    </div>)}
  </section>;
}

export function ReviewResultContent(props: ReviewResultContentProps): React.JSX.Element {
  // Catalog rows deliberately omit SEO fields; only a hydrated record is readable.
  if (props.product.reviewListItem) return <div role="status" className="space-y-4 p-6 text-sm text-slate-500 dark:text-slate-400">
    <p>Đang tải nội dung SEO…</p>
    <div className="h-6 w-3/4 rounded bg-slate-100 dark:bg-slate-800" />
    <div className="h-28 rounded bg-slate-100 dark:bg-slate-800" />
  </div>;
  return <ResultReader key={props.product.id} {...props} />;
}

function ResultReader({ product, onZoomImage }: ReviewResultContentProps): React.JSX.Element {
  const [section, setSection] = useState(0);
  const [isHtmlVisible, setIsHtmlVisible] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState("");
  const tabId = useId();
  const tabsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!copyFeedback) return;
    const timer = setTimeout(() => setCopyFeedback(""), 2200);
    return () => clearTimeout(timer);
  }, [copyFeedback]);

  async function handleCopyContent(): Promise<void> {
    try {
      await navigator.clipboard.writeText(product.productDescription.value);
      setCopyFeedback("Đã sao chép HTML");
    } catch {
      setCopyFeedback("Chưa sao chép được. Bạn có thể chọn văn bản trong chế độ HTML.");
    }
  }
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const directions: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1, Home: -section, End: SECTION_LABELS.length - 1 - section };
    const direction = directions[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    event.stopPropagation();
    const next = (section + direction + SECTION_LABELS.length) % SECTION_LABELS.length;
    setSection(next);
    tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  }

  return <div className="min-w-0">
    <div ref={tabsRef} role="tablist" aria-label="Nội dung kết quả SEO" onKeyDown={handleTabKeyDown}
      className="sticky top-0 z-10 flex gap-5 border-b border-slate-200 bg-white px-5 dark:border-slate-700 dark:bg-slate-900">
      {SECTION_LABELS.map((label, index) => <button key={label} type="button" role="tab" id={`${tabId}-tab-${index}`}
        aria-selected={section === index} aria-controls={`${tabId}-panel-${index}`} tabIndex={section === index ? 0 : -1}
        onClick={() => setSection(index)} className={"shrink-0 border-b-2 py-3.5 text-xs font-semibold transition focus-visible:outline-2 focus-visible:outline-blue-600 " +
          (section === index ? "border-blue-600 text-blue-700 dark:border-blue-400 dark:text-blue-300" : "border-transparent text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100")}>
        {label}{index === 1 && <span className="ml-1.5 tabular-nums text-slate-400">{product.images.length}</span>}
      </button>)}
    </div>
    <div role="tabpanel" id={`${tabId}-panel-${section}`} aria-labelledby={`${tabId}-tab-${section}`} tabIndex={0}
      className="space-y-6 p-5 focus-visible:outline-2 focus-visible:outline-blue-600">
      {section === 0 && <>
        <section aria-label="Tiêu đề và mô tả SEO" className="space-y-2 rounded-lg bg-slate-50 p-4 dark:bg-slate-800/60">
          <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400"><h4>SEO title</h4><span className="tabular-nums">{product.seoTitle.value.length} ký tự</span></div>
          <p className="text-lg font-medium leading-7 text-blue-700 dark:text-blue-300">{product.seoTitle.value || "Chưa có SEO title"}</p>
          <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">/products/{product.handle.value || "—"}</p>
          <div className="flex items-center justify-between border-t border-slate-200 pt-3 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400"><h4>Meta description</h4><span className="tabular-nums">{product.seoDescription.value.length} ký tự</span></div>
          <p className="text-sm leading-6 text-slate-700 dark:text-slate-300">{product.seoDescription.value || "Chưa có meta description"}</p>
          <p className="text-xs text-slate-400 dark:text-slate-500">Nội dung đã lưu · Không phải bản xem trước trực tiếp trên Google.</p>
        </section>
        <section aria-label="Mô tả sản phẩm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Mô tả sản phẩm</h4>
            <div className="flex gap-1"><button type="button" aria-pressed={isHtmlVisible} onClick={() => setIsHtmlVisible(!isHtmlVisible)} className={controlClass}>{isHtmlVisible ? "Đọc nội dung" : "HTML"}</button>
              <button type="button" onClick={() => void handleCopyContent()} className={controlClass}>Sao chép HTML</button></div>
          </div>
          <p role="status" className="text-xs text-slate-500 dark:text-slate-400">{copyFeedback}</p>
          {!product.productDescription.value ? <p className="text-sm text-slate-500">Chưa có mô tả sản phẩm trong bản ghi này.</p>
            : isHtmlVisible ? <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg bg-slate-50 p-4 font-mono text-xs leading-6 text-slate-700 dark:bg-slate-800 dark:text-slate-300">{product.productDescription.value}</pre>
            // Reuse the existing HTML sanitizer at the rendering boundary.
            : <div className={descriptionClass} dangerouslySetInnerHTML={{ __html: sanitizeHtmlDescription(product.productDescription.value) }} />}
        </section>
      </>}
      {section === 1 && <section aria-label="Ảnh và văn bản thay thế" className="space-y-4">
        <p className="text-xs text-slate-500 dark:text-slate-400">{product.images.length} ảnh trong bản ghi · Nhấn ảnh để phóng to.</p>
        {product.images.length === 0 && <p className="text-sm text-slate-500">Chưa có ảnh trong bản ghi này.</p>}
        {product.images.map((picture, index) => <article key={picture.id} className="flex gap-4 border-b border-slate-100 pb-4 dark:border-slate-800">
          <button type="button" aria-label={`Phóng to ảnh #${index + 1}`} disabled={!onZoomImage || !picture.previewUrl.value}
            onClick={() => onZoomImage?.(buildProductZoomImages(product), index)} className="h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-800">
            {picture.previewUrl.value ? <img src={picture.previewUrl.value} alt={picture.alt.value || product.productTitle.value} loading="lazy" className="h-full w-full object-contain" /> : <span className="text-xs text-slate-500">Không có ảnh</span>}
          </button>
          <div className="min-w-0 flex-1 space-y-2"><p className="text-xs text-slate-500 dark:text-slate-400">Ảnh {index + 1} · Alt text · {picture.alt.value.length} ký tự</p>
            <p className="break-words text-sm leading-6 text-slate-900 dark:text-slate-100">{picture.alt.value || "Chưa có Alt text"}</p>
            {picture.webpFilename.value && <p className="break-all font-mono text-xs text-slate-500 dark:text-slate-400">{picture.webpFilename.value}</p>}
          </div>
        </article>)}
      </section>}
      {section === 2 && <section aria-label="Nội dung AEO" className="space-y-6 text-sm leading-7 text-slate-700 dark:text-slate-300">
        <div><h4 className="mb-2 font-semibold text-slate-900 dark:text-slate-100">Tóm tắt nhanh</h4><p>{product.aeoQuickSummary?.value || "Chưa có tóm tắt AEO trong bản ghi này."}</p></div>
        <div><h4 className="mb-3 font-semibold text-slate-900 dark:text-slate-100">Câu hỏi thường gặp</h4>
          {product.aeoFaq?.value.length ? product.aeoFaq.value.map((faq, index) => <article key={`${index}-${faq.question}`} className="mb-4"><h5 className="font-medium">{faq.question}</h5><p className="mt-1 text-slate-500 dark:text-slate-400">{faq.answer}</p></article>) : <p>Chưa có FAQ trong bản ghi này.</p>}</div>
        <details className="rounded-lg border border-slate-200 p-3 dark:border-slate-700"><summary className="cursor-pointer text-xs font-medium">Schema JSON-LD</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap break-words font-mono text-xs">{product.aeoJsonLd?.value || "Chưa có schema trong bản ghi này."}</pre></details>
      </section>}
      {section === 3 && <ReviewSourceComparison product={product} />}
    </div>
  </div>;
}
