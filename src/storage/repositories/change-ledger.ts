import type { D1DatabaseLike } from "../d1.js";

export async function recordAppliedChange(
  db: D1DatabaseLike,
  input: {
    key: string;
    userId: string;
    direction: string;
    kind: string;
    summary: string;
  },
  appliedAt = new Date().toISOString()
): Promise<void> {
  await db.prepare(`INSERT INTO change_ledger (
    key, user_id, direction, kind, summary, first_applied_at, last_applied_at, applied_count
  ) VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(key) DO UPDATE SET
    summary = excluded.summary,
    last_applied_at = excluded.last_applied_at,
    applied_count = change_ledger.applied_count + 1`)
    .bind(
      input.key,
      input.userId,
      input.direction,
      input.kind,
      input.summary,
      appliedAt,
      appliedAt
    )
    .run();
}
