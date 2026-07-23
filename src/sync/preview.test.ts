import test from "node:test";
import assert from "node:assert/strict";
import { buildBaselinePlan, mapTraktRating } from "./preview.js";
import { encodeWatchedField } from "./watched-bitfield.js";

test("plans movie history in both directions and watchlist additions without removals", async () => {
  const plan = await buildBaselinePlan({
    library: [
      { _id: "tt-stremio", name: "From Stremio", type: "movie", removed: true, temp: true, state: { flaggedWatched: 1 } },
      { _id: "tt-visible", name: "Already visible", type: "movie", removed: false, temp: false, state: {} }
    ],
    watchedMovies: [{ movie: { title: "From Trakt", ids: { imdb: "tt-trakt" } } }],
    watchlistMovies: [
      { movie: { title: "Already visible", ids: { imdb: "tt-visible" } } },
      { movie: { title: "Add to Library", ids: { imdb: "tt-watchlist" } } }
    ]
  });

  assert.deepEqual(plan, [
    { direction: "trakt-to-stremio", kind: "watched-movie", imdb: "tt-trakt", title: "From Trakt" },
    { direction: "stremio-to-trakt", kind: "watched-movie", imdb: "tt-stremio", title: "From Stremio" },
    { direction: "trakt-to-stremio", kind: "watchlist-movie", imdb: "tt-watchlist", title: "Add to Library" }
  ]);
});

test("plans individual watched episodes in both directions", async () => {
  const videos = ["tt-show:1:1", "tt-show:1:2"];
  const watched = await encodeWatchedField([false, true], videos);
  const plan = await buildBaselinePlan({
    library: [{ _id: "tt-show", name: "Show", type: "series", state: { watched } }],
    watchedMovies: [],
    watchlistMovies: [],
    watchedShows: [{
      show: { title: "Show", ids: { imdb: "tt-show" } },
      seasons: [{ number: 1, episodes: [{ number: 1 }] }]
    }],
    videoSets: [{ id: "tt-show", name: "Show", videos }]
  });

  assert.deepEqual(plan, [
    { direction: "trakt-to-stremio", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 1 },
    { direction: "stremio-to-trakt", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 2 }
  ]);
});

test("uses episode history when watched shows omit season details and deduplicates plays", async () => {
  const videos = ["tt-show:1:1", "tt-show:1:2"];
  const watched = await encodeWatchedField([true, false], videos);
  const historyEvent = {
    show: { title: "Show", ids: { imdb: "tt-show" } },
    episode: { season: 1, number: 2 }
  };
  const plan = await buildBaselinePlan({
    library: [{ _id: "tt-show", name: "Show", type: "series", state: { watched } }],
    watchedMovies: [],
    watchlistMovies: [],
    watchedShows: [{ show: { title: "Show", ids: { imdb: "tt-show" } } }],
    watchedEpisodeHistory: [historyEvent, historyEvent],
    videoSets: [{ id: "tt-show", name: "Show", videos }]
  });

  assert.deepEqual(plan, [
    { direction: "trakt-to-stremio", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 2 },
    { direction: "stremio-to-trakt", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 1 }
  ]);
});

test("maps Trakt ratings using the configured thresholds", () => {
  assert.equal(mapTraktRating(6), null);
  assert.equal(mapTraktRating(7), "liked");
  assert.equal(mapTraktRating(8), "liked");
  assert.equal(mapTraktRating(9), "loved");
  assert.equal(mapTraktRating(10), "loved");
});
