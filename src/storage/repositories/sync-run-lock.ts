import type { D1DatabaseLike } from "../d1.js";

export interface SyncRunLease {
  userId: string;
  ownerId: string;
  leaseUntil: string;
}

export async function acquireSyncRunLease(
  db: D1DatabaseLike,
  userId: string,
  now = new Date(),
  leaseMinutes = 10
): Promise<SyncRunLease | null> {
  const ownerId = crypto.randomUUID();
  const nowIso = now.toISOString();
  const leaseUntil = new Date(now.getTime() + leaseMinutes * 60 * 1000).toISOString();
  await db.prepare(`INSERT INTO sync_run_locks (user_id, owner_id, lease_until)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      owner_id = excluded.owner_id,
      lease_until = excluded.lease_until
    WHERE sync_run_locks.lease_until <= ?`)
    .bind(userId, ownerId, leaseUntil, nowIso)
    .run();
  const row = await db.prepare("SELECT owner_id, lease_until FROM sync_run_locks WHERE user_id = ?")
    .bind(userId)
    .first<{ owner_id?: unknown; lease_until?: unknown }>();
  return row?.owner_id === ownerId && row.lease_until === leaseUntil
    ? { userId, ownerId, leaseUntil }
    : null;
}

export async function releaseSyncRunLease(db: D1DatabaseLike, lease: SyncRunLease): Promise<void> {
  await db.prepare("DELETE FROM sync_run_locks WHERE user_id = ? AND owner_id = ?")
    .bind(lease.userId, lease.ownerId)
    .run();
}
