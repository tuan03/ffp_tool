import type { Pool } from "pg";

import { queryOne } from "../persistence/postgres";
import type { SiteNicheCache } from "./site-niche-resolver";

/** PostgreSQL cache preserving the existing 24-hour niche-cache behavior. */
export class PostgresSiteNicheCache implements SiteNicheCache {
  public constructor(
    private readonly pool: Pool,
    private readonly ttlMs: number = 24 * 60 * 60 * 1000,
  ) {}

  public async get(domain: string): Promise<string | undefined> {
    const row = await queryOne<{ niche: string }>(this.pool,
      "SELECT niche FROM seo_site_niche_cache WHERE domain=$1 AND expires_at>NOW()", [domain]);
    return row?.niche;
  }

  public async set(domain: string, niche: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO seo_site_niche_cache(domain,niche,expires_at)
       VALUES($1,$2,$3) ON CONFLICT(domain) DO UPDATE SET
       niche=EXCLUDED.niche,expires_at=EXCLUDED.expires_at,updated_at=NOW()`,
      [domain, niche, new Date(Date.now() + this.ttlMs)],
    );
  }

  public async pruneExpired(): Promise<number> {
    const result = await this.pool.query("DELETE FROM seo_site_niche_cache WHERE expires_at<=NOW()");
    return result.rowCount ?? 0;
  }
}
