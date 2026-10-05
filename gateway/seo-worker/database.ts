export interface WorkerSql {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface WorkerDatabase {
  transaction<T>(operation: (sql: WorkerSql) => Promise<T>): Promise<T>;
}
