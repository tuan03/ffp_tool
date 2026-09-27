import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";

import type { CustomGptClient, GptQueuePage } from "../service";
import type { GptSeoSettings, GptSeoJob } from "../types";

export function CustomGptSeoPage({ client }: { readonly client: CustomGptClient }): React.JSX.Element {
  const [storeId, setStoreId] = useState("capozen");
  const [settings, setSettings] = useState<GptSeoSettings | null>(null);
  const [queue, setQueue] = useState<GptQueuePage | null>(null);
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<GptSeoJob | null>(null);
  const refreshGeneration = useRef(0);
  useEffect(() => {
    let cancelled = false;
    if (!selectedJobId) return;
    void client.job(storeId, selectedJobId).then(job => { if (!cancelled) setSelectedJob(job); }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Không tải được sản phẩm"); });
    return () => { cancelled = true; };
  }, [client, storeId, selectedJobId]);
  const refresh = useCallback(async () => {
    const generation = ++refreshGeneration.current;
    const [nextSettings, nextQueue] = await Promise.all([client.settings(storeId), client.list(storeId, offset)]);
    if (generation !== refreshGeneration.current) return;
    setSettings(nextSettings); setQueue(nextQueue);
    if (selectedJobId) {
      const job = await client.job(storeId, selectedJobId);
      if (generation === refreshGeneration.current) setSelectedJob(job);
    }
  }, [client, storeId, offset, selectedJobId]);
  useEffect(() => { let cancelled = false; setIsBusy(true); void refresh().catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Không tải được queue"); }).finally(() => { if (!cancelled) setIsBusy(false); }); return () => { cancelled = true; }; }, [refresh]);
  async function perform(operation: () => Promise<unknown>): Promise<void> {
    setIsBusy(true); setMessage("");
    try { await operation(); await refresh(); setMessage("Đã lưu."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Thao tác thất bại"); }
    finally { setIsBusy(false); }
  }
  const field = "rounded border border-slate-600 bg-slate-900 px-3 py-2 text-slate-100";
  return <main className="mx-auto max-w-6xl space-y-6 p-6">
    <h1 className="text-2xl font-semibold">GPT SEO — Cấu hình và hàng đợi</h1>
    <p className="text-slate-300">Chọn GPT Custom để giữ sản phẩm chờ xử lý trên ChatGPT. Kết quả được lưu trên server và chuyển sang SEO Review.</p>
    <label className="block">Store <input className={field} value={storeId} onChange={event => { refreshGeneration.current += 1; setStoreId(event.target.value); setOffset(0); setSettings(null); setQueue(null); setSelectedJobId(null); setSelectedJob(null); }} /></label>
    {message && <p role="status" className="rounded bg-slate-800 p-3">{message}</p>}
    {isBusy && <p role="status">Đang tải…</p>}
    {settings && <form className="space-y-4 rounded border border-slate-700 p-4" onSubmit={event => { event.preventDefault(); void perform(() => client.configure(storeId, settings)); }}>
      <label className="block">Provider <select className={field} value={settings.provider} onChange={event => setSettings({ ...settings, provider: event.target.value === "custom_gpt" ? "custom_gpt" : "gemini" })}><option value="gemini">Gemini</option><option value="custom_gpt">GPT Custom</option></select></label>
      <label className="block">Sản phẩm / batch <input className={field} type="number" min={1} max={10} value={settings.batchSize} onChange={event => setSettings({ ...settings, batchSize: Number(event.target.value) })} /></label>
      <label className="block">Ngôn ngữ <input className={field} value={settings.language} onChange={event => setSettings({ ...settings, language: event.target.value })} /></label>
      <label className="block">Quy tắc nội dung <textarea className={`${field} block w-full`} value={settings.instructions} onChange={event => setSettings({ ...settings, instructions: event.target.value })} /></label>
      <p className="text-sm text-slate-400">Đổi provider áp dụng cho sản phẩm mới. Job đã giao cho GPT vẫn được tiếp tục bằng GPT.</p>
      <button type="submit" disabled={isBusy} className="rounded bg-cyan-700 px-4 py-2 disabled:opacity-50">Lưu cấu hình</button>
    </form>}
    <div className="flex flex-wrap gap-4"><button type="button" disabled={isBusy} onClick={() => void perform(refresh)} className={field}>Làm mới</button><Link className={field} to={`/seo-review?storeId=${encodeURIComponent(storeId)}`}>Mở SEO Review</Link></div>
    <p>{Object.entries(queue?.counts || {}).map(([status, count]) => `${status}: ${count}`).join(" · ")}</p>
    {selectedJob && ["PENDING", "WAITING_INPUT", "NEEDS_CHANGES", "FAILED"].includes(selectedJob.status) && <div className="rounded border border-slate-700 p-3"><p>{selectedJob.input.title}: chuyển provider cho riêng job này. Thu hồi batch trước nếu job đang được giữ.</p><button className="p-2 text-cyan-300" type="button" disabled={isBusy} onClick={() => void perform(() => client.transfer(storeId, selectedJob.id, "gemini"))}>Chuyển sang Gemini (có phí API)</button><button className="p-2 text-cyan-300" type="button" disabled={isBusy} onClick={() => void perform(() => client.transfer(storeId, selectedJob.id, "custom_gpt"))}>Chờ GPT Custom</button></div>}
    {queue?.activeBatch && <div className="rounded bg-slate-800 p-4"><p>Batch: {queue.activeBatch.id} — hết hạn {new Date(queue.activeBatch.expiresAt).toLocaleString()}</p><button type="button" disabled={isBusy} onClick={() => void perform(() => client.release(storeId, queue.activeBatch?.id || ""))}>Thu hồi batch chưa hoàn tất</button></div>}
    <div className="overflow-x-auto"><table className="w-full text-left"><thead><tr><th>Sản phẩm</th><th>Nguồn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{queue?.jobs.map(job => <tr key={job.id} className="border-t border-slate-700"><td className="p-3">{job.input.title}</td><td>{job.source}</td><td>{job.status}</td><td><button type="button" onClick={() => setSelectedJobId(job.id)} className="p-2 text-cyan-300">Chi tiết / ảnh</button>{["FAILED", "WAITING_INPUT", "NEEDS_CHANGES"].includes(job.status) && <button type="button" disabled={isBusy} onClick={() => void perform(() => client.retry(storeId, job.id))}>Thử lại</button>}</td></tr>)}</tbody></table></div>
    {queue?.jobs.length === 0 && <p>Chưa có sản phẩm ở trang này.</p>}
    <div className="flex gap-4"><button type="button" disabled={offset === 0 || isBusy} onClick={() => setOffset(Math.max(0, offset - 50))}>Trang trước</button><button type="button" disabled={queue?.jobs.length !== 50 || isBusy} onClick={() => setOffset(offset + 50)}>Trang sau</button></div>
    {selectedJob && <section className="space-y-3 rounded border border-slate-700 p-4"><h2 className="font-semibold">{selectedJob.input.title} — {selectedJob.id}</h2><p>{selectedJob.error}</p><p>Các bước đã lưu: {Object.keys(selectedJob.checkpoints).join(", ") || "chưa có"}</p><p>Nếu GPT không mở ảnh được, tải ảnh và đính kèm vào hội thoại cùng mã ảnh bên dưới.</p><div className="grid grid-cols-2 gap-4 md:grid-cols-4">{selectedJob.input.images.map((image, index) => <a key={image.id || image.url} href={image.url} target="_blank" rel="noreferrer" className="break-all"><img src={image.url} alt={image.alt || `Ảnh ${index + 1}`} loading="lazy" className="h-32 w-full object-contain" />{selectedJob.id}/{image.id || `image-${index + 1}`}</a>)}</div><details><summary>Checkpoint và kết quả</summary><pre className="overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ checkpoints: selectedJob.checkpoints, result: selectedJob.result }, null, 2)}</pre></details></section>}
  </main>;
}
