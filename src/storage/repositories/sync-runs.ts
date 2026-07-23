import type { D1DatabaseLike } from "../d1.js";

export interface SyncRunSummary {
  id: string;
  mode: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  plannedChanges: number;
  errorMessage: string | null;
}

export async function startSyncRun(
  db: D1DatabaseLike,
  userId: string,
  mode: "scheduled" | "manual",
  startedAt = new Date().toISOString()
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(`INSERT INTO sync_runs (
    id, user_id, mode, status, started_at, planned_changes
  ) VALUES (?, ?, ?, 'running', ?, 0)`)
    .bind(id, userId, mode, startedAt)
    .run();
  return id;
}

export async function finishSyncRun(
  db: D1DatabaseLike,
  id: string,
  status: "succeeded" | "failed" | "skipped",
  plannedChanges: number,
  errorMessage: string | null,
  finishedAt = new Date().toISOString()
): Promise<void> {
  await db.prepare(`UPDATE sync_runs SET
    status = ?, finished_at = ?, planned_changes = ?, error_message = ?
    WHERE id = ?`)
    .bind(status, finishedAt, plannedChanges, errorMessage, id)
    .run();
}

export async function getLatestSyncRun(db: D1DatabaseLike, userId: string): Promise<SyncRunSummary | null> {
  const row = await db.prepare(`SELECT id, mode, status, started_at, finished_at, planned_changes, error_message
    FROM sync_runs WHERE user_id = ? ORDER BY started_at DESC LIMIT 1`)
    .bind(userId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    id: requiredString(row.id, "sync_runs.id"),
    mode: requiredString(row.mode, "sync_runs.mode"),
    status: requiredString(row.status, "sync_runs.status"),
    startedAt: requiredString(row.started_at, "sync_runs.started_at"),
    finishedAt: nullableString(row.finished_at, "sync_runs.finished_at"),
    plannedChanges: requiredInt(row.planned_changes, "sync_runs.planned_changes"),
    errorMessage: nullableString(row.error_message, "sync_runs.error_message")
  };
}

function requiredString(value: unknown, label: string): string {
  if (typeof value === "string" && value.length > 0) return value;
  throw new Error(`${label} must be a non-empty string.`);
}

function nullableString(value: unknown, label: string): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  throw new Error(`${label} must be a string or null.`);
}

function requiredInt(value: unknown, label: string): number {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  throw new Error(`${label} must be an integer.`);
}
