import { z } from "zod";

import { parseSeoPerformanceEnvironment } from "../../src/config/seo-performance-environment";
import { createPerformanceRevision } from "../../src/modules/orchestrator";
import { fromAutoSeoProduct } from "../../src/modules/seo-content";
import type { GatewayDispatcher } from "../dispatcher";
import { loadLocalEnv } from "../store-config-loader";
import type { SeoQueue } from "../custom-gpt-seo/queue-contract";
import { GoogleSearchClient } from "./google-client";
import { PerformanceRepository } from "./repository";
import { PerformanceService } from "./service";
import { PerformanceWorker } from "./worker";

let runtime: { service: PerformanceService; close: () => Promise<void> } | undefined;
export function getPerformanceService(): PerformanceService | undefined { return runtime?.service; }
export function configurePerformanceRuntime(dispatcher: GatewayDispatcher, queue: () => SeoQueue): void {
  const config = parseSeoPerformanceEnvironment({ ...loadLocalEnv(), ...process.env });
  if (!config.enabled || !config.databaseUrl || runtime) return;
  const repository = new PerformanceRepository(config.databaseUrl);
  const google = new GoogleSearchClient(repository.pool, config);
  const record = z.record(z.string(), z.unknown());
  async function read(storeId: string, operation: string, payload: Record<string, unknown>): Promise<unknown> {
    const response = await dispatcher.dispatch({ storeId, operation, payload });
    if (!response.success) throw new Error("SHOPIFY_SOURCE_UNAVAILABLE");
    return response.data;
  }
  const source = {
    products: async (storeId: string, cursor?: string) => {
      const response = z.object({ products: z.array(record), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().optional() }) }).parse(await read(storeId, "products.list", { limit: 100, cursor }));
      if (response.pageInfo.hasNextPage && !response.pageInfo.endCursor) throw new Error("SHOPIFY_CURSOR_REQUIRED");
      return { products: response.products, cursor: response.pageInfo.hasNextPage ? response.pageInfo.endCursor ?? null : null };
    },
    product: async (storeId: string, id: string) => z.object({ product: record }).parse(await read(storeId, "products.get", { id })).product,
    summary: async (storeId: string, id: string) => {
      const latest = await queue().findLatestSourceJob(storeId, "auto_seo", id);
      if (!latest?.result || typeof latest.result !== "object") return undefined;
      const result = z.object({ output: z.object({ aeo_quick_summary: z.string().optional() }).passthrough() }).safeParse(latest.result);
      return result.success ? result.data.output.aeo_quick_summary : undefined;
    },
  };
  const bridge = {
    settings: async (storeId: string) => queue().settings(storeId),
    syncState: async (storeId: string, jobId: string) => queue().syncState(storeId, jobId),
    revise: (request: Parameters<typeof createPerformanceRevision>[0]) => createPerformanceRevision(request, { loadProduct: source.product, prepareInput: fromAutoSeoProduct, settings: async storeId => queue().settings(storeId), enqueue: async input => queue().enqueue(input) }),
  };
  const service = new PerformanceService(repository, google, bridge);
  const worker = new PerformanceWorker(repository, google, source);
  let running = false; let ticks = 0; let lastFailureLog = 0;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void (async () => {
      try { await worker.tick(); if (++ticks % 60 === 0) await service.reconcileApplied(); }
      catch { if (Date.now() - lastFailureLog > 60000) { lastFailureLog = Date.now(); console.error("[SEO Performance] Background task unavailable; core SEO remains online."); } }
      finally { running = false; }
    })();
  }, 2000);
  timer.unref();
  runtime = { service, close: async () => { clearInterval(timer); await repository.pool.end(); runtime = undefined; } };
}
export async function closePerformanceRuntime(): Promise<void> { await runtime?.close(); }
