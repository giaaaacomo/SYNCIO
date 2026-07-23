import test from "node:test";
import assert from "node:assert/strict";
import { buildEpisodeWatchedChange, buildMovieWatchedChange } from "./library-items.js";
import type { StremioLibraryItem } from "./stremio.js";

test("episode watched changes preserve visible library membership", () => {
  const existing = visibleSeries("tt1234567");
  const changed = buildEpisodeWatchedChange({
    existing,
    id: "tt1234567",
    name: "Collected Show",
    year: 2026,
    watchedAt: "2026-07-20T00:00:00.000Z",
    historyOnly: true,
    undo: false,
    watchedField: "tt1234567:1:1:1:1",
    videoId: "",
    season: 0,
    episode: 0,
    seriesFlagged: false
  });

  assert.equal(changed.removed, false);
  assert.equal(changed.temp, false);
  assert.equal(changed.state?.flaggedWatched, 0);
  assert.equal(changed.state?.timesWatched, 0);
  assert.equal(changed.state?.watched, "tt1234567:1:1:1:1");
});

test("movie watched changes preserve visible library membership", () => {
  const existing: StremioLibraryItem = {
    _id: "tt7654321",
    _ctime: "2026-07-20T00:00:00.000Z",
    _mtime: "2026-07-20T00:00:00.000Z",
    name: "Collected Movie",
    type: "movie",
    posterShape: "poster",
    removed: false,
    temp: false,
    state: { noNotif: false }
  };
  const changed = buildMovieWatchedChange({
    existing,
    id: "tt7654321",
    name: "Collected Movie",
    year: 2026,
    watchedAt: "2026-07-20T00:00:00.000Z",
    historyOnly: true,
    undo: false
  });

  assert.equal(changed.removed, false);
  assert.equal(changed.temp, false);
  assert.equal(changed.state?.flaggedWatched, 1);
  assert.equal(changed.state?.timesWatched, 1);
});

function visibleSeries(id: string): StremioLibraryItem {
  return {
    _id: id,
    _ctime: "2026-07-20T00:00:00.000Z",
    _mtime: "2026-07-20T00:00:00.000Z",
    name: "Collected Show",
    type: "series",
    posterShape: "poster",
    removed: false,
    temp: false,
    state: { noNotif: false }
  };
}
