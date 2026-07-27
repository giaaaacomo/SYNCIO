import type { D1DatabaseLike } from "../d1.js";

const RATING_SNAPSHOT_QUERY_BATCH = 90;

export interface RatingSnapshot {
  mediaKey: string;
  stremioStatus: "liked" | "loved" | null;
  traktRating: number | null;
}

export interface RatingConflict {
  id: string;
  mediaKey: string;
  kind: "rating-movie" | "rating-series";
  previous: RatingSnapshot;
  current: RatingSnapshot;
}

export async function getRatingSnapshots(
  db: D1DatabaseLike,
  userId: string,
  mediaKeys: string[]
): Promise<Map<string, RatingSnapshot>> {
  if (mediaKeys.length === 0) return new Map();
  const snapshots = new Map<string, RatingSnapshot>();
  const uniqueKeys = Array.from(new Set(mediaKeys));
  for (let index = 0; index < uniqueKeys.length; index += RATING_SNAPSHOT_QUERY_BATCH) {
    const batch = uniqueKeys.slice(index, index + RATING_SNAPSHOT_QUERY_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const row = await db.prepare(`SELECT COALESCE(json_group_array(json_object(
        'media_key', media_key,
        'stremio_status', stremio_status,
        'trakt_rating', trakt_rating
      )), '[]') AS rows
      FROM rating_snapshots
      WHERE user_id = ? AND media_key IN (${placeholders})`)
      .bind(userId, ...batch)
      .first<{ rows?: unknown }>();
    for (const value of parseRows(row?.rows)) {
      if (!value || typeof value !== "object" || Array.isArray(value)) continue;
      const item = value as Record<string, unknown>;
      if (typeof item.media_key !== "string") continue;
      snapshots.set(item.media_key, {
        mediaKey: item.media_key,
        stremioStatus: ratingStatus(item.stremio_status),
        traktRating: ratingNumber(item.trakt_rating)
      });
    }
  }
  return snapshots;
}

export async function saveRatingState(
  db: D1DatabaseLike,
  userId: string,
  snapshots: RatingSnapshot[],
  conflicts: RatingConflict[],
  updatedAt = new Date().toISOString()
): Promise<void> {
  const conflictedKeys = new Set(conflicts.map((item) => item.mediaKey));
  for (const conflict of conflicts) {
    await db.prepare(`INSERT INTO sync_conflicts (
        id, user_id, media_key, kind, status, payload_json, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, 'open', ?, ?, NULL)
      ON CONFLICT(id) DO UPDATE SET
        status = 'open',
        payload_json = excluded.payload_json,
        resolved_at = NULL`)
      .bind(
        conflict.id,
        userId,
        conflict.mediaKey,
        conflict.kind,
        JSON.stringify({ previous: conflict.previous, current: conflict.current }),
        updatedAt
      )
      .run();
  }
  for (const snapshot of snapshots) {
    if (conflictedKeys.has(snapshot.mediaKey)) continue;
    await db.prepare(`INSERT INTO rating_snapshots (
        user_id, media_key, stremio_status, trakt_rating, updated_at
      ) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(user_id, media_key) DO UPDATE SET
        stremio_status = excluded.stremio_status,
        trakt_rating = excluded.trakt_rating,
        updated_at = excluded.updated_at`)
      .bind(userId, snapshot.mediaKey, snapshot.stremioStatus, snapshot.traktRating, updatedAt)
      .run();
    await db.prepare(`UPDATE sync_conflicts
      SET status = 'resolved', resolved_at = ?
      WHERE user_id = ? AND media_key = ? AND kind LIKE 'rating-%' AND status = 'open'`)
      .bind(updatedAt, userId, snapshot.mediaKey)
      .run();
  }
}

async function conflictDigest(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildRatingConflict(
  input: Omit<RatingConflict, "id"> & { scope?: string }
): Promise<RatingConflict> {
  const { scope = "self-host", ...conflict } = input;
  return {
    ...conflict,
    id: await conflictDigest(JSON.stringify([
      scope,
      input.mediaKey,
      input.kind,
      input.previous,
      input.current
    ]))
  };
}

function parseRows(value: unknown): unknown[] {
  if (value === undefined || value === null) return [];
  const parsed = typeof value === "string" ? JSON.parse(value) as unknown : value;
  if (!Array.isArray(parsed)) throw new Error("Rating snapshots must be a JSON array.");
  return parsed;
}

function ratingStatus(value: unknown): "liked" | "loved" | null {
  return value === "liked" || value === "loved" ? value : null;
}

function ratingNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10 ? value : null;
}
