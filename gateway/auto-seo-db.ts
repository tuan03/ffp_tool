import mysql from "mysql2/promise";
import type { Pool, PoolOptions } from "mysql2/promise";

import { loadLocalEnv } from "./store-config-loader";

export interface AutoSeoDbConfig {
  readonly host?: string;
  readonly port?: number;
  readonly user?: string;
  readonly password?: string;
  readonly database?: string;
}

let activePool: Pool | null = null;

export function resolveAutoSeoDbConfig(overrides?: AutoSeoDbConfig): PoolOptions {
  const localEnv = loadLocalEnv();
  const getEnv = (key: string): string | undefined => {
    return process.env[key] ?? localEnv[key];
  };

  const host = overrides?.host ?? getEnv("AUTO_SEO_DB_HOST") ?? "127.0.0.1";
  const portStr = overrides?.port ? String(overrides.port) : getEnv("AUTO_SEO_DB_PORT") ?? "3306";
  const port = Number.parseInt(portStr, 10) || 3306;
  const user = overrides?.user ?? getEnv("AUTO_SEO_DB_USER") ?? "root";
  const password = overrides?.password ?? getEnv("AUTO_SEO_DB_PASSWORD") ?? "";
  const database = overrides?.database ?? getEnv("AUTO_SEO_DB_NAME") ?? "dtb_seo_product";

  return {
    host,
    port,
    user,
    password,
    database,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
  };
}

export function getAutoSeoDbPool(config?: AutoSeoDbConfig): Pool {
  if (activePool) {
    return activePool;
  }
  const poolConfig = resolveAutoSeoDbConfig(config);
  activePool = mysql.createPool(poolConfig);
  return activePool;
}

export function setAutoSeoDbPool(pool: Pool | null): void {
  activePool = pool;
}

export async function closeAutoSeoDbPool(): Promise<void> {
  if (activePool) {
    await activePool.end();
    activePool = null;
  }
}
