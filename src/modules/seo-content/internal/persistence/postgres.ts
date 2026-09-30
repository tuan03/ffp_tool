import type { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

export type SeoPostgresExecutor = Pick<Pool | PoolClient, "query">;

export async function queryRows<T extends QueryResultRow>(
  executor: SeoPostgresExecutor,
  text: string,
  values: readonly unknown[] = [],
): Promise<readonly T[]> {
  const result = await executor.query<T>(text, [...values]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  executor: SeoPostgresExecutor,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await queryRows<T>(executor, text, values);
  return rows[0];
}

export async function withSeoTransaction<T>(
  pool: Pool,
  operation: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await operation(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function toDateMilliseconds(value: Date | string | number): number {
  if (typeof value === "number") return value;
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("PostgreSQL returned an invalid timestamp");
  return parsed;
}

export function asJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type SeoQueryResult<T extends QueryResultRow> = QueryResult<T>;
