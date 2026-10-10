import { useCallback, useEffect, useRef, useState } from "react";

import { readSeoReviewListPage } from "../../shared/seo-review-list";

import type { AmazonCrawlerReviewClient } from "../../modules/amazon-crawler";
import type { CustomGptClient } from "../../modules/custom-gpt-seo";
import type { SeoReviewListPage, SeoReviewListQuery } from "../../shared/seo-review-list";

import { mergeReviewCatalogPages } from "./review-catalog";
import type { ReviewOffsets } from "./review-catalog";

type Catalog = ReturnType<typeof mergeReviewCatalogPages>;
const EMPTY_OFFSETS: ReviewOffsets = { gpt: 0, crawler: 0, auto_seo: 0 };
const cache = new Map<string, { savedAt: number; catalog: Catalog }>();

export function useReviewCatalog(options: {
  enabled: boolean; query: SeoReviewListQuery; source: string; gpt: CustomGptClient; crawler?: AmazonCrawlerReviewClient;
}) {
  const { enabled, query, source, gpt, crawler } = options;
  const [history, setHistory] = useState<readonly ReviewOffsets[]>([EMPTY_OFFSETS]);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState(query.search ?? "");
  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.search ?? ""), 200);
    return () => clearTimeout(timer);
  }, [query.search]);
  const generation = useRef(0);
  const identity = JSON.stringify([query.storeId, search, query.decision, source]);
  const [activeIdentity, setActiveIdentity] = useState(identity);
  const offsets = history[history.length - 1] ?? EMPTY_OFFSETS;
  const refresh = useCallback(() => { cache.clear(); setRevision(value => value + 1); }, []);

  useEffect(() => {
    if (identity === activeIdentity) return;
    generation.current += 1;
    setActiveIdentity(identity); setHistory([EMPTY_OFFSETS]); setCatalog(null); setError(null);
  }, [identity, activeIdentity]);

  useEffect(() => {
    if (!enabled || identity !== activeIdentity) return;
    const controller = new AbortController();
    const currentGeneration = ++generation.current;
    const key = JSON.stringify([identity, offsets]);
    const cached = cache.get(key);
    const isWarm = cached !== undefined && Date.now() - cached.savedAt < 30_000;
    if (isWarm) setCatalog(cached.catalog);
    setIsLoading(!isWarm); setError(null);
    const request = { ...query, search, limit: 50, signal: controller.signal };
    const pages: Partial<Record<keyof ReviewOffsets, SeoReviewListPage>> = {};
    async function load(): Promise<void> {
      await Promise.all([
        (async () => { if (source !== "all" && source !== "auto_seo") return;
          pages.gpt = await gpt.reviewList({ ...request, offset: offsets.gpt }); })(),
        (async () => { if (source !== "all" && source !== "auto_seo") return;
          const parameters = new URLSearchParams({ source: "auto_seo", view: "summary", storeId: query.storeId, limit: "50", offset: String(offsets.auto_seo) });
          if (search) parameters.set("search", search);
          if (query.decision) parameters.set("decision", query.decision);
          const response = await fetch(`/api/seo-review/items?${parameters}`, { signal: controller.signal });
          if (!response.ok) throw new Error(`Không tải được danh sách Auto SEO (${response.status}).`);
          pages.auto_seo = readSeoReviewListPage(await response.json(), query.storeId); })(),
        (async () => { if ((source !== "all" && source !== "distributed_crawler") || !crawler?.catalog) return;
          const page = await crawler.catalog({ ...request, offset: offsets.crawler });
          pages.crawler = { ...page, items: page.items.map(item => ({ ...item, thumbnailUrl: item.thumbnailToken ? crawler.imageUrl(item.thumbnailToken) : item.thumbnailUrl })) }; })(),
      ]);
      if (controller.signal.aborted || generation.current !== currentGeneration) return;
      const merged = mergeReviewCatalogPages(pages, offsets);
      cache.set(key, { savedAt: Date.now(), catalog: merged });
      if (cache.size > 20) cache.delete(cache.keys().next().value ?? "");
      setCatalog(merged);
    }
    void load().catch((cause: unknown) => {
      if (!controller.signal.aborted && generation.current === currentGeneration) setError(cause instanceof Error ? cause.message : "Không tải được Review.");
    }).finally(() => { if (!controller.signal.aborted && generation.current === currentGeneration) setIsLoading(false); });
    return () => controller.abort();
  }, [enabled, identity, activeIdentity, offsets, revision, gpt, crawler]);

  useEffect(() => {
    if (!enabled) return;
    return crawler?.subscribeCatalog?.(query.storeId, refresh);
  }, [enabled, crawler, query.storeId, refresh]);

  useEffect(() => {
    if (!enabled) return;
    // GPT and legacy reviews do not emit Coordinator events. Revalidate only a small page, not full backups.
    const timer = setInterval(() => { if (document.visibilityState !== "hidden") refresh(); }, 15_000);
    const onVisible = () => { if (document.visibilityState !== "hidden") refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("ffp-review-changed", refresh);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("ffp-review-changed", refresh); };
  }, [enabled, refresh]);

  return { catalog: identity === activeIdentity ? catalog : null, isLoading, error, refresh,
    page: history.length, hasPreviousPage: history.length > 1,
    next: () => { if (catalog?.hasNextPage) { setCatalog(null); setHistory(current => [...current, catalog.nextOffsets]); } },
    previous: () => { if (history.length > 1) { setCatalog(null); setHistory(current => current.slice(0, -1)); } },
  };
}
