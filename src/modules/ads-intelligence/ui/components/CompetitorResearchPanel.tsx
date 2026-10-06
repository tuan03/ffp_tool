import { useEffect, useState } from "react";

import type { AdsIntelligenceClient, CompetitorResearch } from "../../types";

export function CompetitorResearchPanel({ storeId, client }: {
  readonly storeId: string;
  readonly client: AdsIntelligenceClient;
}): React.JSX.Element {
  const [research, setResearch] = useState<CompetitorResearch | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let isDisposed = false;
    let isFetching = false;
    setResearch(null);
    setIsLoading(true);
    const refresh = async () => {
      if (isFetching) return;
      isFetching = true;
      try {
        const response = await client.getCompetitorResearch?.(storeId);
        if (!isDisposed) {
          if (response?.research && response.research.storeId !== storeId) throw new Error("Kết quả không thuộc cửa hàng đang chọn.");
          setResearch(response?.research ?? null);
          setError(null);
        }
      } catch {
        if (!isDisposed) setError("Chưa tải được nghiên cứu. Kiểm tra kết nối backend rồi thử lại.");
      } finally {
        isFetching = false;
        if (!isDisposed) setIsLoading(false);
      }
    };
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 15000);
    return () => { isDisposed = true; window.clearInterval(timer); };
  }, [client, storeId, revision]);

  return (
    <section aria-label="Đối thủ đã xác minh" className="space-y-4 rounded-2xl border border-cyan-900 bg-slate-900/70 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-100">Đối thủ đã xác minh {research ? `(${research.selected.length})` : ""}</h3>
          <p className="text-xs text-slate-400">Kết quả nghiên cứu theo sản phẩm · tự cập nhật mỗi 15 giây</p>
        </div>
        <button type="button" onClick={() => setRevision(value => value + 1)} className="rounded-lg border border-slate-600 px-3 py-2 text-xs text-cyan-200">Tải lại nghiên cứu</button>
      </div>
      {isLoading && <p role="status" className="text-sm text-slate-400">Đang tải nghiên cứu…</p>}
      {error && <p role="alert" className="text-sm text-amber-300">{error}{research ? " Đang hiển thị bản đã tải trước đó." : ""}</p>}
      {!isLoading && !error && !research && <p className="text-sm text-slate-400">Store này chưa có nghiên cứu được lưu. Bấm &quot;Spy đối thủ&quot; ở phía trên để AI tự động tìm kiếm đối thủ và xuất bản kết quả.</p>}
      {research && <>
        <p className="text-sm text-slate-300">{research.storeDomain} · {research.scope.market} · {new Date(research.observedAt).toLocaleString("vi-VN")}</p>
        <p className="text-xs text-slate-400">Phạm vi: {research.scope.products.join(", ")}. Điểm tương đồng sản phẩm, không phải hiệu quả quảng cáo.</p>
        {research.selected.length === 0 && <p className="text-sm text-amber-300">Nghiên cứu đã lưu nhưng chưa có đối thủ đạt điều kiện.</p>}
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {research.selected.map(candidate => <article key={candidate.domain} className="space-y-3 rounded-xl border border-slate-700 bg-slate-950/60 p-4">
            <div className="flex items-start justify-between gap-2"><h4 className="font-semibold text-slate-100">{candidate.name}</h4><span className="text-cyan-300">{candidate.score}/100</span></div>
            <p className="text-xs text-slate-400">{candidate.domain} · {candidate.productGroup} · Tin cậy {candidate.confidence === "high" ? "cao" : "trung bình"}</p>
            <p className="text-xs text-slate-300">{candidate.evidence[0]?.note}</p>
            <p className="text-xs text-amber-200">Quảng cáo: {candidate.adStatus}</p>
            <details className="text-xs text-slate-400"><summary className="cursor-pointer text-cyan-200">Điểm chi tiết và nguồn bằng chứng</summary>
              <p className="my-2">Sản phẩm {candidate.scoreBreakdown.product}/40 · Cá nhân hóa {candidate.scoreBreakdown.customizationModel}/20 · Người mua {candidate.scoreBreakdown.audience}/15 · Giá {candidate.scoreBreakdown.price}/15 · Chủ đề {candidate.scoreBreakdown.themes}/10</p>
              <ul className="space-y-2">{candidate.evidence.map((source, index) => <li key={source.url}><a className="text-cyan-300 underline" href={source.url} target="_blank" rel="noreferrer">Nguồn {index + 1}</a> — {source.note}</li>)}</ul>
            </details>
          </article>)}
        </div>
        {research.adCollection && <details open className="text-sm text-slate-300"><summary className="cursor-pointer text-cyan-200">Kết quả thu thập quảng cáo theo thương hiệu</summary><ul className="mt-3 space-y-3">{research.adCollection.map(collection => <li key={collection.brandDomain} className="rounded-lg border border-slate-700 p-3"><strong>{collection.brandDomain}</strong><p className="text-xs text-slate-400">{collection.retrievedCount} mẫu thu thập · {collection.matchedCount} mẫu được chọn và xác minh</p><p className="text-xs">{collection.note}</p></li>)}</ul></details>}
        {research.adInsights && research.adInsights.length > 0 && <details open className="text-sm text-slate-300"><summary className="cursor-pointer text-cyan-200">Phân tích từ quảng cáo đã kiểm tra</summary><ul className="mt-3 space-y-3">{research.adInsights.map(insight => <li key={insight.title}><strong>{insight.title}</strong><p>{insight.observation}</p><p className="text-cyan-100">Ý tưởng riêng để thử: {insight.originalTest}</p><div className="flex flex-wrap gap-3 text-xs">{insight.sourceAdIds.map(id => <a key={id} href={`https://www.facebook.com/ads/library/?id=${id}`} target="_blank" rel="noreferrer" className="text-cyan-300 underline">Ads {id}</a>)}</div></li>)}</ul></details>}
        {research.websiteDerivedHypotheses.length > 0 && <details className="text-sm text-slate-300"><summary className="cursor-pointer text-cyan-200">Ý tưởng thử nghiệm từ website — chưa xác minh bằng quảng cáo</summary><ul className="mt-3 space-y-3">{research.websiteDerivedHypotheses.map(idea => <li key={idea.title}><strong>{idea.title}</strong><p>{idea.hypothesis}</p><p className="text-xs text-slate-400">Cơ sở: {idea.basis}</p></li>)}</ul></details>}
        {research.limitations.length > 0 && <details className="text-xs text-slate-400"><summary className="cursor-pointer">Giới hạn dữ liệu</summary><ul className="mt-2 list-disc space-y-1 pl-5">{research.limitations.map(note => <li key={note}>{note}</li>)}</ul></details>}
      </>}
    </section>
  );
}
