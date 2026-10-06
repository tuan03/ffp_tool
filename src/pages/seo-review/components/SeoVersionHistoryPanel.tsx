import { useCallback, useEffect, useState } from "react";

import type { CustomGptClient, ProductSeoVersionDto, SeoProductLifecycleDto, SeoVersionDiffDto, SeoVersionDiffValueDto } from "../../../modules/custom-gpt-seo";

import { sanitizeHtmlDescription } from "../sanitize-html";

interface SeoVersionHistoryPanelProps {
  readonly client: CustomGptClient;
  readonly storeId: string;
  readonly productGid: string;
}

export function formatSeoDiffValue(value: SeoVersionDiffValueDto): string {
  if (value.presence === "MISSING") return "(missing)";
  if (value.value === null) return "(null)";
  if (value.value === "") return "(empty)";
  return String(value.value);
}

export function isShopifyProductGid(value: string): boolean {
  return /^gid:\/\/shopify\/Product\/\d+$/.test(value);
}

export function SeoVersionHistoryPanel({ client, storeId, productGid }: SeoVersionHistoryPanelProps): React.JSX.Element {
  const [lifecycle, setLifecycle] = useState<SeoProductLifecycleDto | null>(null);
  const [versions, setVersions] = useState<readonly ProductSeoVersionDto[]>([]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [diff, setDiff] = useState<SeoVersionDiffDto | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async (offset = 0) => {
    setIsLoading(true);
    setMessage(null);
    try {
      const nextLifecycle = await client.seoVersionLifecycle(storeId, productGid);
      setLifecycle(nextLifecycle);
      if (!nextLifecycle.flags.readEnabled) {
        setVersions([]);
        setNextOffset(null);
        return;
      }
      const page = await client.seoVersionHistory(storeId, productGid, 10, offset);
      setVersions(current => offset === 0 ? page.entries : [...current, ...page.entries]);
      setNextOffset(page.nextOffset);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không tải được lịch sử SEO.");
    } finally {
      setIsLoading(false);
    }
  }, [client, productGid, storeId]);

  useEffect(() => {
    setLifecycle(null);
    setVersions([]);
    setDiff(null);
    void load();
  }, [load]);

  async function handleCompare(version: ProductSeoVersionDto): Promise<void> {
    const current = lifecycle?.current?.currentVersion;
    if (!current || current.id === version.id) { setDiff(null); return; }
    setMessage(null);
    try {
      setDiff(await client.seoVersionDiff(storeId, productGid, version.id, current.id));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không tải được diff."); }
  }

  async function handleRefresh(): Promise<void> {
    setMessage(null);
    try { await client.refreshSeoBaseline(storeId, productGid); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Không refresh được baseline."); }
  }

  async function handleRollback(version: ProductSeoVersionDto): Promise<void> {
    setMessage(null);
    try {
      await client.requestSeoRollbackDraft(storeId, productGid, version.id, crypto.randomUUID());
      setMessage(`Đã tạo yêu cầu rollback về v${version.versionNumber}. Yêu cầu vẫn cần được duyệt và publish.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Không tạo được rollback draft."); }
  }

  const readReason = lifecycle?.capabilities.baselineRefresh.reasonCode;
  return <section className="rounded-xl border border-slate-700 bg-slate-950/50 p-4" aria-label="Lịch sử phiên bản SEO">
    <div className="flex items-center justify-between gap-3">
      <div>
        <h3 className="text-sm font-bold text-slate-200">SEO version history</h3>
        <p className="mt-1 text-xs text-slate-400">
          {lifecycle?.current ? `Current v${lifecycle.current.currentVersion.versionNumber} · ${lifecycle.current.state}` : "Chưa có baseline"}
        </p>
      </div>
      <button type="button" onClick={() => void handleRefresh()} disabled={!lifecycle?.capabilities.baselineRefresh.enabled || isLoading}
        title={readReason ?? undefined} className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 disabled:opacity-50">Refresh baseline</button>
    </div>
    {lifecycle?.current?.hasExternalChanges && <p role="status" className="mt-3 rounded bg-amber-950/50 p-2 text-xs text-amber-300">Shopify có thay đổi ngoài FFP; rollback bị khóa đến khi đối chiếu xong.</p>}
    {isLoading && <p role="status" className="mt-3 text-xs text-slate-400">Đang tải lịch sử…</p>}
    {message && <p role="alert" className="mt-3 text-xs text-amber-300">{message}</p>}
    {!isLoading && lifecycle?.flags.readEnabled && versions.length === 0 && <p className="mt-3 text-xs text-slate-500">Chưa có phiên bản.</p>}
    <div className="mt-3 space-y-2">
      {versions.map(version => <div key={version.id} className="flex items-center justify-between rounded border border-slate-800 p-2 text-xs">
        <div><span className="font-semibold text-cyan-300">v{version.versionNumber}</span><span className="ml-2 text-slate-400">{version.source} · {new Date(version.appliedAt).toLocaleString()}</span></div>
        <div className="flex gap-2">
          <button type="button" onClick={() => void handleCompare(version)} className="text-cyan-300">Diff</button>
          {version.id !== lifecycle?.current?.currentVersion.id && <button type="button" onClick={() => void handleRollback(version)}
            disabled={!lifecycle?.capabilities.rollbackDraft.enabled} title={lifecycle?.capabilities.rollbackDraft.reasonCode ?? undefined}
            className="text-amber-300 disabled:opacity-40">Rollback draft</button>}
        </div>
      </div>)}
    </div>
    {nextOffset !== null && <button type="button" disabled={isLoading} onClick={() => void load(nextOffset)} className="mt-3 text-xs text-cyan-300">Tải thêm</button>}
    {diff && <div className="mt-4 rounded border border-slate-800 p-3 text-xs">
      <p className="font-semibold text-slate-200">Diff v{diff.fromVersion.versionNumber} → v{diff.toVersion.versionNumber}</p>
      {!diff.hasChanges && <p className="mt-2 text-slate-500">Không có thay đổi.</p>}
      {diff.fields.map(field => <div key={field.field} className="mt-2">
        <p className="font-mono text-slate-400">{field.field}</p>
        {field.field === "descriptionHtml" ? <div className="grid gap-2 sm:grid-cols-2">
          {[field.before, field.after].map((value, index) => <div key={index} className="prose prose-invert prose-xs max-w-none rounded bg-slate-900 p-2"
            dangerouslySetInnerHTML={{ __html: sanitizeHtmlDescription(formatSeoDiffValue(value)) }} />)}
        </div> : <p className="break-words text-slate-300">{formatSeoDiffValue(field.before)} → {formatSeoDiffValue(field.after)}</p>}
      </div>)}
      {diff.images.map(image => <p key={image.mediaGid} className="mt-2 break-all text-slate-300">{image.change}: {image.mediaGid}</p>)}
    </div>}
  </section>;
}
