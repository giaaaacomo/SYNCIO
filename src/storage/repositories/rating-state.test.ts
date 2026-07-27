import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import { buildRatingConflict, saveRatingState } from "./rating-state.js";

test("records rating conflicts idempotently and does not advance their snapshots", async () => {
  const db = new RecordingD1();
  const previous = { mediaKey: "movie:tt1", stremioStatus: "liked" as const, traktRating: 7 };
  const current = { mediaKey: "movie:tt1", stremioStatus: "loved" as const, traktRating: 6 };
  const conflict = await buildRatingConflict({
    mediaKey: "movie:tt1",
    kind: "rating-movie",
    previous,
    current
  });

  await saveRatingState(db, "self-host", [current], [conflict], "2026-07-27T10:00:00.000Z");

  assert.equal(db.queries.length, 1);
  assert.match(db.queries[0] ?? "", /INSERT INTO sync_conflicts/);
  assert.equal(db.bindings[0]?.[0], conflict.id);
  assert.equal(db.bindings[0]?.[2], "movie:tt1");
});

test("saves converged rating snapshots and resolves their open conflicts", async () => {
  const db = new RecordingD1();
  await saveRatingState(db, "self-host", [{
    mediaKey: "series:tt2",
    stremioStatus: "loved",
    traktRating: 9
  }], [], "2026-07-27T11:00:00.000Z");

  assert.equal(db.queries.length, 2);
  assert.match(db.queries[0] ?? "", /INSERT INTO rating_snapshots/);
  assert.match(db.queries[1] ?? "", /UPDATE sync_conflicts/);
  assert.deepEqual(db.bindings[0], [
    "self-host",
    "series:tt2",
    "loved",
    9,
    "2026-07-27T11:00:00.000Z"
  ]);
});

class RecordingD1 implements D1DatabaseLike {
  queries: string[] = [];
  bindings: unknown[][] = [];

  prepare(query: string) {
    this.queries.push(query);
    const self = this;
    return {
      bind(...values: unknown[]) {
        self.bindings.push(values);
        return this;
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true };
      }
    };
  }
}
