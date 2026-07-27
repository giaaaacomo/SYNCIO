import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import { buildRatingConflict, getRatingSnapshots, saveRatingState } from "./rating-state.js";

test("loads large rating snapshot sets in bounded D1 batches", async () => {
  const db = new RecordingD1();
  db.firstRows.push(
    { rows: JSON.stringify([{ media_key: "movie:tt0", stremio_status: "liked", trakt_rating: 7 }]) },
    { rows: JSON.stringify([{ media_key: "movie:tt90", stremio_status: "loved", trakt_rating: 9 }]) },
    { rows: JSON.stringify([{ media_key: "movie:tt180", stremio_status: null, trakt_rating: null }]) }
  );
  const keys = Array.from({ length: 205 }, (_, index) => `movie:tt${index}`);

  const snapshots = await getRatingSnapshots(db, "self-host", [...keys, keys[0]!]);

  assert.equal(db.queries.length, 3);
  assert.deepEqual(db.bindings.map((values) => values.length), [91, 91, 26]);
  assert.deepEqual(snapshots.get("movie:tt0"), {
    mediaKey: "movie:tt0",
    stremioStatus: "liked",
    traktRating: 7
  });
  assert.equal(snapshots.get("movie:tt90")?.stremioStatus, "loved");
  assert.equal(snapshots.get("movie:tt180")?.traktRating, null);
});

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
  firstRows: Array<Record<string, unknown> | null> = [];

  prepare(query: string) {
    this.queries.push(query);
    const self = this;
    return {
      bind(...values: unknown[]) {
        self.bindings.push(values);
        return this;
      },
      async first<T>() {
        return (self.firstRows.shift() ?? null) as T | null;
      },
      async run() {
        return { success: true };
      }
    };
  }
}
