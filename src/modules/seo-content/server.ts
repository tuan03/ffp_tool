import { Pool } from "pg";

import { SeoCheckpointManager } from "./internal/checkpoint/checkpoint-manager";
import { PostgresSeoCheckpointStore } from "./internal/checkpoint/postgres-checkpoint-store";
import { PostgresSeoConflictCorpus } from "./internal/conflict-control/postgres-seo-conflict-corpus";
import type { SeoConflictCorpus } from "./internal/conflict-control/seo-conflict-corpus";
import {
  importSeoContentLegacyData,
  PostgresSeoCompletionRepository,
  PostgresSeoProviderCircuitRepository,
  PostgresSeoResultCache,
  runSeoContentMigrations,
} from "./internal/persistence";
import type { SeoLegacyImportOptions } from "./internal/persistence";
import { PostgresSiteNicheCache } from "./internal/site-niche/postgres-site-niche-cache";
import { createServerSiteNicheResolver } from "./internal/site-niche/site-niche-runtime";
import { SeoProviderCircuitBreaker } from "./internal/providers/seo-provider-circuit-breaker";

export interface PostgresSeoContentRuntimeOptions {
  readonly databaseUrl: string;
  readonly legacyImport?: SeoLegacyImportOptions | false;
}

/** Server-only dependencies. Startup fails if PostgreSQL or its schema is unavailable. */
export class PostgresSeoContentRuntime {
  public readonly checkpointStore: PostgresSeoCheckpointStore;
  public readonly checkpointManager: SeoCheckpointManager;
  public readonly resultCache: PostgresSeoResultCache;
  public readonly completion: PostgresSeoCompletionRepository;
  public readonly providerCircuits: PostgresSeoProviderCircuitRepository;
  public readonly providerCircuitBreaker: SeoProviderCircuitBreaker;
  public readonly siteNicheResolver;

  private constructor(private readonly pool: Pool) {
    this.checkpointStore = new PostgresSeoCheckpointStore(pool);
    this.checkpointManager = new SeoCheckpointManager({ store: this.checkpointStore });
    this.resultCache = new PostgresSeoResultCache(pool);
    this.completion = new PostgresSeoCompletionRepository(pool);
    this.providerCircuits = new PostgresSeoProviderCircuitRepository(pool);
    this.providerCircuitBreaker = new SeoProviderCircuitBreaker(this.providerCircuits);
    this.siteNicheResolver = createServerSiteNicheResolver(new PostgresSiteNicheCache(pool));
  }

  public static async create(options: PostgresSeoContentRuntimeOptions): Promise<PostgresSeoContentRuntime> {
    const databaseUrl = options.databaseUrl.trim().replace(/^postgresql\+psycopg:/i, "postgresql:");
    if (!databaseUrl) throw new Error("DATABASE_URL is required for the SEO Content server runtime");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      await pool.query("SELECT 1");
      await runSeoContentMigrations(pool);
      if (options.legacyImport !== false) {
        await importSeoContentLegacyData(pool, options.legacyImport);
      }
      return new PostgresSeoContentRuntime(pool);
    } catch (error) {
      await pool.end().catch(() => undefined);
      throw new Error("SEO Content PostgreSQL initialization failed", { cause: error });
    }
  }

  public conflictCorpus(storeId?: string): SeoConflictCorpus {
    return new PostgresSeoConflictCorpus(this.pool, { storeId });
  }

  public async close(): Promise<void> {
    await this.pool.end();
  }
}

export {
  PostgresSeoCompletionRepository,
  PostgresSeoProviderCircuitRepository,
  PostgresSeoResultCache,
};
export type { CompleteSeoRunParams, SeoPipelineRunRecord } from "./internal/persistence";
