import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import { acquireSyncRunLease, releaseSyncRunLease } from "./sync-run-lock.js";

test("serializes sync runs and allows recovery after the lease expires", async () => {
  const db = new MemoryD1();
  const first = await acquireSyncRunLease(db, "self-host", new Date("2026-07-28T00:00:00.000Z"));
  assert.ok(first);
  assert.equal(
    await acquireSyncRunLease(db, "self-host", new Date("2026-07-28T00:05:00.000Z")),
    null
  );

  const recovered = await acquireSyncRunLease(db, "self-host", new Date("2026-07-28T00:11:00.000Z"));
  assert.ok(recovered);
  await releaseSyncRunLease(db, recovered);
  assert.equal(db.lock, null);
});

class MemoryD1 implements D1DatabaseLike {
  lock: { userId: string; ownerId: string; leaseUntil: string } | null = null;

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (!query.startsWith("SELECT owner_id")) return null as T | null;
        if (!self.lock || self.lock.userId !== String(bound[0])) return null as T | null;
        return {
          owner_id: self.lock.ownerId,
          lease_until: self.lock.leaseUntil
        } as T;
      },
      async run() {
        if (query.startsWith("INSERT INTO sync_run_locks")) {
          const userId = String(bound[0]);
          const ownerId = String(bound[1]);
          const leaseUntil = String(bound[2]);
          const now = String(bound[3]);
          if (!self.lock || self.lock.userId !== userId || self.lock.leaseUntil <= now) {
            self.lock = { userId, ownerId, leaseUntil };
          }
        }
        if (query.startsWith("DELETE FROM sync_run_locks")) {
          if (self.lock?.userId === String(bound[0]) && self.lock.ownerId === String(bound[1])) {
            self.lock = null;
          }
        }
        return { success: true };
      }
    };
  }
}
