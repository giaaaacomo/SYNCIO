import type { D1DatabaseLike } from "../d1.js";

export interface WatchedReconciliationCandidate {
  key: string;
  userId: string;
  direction: "stremio-to-trakt";
  kind: "watched-movie" | "watched-episode";
  summary: string;
}

interface StoredCandidate {
  key: string;
  firstSeenAt: string;
  lastSeenAt: string;
}

export async function stageWatchedReconciliation(
  db: D1DatabaseLike,
  candidates: WatchedReconciliationCandidate[],
  delayHours: number,
  continuityMinutes: number,
  now = new Date().toISOString()
): Promise<{ readyKeys: Set<string>; deferred: number }> {
  if (candidates.length === 0) return { readyKeys: new Set(), deferred: 0 };
  const existing = await getStoredCandidates(db, candidates[0]?.userId ?? "", candidates.map((item) => item.key));
  const nowMs = Date.parse(now);
  const delayMs = delayHours * 60 * 60 * 1000;
  const continuityMs = continuityMinutes * 60 * 1000;
  const readyKeys = new Set<string>();
  const staged = candidates.map((candidate) => {
    const previous = existing.get(candidate.key);
    const continuous = previous
      ? nowMs - Date.parse(previous.lastSeenAt) <= continuityMs
      : false;
    const firstSeenAt = continuous && previous ? previous.firstSeenAt : now;
    if (nowMs - Date.parse(firstSeenAt) >= delayMs) readyKeys.add(candidate.key);
    return { ...candidate, firstSeenAt };
  });

  await db.prepare(`WITH entries AS (
    SELECT value FROM json_each(?)
  )
  INSERT INTO watched_reconciliation_candidates (
    key, user_id, direction, kind, summary, first_seen_at, last_seen_at
  )
  SELECT
    json_extract(value, '$.key'),
    json_extract(value, '$.userId'),
    json_extract(value, '$.direction'),
    json_extract(value, '$.kind'),
    json_extract(value, '$.summary'),
    json_extract(value, '$.firstSeenAt'),
    ?
  FROM entries
  WHERE true
  ON CONFLICT(user_id, key) DO UPDATE SET
    summary = excluded.summary,
    first_seen_at = excluded.first_seen_at,
    last_seen_at = excluded.last_seen_at`)
    .bind(JSON.stringify(staged), now)
    .run();

  return { readyKeys, deferred: candidates.length - readyKeys.size };
}

export async function clearWatchedReconciliation(
  db: D1DatabaseLike,
  userId: string,
  keys: string[]
): Promise<void> {
  if (keys.length === 0) return;
  await db.prepare(`DELETE FROM watched_reconciliation_candidates
    WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))`)
    .bind(userId, JSON.stringify(keys))
    .run();
}

async function getStoredCandidates(
  db: D1DatabaseLike,
  userId: string,
  keys: string[]
): Promise<Map<string, StoredCandidate>> {
  const row = await db.prepare(`SELECT COALESCE(json_group_array(json_object(
      'key', key,
      'firstSeenAt', first_seen_at,
      'lastSeenAt', last_seen_at
    )), '[]') AS candidates_json
    FROM watched_reconciliation_candidates
    WHERE user_id = ? AND key IN (SELECT value FROM json_each(?))`)
    .bind(userId, JSON.stringify(keys))
    .first<{ candidates_json?: unknown }>();
  if (typeof row?.candidates_json !== "string") return new Map();
  const parsed = JSON.parse(row.candidates_json) as unknown;
  if (!Array.isArray(parsed)) throw new Error("Stored watched reconciliation candidates are invalid.");
  const output = new Map<string, StoredCandidate>();
  for (const value of parsed) {
    if (!value || typeof value !== "object") continue;
    const candidate = value as Partial<StoredCandidate>;
    if (
      typeof candidate.key === "string"
      && typeof candidate.firstSeenAt === "string"
      && typeof candidate.lastSeenAt === "string"
    ) {
      output.set(candidate.key, candidate as StoredCandidate);
    }
  }
  return output;
}
