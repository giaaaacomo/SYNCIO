import test from "node:test";
import assert from "node:assert/strict";
import { buildVisibleMovie, buildWatchedSeries } from "./library-changes.js";

test("making a movie visible preserves its watched state", () => {
  const change = buildVisibleMovie({
    _id: "tt1",
    name: "Movie",
    type: "movie",
    removed: true,
    temp: true,
    state: { flaggedWatched: 1 }
  }, "tt1", "Movie");

  assert.equal(change.removed, false);
  assert.equal(change.temp, false);
  assert.equal(change.state?.flaggedWatched, 1);
});

test("episode updates preserve visible series membership without flagging the whole show", () => {
  const change = buildWatchedSeries({
    _id: "tt2",
    name: "Series",
    type: "series",
    removed: false,
    temp: false,
    state: { flaggedWatched: 1, timesWatched: 1, watched: "old" }
  }, "tt2", "Series", "new-bitfield", "2026-07-23T00:00:00.000Z");

  assert.equal(change.removed, false);
  assert.equal(change.temp, false);
  assert.equal(change.state?.flaggedWatched, 0);
  assert.equal(change.state?.timesWatched, 0);
  assert.equal(change.state?.watched, "new-bitfield");
});
