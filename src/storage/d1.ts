export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  run(): Promise<D1ResultLike>;
}

export interface D1ResultLike {
  success: boolean;
  meta?: unknown;
}

export interface StorageStatus {
  d1Binding: "configured" | "missing";
  reachable: boolean;
  tables?: {
    users: number;
    syncRuns: number;
    ledgerEntries: number;
    conflicts: number;
  };
  error?: string;
}

export function isD1Database(value: unknown): value is D1DatabaseLike {
  return Boolean(
    value
    && typeof value === "object"
    && typeof (value as { prepare?: unknown }).prepare === "function"
  );
}

export async function readStorageStatus(db: unknown): Promise<StorageStatus> {
  if (!isD1Database(db)) {
    return {
      d1Binding: "missing",
      reachable: false
    };
  }

  try {
    const [users, syncRuns, ledgerEntries, conflicts] = await Promise.all([
      countRows(db, "users"),
      countRows(db, "sync_runs"),
      countRows(db, "change_ledger"),
      countRows(db, "sync_conflicts")
    ]);
    return {
      d1Binding: "configured",
      reachable: true,
      tables: {
        users,
        syncRuns,
        ledgerEntries,
        conflicts
      }
    };
  } catch (error) {
    return {
      d1Binding: "configured",
      reachable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function countRows(db: D1DatabaseLike, table: string): Promise<number> {
  const row = await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).first<{ count?: unknown }>();
  const count = row?.count;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}
