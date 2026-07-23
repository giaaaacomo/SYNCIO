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
  await recordAppliedChanges(db, [input], appliedAt);
}

export async function recordAppliedChanges(
  db: D1DatabaseLike,
  inputs: Array<{
    key: string;
    userId: string;
    direction: string;
    kind: string;
    summary: string;
  }>,
  appliedAt = new Date().toISOString()
): Promise<void> {
  if (inputs.length === 0) return;
  await db.prepare(`WITH entries AS (
    SELECT value FROM json_each(?)
  )
  INSERT INTO change_ledger (
    key, user_id, direction, kind, summary, first_applied_at, last_applied_at, applied_count
  )
  SELECT
    json_extract(value, '$.key'),
    json_extract(value, '$.userId'),
    json_extract(value, '$.direction'),
    json_extract(value, '$.kind'),
    json_extract(value, '$.summary'),
    ?, ?, 1
  FROM entries
  WHERE true
  ON CONFLICT(key) DO UPDATE SET
    summary = excluded.summary,
    last_applied_at = excluded.last_applied_at,
    applied_count = change_ledger.applied_count + 1`)
    .bind(
      JSON.stringify(inputs),
      appliedAt,
      appliedAt
    )
    .run();
}
