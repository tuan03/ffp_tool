import { useEffect, useState } from "react";

import { encodeProductFile } from "../service";
import type { ReviewImageClient, ReviewImageJob, ReviewImageScope } from "../types";

const DEFAULT_PROMPT = `Create one photorealistic customer review photo by editing the two attached images.

Image 1 is the SCENE TEMPLATE, not the product to keep. Preserve its room, furniture, bedding, camera angle, perspective and natural lighting. Completely remove the original bag or wallet from Image 1, then reconstruct any background it covered.

Image 2 is the PRODUCT REFERENCE. Place the selected handbag (and matching wallet only when requested) into the cleared location in Image 1. Preserve the product's silhouette, handles, material, hardware, artwork, colors, printed pattern and readable branding as faithfully as possible. Match the scene's scale, perspective, contact shadows and lighting. Do not duplicate products, invent new graphics or add captions, watermarks or extra text. Return only the finished image.`;

type GenerateMode = "new" | "same" | "different";

export function ReviewImagePage({ client }: { readonly client: ReviewImageClient }): React.JSX.Element {
  const [productDataUrl, setProductDataUrl] = useState("");
  const [productName, setProductName] = useState("");
  const [scope, setScope] = useState<ReviewImageScope>("main");
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [job, setJob] = useState<ReviewImageJob | null>(null);
  const [templateCount, setTemplateCount] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isApproving, setIsApproving] = useState(false);
  const [error, setError] = useState("");
  const [gatewayToken, setGatewayToken] = useState("");
  const [templatePreview, setTemplatePreview] = useState("");
  const [resultPreview, setResultPreview] = useState("");
  const [authRevision, setAuthRevision] = useState(0);

  useEffect(() => {
    let active = true;
    void client.health().then((health) => {
      if (active) setTemplateCount(health.templates);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không kết nối được Review Image Bridge.");
    });
    return () => { active = false; };
  }, [client]);

  useEffect(() => {
    if (!job || (job.status !== "queued" && job.status !== "running")) return;
    let active = true;
    let timer: number | undefined;
    const poll = async (): Promise<void> => {
      try {
        const nextJob = await client.job(job.job_id);
        if (!active) return;
        setJob(nextJob);
        if (nextJob.status === "queued" || nextJob.status === "running") {
          timer = window.setTimeout(() => { void poll(); }, 2_000);
        }
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Không tải được trạng thái tạo ảnh.");
      }
    };
    timer = window.setTimeout(() => { void poll(); }, 1_500);
    return () => { active = false; if (timer !== undefined) window.clearTimeout(timer); };
  }, [client, job]);

  useEffect(() => {
    if (!job) return;
    let active = true;
    let objectUrl = "";
    setTemplatePreview("");
    void client.template(job.template_name).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setTemplatePreview(objectUrl);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được ảnh template.");
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, job?.template_name, authRevision]);

  useEffect(() => {
    if (!job || job.status !== "completed") return;
    let active = true;
    let objectUrl = "";
    setResultPreview("");
    void client.image(job.job_id).then((blob) => {
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setResultPreview(objectUrl);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Không tải được ảnh review.");
    });
    return () => { active = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [client, job?.job_id, job?.status, authRevision]);

  async function applyGatewayToken(): Promise<void> {
    client.setGatewayToken(gatewayToken);
    setError("");
    try {
      const health = await client.health();
      setTemplateCount(health.templates);
      setAuthRevision((value) => value + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Gateway token không hợp lệ.");
    }
  }

  async function handleDownload(): Promise<void> {
    if (!job?.approved) return;
    try {
      const blob = await client.download(job.job_id);
      const extension = blob.type === "image/jpeg" ? ".jpg" : blob.type === "image/webp" ? ".webp" : ".png";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `review-${job.job_id}${extension}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không tải được ảnh đã duyệt.");
    }
  }

  async function handleProductChange(file: File | undefined): Promise<void> {
    setProductDataUrl("");
    setProductName("");
    setError("");
    if (!file) return;
    try {
      const dataUrl = await encodeProductFile(file);
      setProductDataUrl(dataUrl);
      setProductName(file.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Ảnh sản phẩm không hợp lệ.");
    }
  }

  async function handleGenerate(mode: GenerateMode): Promise<void> {
    if (!productDataUrl || !prompt.trim()) {
      setError("Hãy chọn ảnh sản phẩm và nhập prompt trước khi tạo.");
      return;
    }
    setError("");
    setIsSubmitting(true);
    try {
      const nextJob = await client.create({
        productDataUrl,
        prompt: prompt.trim(),
        scope,
        ...(mode === "same" && job ? { templateName: job.template_name } : {}),
        ...(mode === "different" && job ? { excludeTemplate: job.template_name } : {}),
      });
      setJob(nextJob);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể bắt đầu tạo ảnh.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleApprove(): Promise<void> {
    if (!job || job.status !== "completed") return;
    setIsApproving(true);
    setError("");
    try {
      setJob(await client.approve(job.job_id));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không thể duyệt ảnh.");
    } finally {
      setIsApproving(false);
    }
  }

  const isGenerating = isSubmitting || job?.status === "queued" || job?.status === "running";
  const canGenerate = Boolean(productDataUrl && prompt.trim() && !isGenerating);
  const canRetry = Boolean(job && !isGenerating);
  const fieldClass = "mt-2 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-slate-100 outline-none focus:border-cyan-500";
  const buttonClass = "rounded-xl px-4 py-2 font-medium transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <main className="mx-auto max-w-6xl space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan-400">FFP Tool / Review Images</p>
        <h1 className="text-3xl font-bold tracking-tight">Tạo ảnh review</h1>
        <p className="text-sm text-slate-300">Lấy bối cảnh từ ảnh template, thay sản phẩm cũ bằng túi hoặc bộ túi–ví của bạn, rồi kiểm tra ảnh trước khi tải.</p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <h2 className="text-lg font-semibold">1. Chuẩn bị ảnh</h2>
            <p className="mt-1 text-sm text-slate-400">Template được chọn ngẫu nhiên từ thư mục của tool. {templateCount === null ? "Đang kiểm tra thư mục…" : `Có ${templateCount} template hợp lệ.`}</p>
          </div>

          <details className="rounded-xl border border-slate-700 p-3 text-sm">
            <summary className="cursor-pointer text-slate-300">Gateway token (chỉ cần khi server yêu cầu đăng nhập API)</summary>
            <div className="mt-2 flex gap-2">
              <input className={fieldClass} type="password" autoComplete="off" aria-label="Gateway token" value={gatewayToken} onChange={(event) => setGatewayToken(event.target.value)} />
              <button type="button" className={`${buttonClass} bg-slate-700`} onClick={() => { void applyGatewayToken(); }}>Kết nối</button>
            </div>
          </details>

          <label className="block text-sm font-medium">
            Ảnh sản phẩm cần đưa vào bối cảnh
            <input className={fieldClass} type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { void handleProductChange(event.target.files?.[0]); }} />
          </label>
          {productDataUrl && <figure className="rounded-xl border border-slate-700 bg-slate-950 p-3">
            <img className="mx-auto max-h-56 object-contain" src={productDataUrl} alt="Ảnh sản phẩm đã chọn" />
            <figcaption className="mt-2 truncate text-xs text-slate-400">{productName}</figcaption>
          </figure>}

          <label className="block text-sm font-medium">
            Sản phẩm cần xuất hiện trong ảnh review
            <select className={fieldClass} value={scope} onChange={(event) => setScope(event.target.value as ReviewImageScope)}>
              <option value="main">Chỉ túi chính</option>
              <option value="set">Cả túi và ví</option>
            </select>
          </label>

          <label className="block text-sm font-medium">
            Prompt gửi ChatGPT (có thể chỉnh)
            <textarea className={`${fieldClass} min-h-64 resize-y text-sm leading-6`} maxLength={10_000} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          </label>

          <div className="flex flex-wrap gap-3">
            <button type="button" className={`${buttonClass} bg-cyan-500 text-slate-950 hover:bg-cyan-400`} disabled={!canGenerate} onClick={() => { void handleGenerate("new"); }}>Tạo ảnh</button>
            <button type="button" className={`${buttonClass} border border-slate-600 hover:border-cyan-500`} disabled={!canRetry} onClick={() => { void handleGenerate("same"); }}>Tạo lại cùng nền</button>
            <button type="button" className={`${buttonClass} border border-slate-600 hover:border-cyan-500`} disabled={!canRetry} onClick={() => { void handleGenerate("different"); }}>Đổi nền</button>
          </div>
          {error && <p role="alert" className="rounded-xl border border-rose-700 bg-rose-950/40 p-3 text-sm text-rose-200">{error}</p>}
        </section>

        <section className="space-y-5 rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
          <div>
            <h2 className="text-lg font-semibold">2. Kiểm tra kết quả</h2>
            <p className="mt-1 text-sm text-slate-400">Ảnh AI có thể làm sai chữ hoặc hoa văn. Chỉ duyệt khi sản phẩm và bối cảnh đều đúng.</p>
          </div>
          {!job && <div className="flex min-h-64 items-center justify-center rounded-xl border border-dashed border-slate-700 text-center text-sm text-slate-500">Chọn ảnh sản phẩm và bấm Tạo ảnh để bắt đầu.</div>}
          {job && <>
            <p role="status" className="rounded-lg bg-slate-800 px-3 py-2 text-sm">
              {job.status === "queued" && "Đang chờ tab ChatGPT…"}
              {job.status === "running" && "Đang tải ảnh và tạo ảnh review…"}
              {job.status === "completed" && (job.approved ? "Ảnh đã duyệt — sẵn sàng tải." : "Ảnh đã tạo xong — hãy kiểm tra trước khi duyệt.")}
              {job.status === "failed" && `Tạo ảnh thất bại: ${job.error || "Không rõ nguyên nhân."}`}
            </p>
            <figure className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
              {templatePreview && <img className="max-h-56 w-full object-contain" src={templatePreview} alt="Template bối cảnh đã chọn" />}
              <figcaption className="p-3 text-xs text-slate-400">Template: {job.template_name} — chỉ lấy bối cảnh, không giữ sản phẩm cũ.</figcaption>
            </figure>
            {job.status === "completed" && <>
              {resultPreview && <img className="max-h-[36rem] w-full rounded-xl border border-slate-700 bg-slate-950 object-contain" src={resultPreview} alt="Ảnh review đã tạo" />}
              <ul className="list-inside list-disc space-y-1 text-sm text-slate-300">
                <li>Đúng hình dáng, họa tiết và chữ trên túi/ví?</li>
                <li>Sản phẩm cũ trong template đã biến mất?</li>
                <li>Tỉ lệ, ánh sáng và bóng đổ có tự nhiên?</li>
              </ul>
              <div className="flex flex-wrap gap-3">
                <button type="button" className={`${buttonClass} bg-emerald-600 hover:bg-emerald-500`} disabled={job.approved || isApproving} onClick={() => { void handleApprove(); }}>Duyệt ảnh</button>
                {job.approved && <button type="button" className={`${buttonClass} bg-cyan-500 text-slate-950 hover:bg-cyan-400`} onClick={() => { void handleDownload(); }}>Tải ảnh đã duyệt</button>}
              </div>
            </>}
          </>}
        </section>
      </div>
    </main>
  );
}
