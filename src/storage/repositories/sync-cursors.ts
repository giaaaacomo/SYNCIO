import type { D1DatabaseLike } from "../d1.js";

export async function getSyncCursor(db: D1DatabaseLike, userId: string, key: string): Promise<number> {
  const row = await db.prepare(
    "SELECT cursor_value FROM sync_cursors WHERE user_id = ? AND cursor_key = ?"
  ).bind(userId, key).first<{ cursor_value?: unknown }>();
  return typeof row?.cursor_value === "number" && Number.isInteger(row.cursor_value) && row.cursor_value >= 0
    ? row.cursor_value
    : 0;
}

export async function setSyncCursor(
  db: D1DatabaseLike,
  userId: string,
  key: string,
  value: number,
  updatedAt = new Date().toISOString()
): Promise<void> {
  if (!Number.isInteger(value) || value < 0) throw new Error("Sync cursor must be a non-negative integer.");
  await db.prepare(`INSERT INTO sync_cursors (user_id, cursor_key, cursor_value, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id, cursor_key) DO UPDATE SET
      cursor_value = excluded.cursor_value,
      updated_at = excluded.updated_at`)
    .bind(userId, key, value, updatedAt)
    .run();
}
