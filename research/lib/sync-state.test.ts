import test from "node:test";
import assert from "node:assert/strict";
import {
  hasAppliedOperation,
  markAppliedOperation,
  watchedEpisodeKey,
  watchedMovieKey,
  type SyncioState
} from "./sync-state.js";

test("builds stable watched operation keys", () => {
  assert.equal(
    watchedMovieKey("stremio-to-trakt", "tt0133093", "2026-07-18T10:00:00.000Z"),
    "watched:stremio-to-trakt:movie:tt0133093:2026-07-18T10:00:00.000Z"
  );
  assert.equal(
    watchedEpisodeKey("trakt-to-stremio", "tt0903747", 1, 1, undefined),
    "watched:trakt-to-stremio:episode:tt0903747:1:1:unknown"
  );
});

test("records applied operations without losing first applied timestamp", () => {
  const state: SyncioState = { version: 1, operations: {} };
  const input = {
    key: "watched:stremio-to-trakt:movie:tt0133093:unknown",
    direction: "stremio-to-trakt",
    kind: "movie",
    summary: "movie tt0133093 The Matrix"
  };

  markAppliedOperation(state, input, "2026-07-18T10:00:00.000Z");
  markAppliedOperation(state, input, "2026-07-18T11:00:00.000Z");

  assert.equal(hasAppliedOperation(state, input.key), true);
  assert.deepEqual(state.operations[input.key], {
    key: input.key,
    firstAppliedAt: "2026-07-18T10:00:00.000Z",
    lastAppliedAt: "2026-07-18T11:00:00.000Z",
    appliedCount: 2,
    direction: "stremio-to-trakt",
    kind: "movie",
    summary: "movie tt0133093 The Matrix"
  });
});
