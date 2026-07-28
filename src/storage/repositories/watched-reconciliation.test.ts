import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import {
  clearWatchedReconciliation,
  stageWatchedReconciliation,
  type WatchedReconciliationCandidate
} from "./watched-reconciliation.js";

const candidate: WatchedReconciliationCandidate = {
  key: "watched-bartok",
  userId: "self-host",
  direction: "stremio-to-trakt",
  kind: "watched-movie",
  summary: "tt0197273 Bartok the Magnificent"
};

test("releases a watched mismatch after six hours of continuous observations", async () => {
  const db = new MemoryD1();
  for (let hour = 0; hour < 6; hour += 1) {
    const result = await stageWatchedReconciliation(db, [candidate], 6, 180, atHour(hour));
    assert.equal(result.deferred, 1);
    assert.equal(result.readyKeys.size, 0);
  }

  const mature = await stageWatchedReconciliation(db, [candidate], 6, 180, atHour(6));
  assert.deepEqual(Array.from(mature.readyKeys), [candidate.key]);
  assert.equal(mature.deferred, 0);

  await clearWatchedReconciliation(db, candidate.userId, [candidate.key]);
  assert.equal(db.candidates.size, 0);
});

test("resets the safety window after observations stop", async () => {
  const db = new MemoryD1();
  await stageWatchedReconciliation(db, [candidate], 6, 180, atHour(0));
  const afterGap = await stageWatchedReconciliation(db, [candidate], 6, 180, atHour(4));

  assert.equal(afterGap.deferred, 1);
  assert.equal(db.candidates.get(candidate.key)?.firstSeenAt, atHour(4));
});

function atHour(hour: number): string {
  return new Date(Date.UTC(2026, 6, 28, hour)).toISOString();
}

class MemoryD1 implements D1DatabaseLike {
  readonly candidates = new Map<string, {
    userId: string;
    firstSeenAt: string;
    lastSeenAt: string;
  }>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (!query.includes("FROM watched_reconciliation_candidates")) return null as T | null;
        const userId = String(bound[0]);
        const keys = JSON.parse(String(bound[1])) as string[];
        const rows = keys.flatMap((key) => {
          const stored = self.candidates.get(key);
          return stored?.userId === userId
            ? [{ key, firstSeenAt: stored.firstSeenAt, lastSeenAt: stored.lastSeenAt }]
            : [];
        });
        return { candidates_json: JSON.stringify(rows) } as T;
      },
      async run() {
        if (query.includes("INSERT INTO watched_reconciliation_candidates")) {
          const staged = JSON.parse(String(bound[0])) as Array<WatchedReconciliationCandidate & {
            firstSeenAt: string;
          }>;
          for (const item of staged) {
            self.candidates.set(item.key, {
              userId: item.userId,
              firstSeenAt: item.firstSeenAt,
              lastSeenAt: String(bound[1])
            });
          }
        }
        if (query.includes("DELETE FROM watched_reconciliation_candidates")) {
          const userId = String(bound[0]);
          const keys = JSON.parse(String(bound[1])) as string[];
          for (const key of keys) {
            if (self.candidates.get(key)?.userId === userId) self.candidates.delete(key);
          }
        }
        return { success: true };
      }
    };
  }
}
