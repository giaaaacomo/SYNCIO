import test from "node:test";
import assert from "node:assert/strict";
import {
  buildBaselinePlan,
  buildRatingOperations,
  mapStremioRating,
  mapTraktRating,
  MAX_OPERATIONS_PER_RUN,
  operationBatch
} from "./preview.js";
import { encodeWatchedField } from "./watched-bitfield.js";

test("plans movie history and additive Library/Watchlist sync in both directions", async () => {
  const plan = await buildBaselinePlan({
    library: [
      { _id: "tt-stremio", name: "From Stremio", type: "movie", removed: true, temp: true, state: { flaggedWatched: 1 } },
      { _id: "tt0000001", name: "Already visible", type: "movie", removed: false, temp: false, state: {} },
      { _id: "tt0000002", name: "Movie from Library", type: "movie", removed: false, temp: false, state: {} },
      { _id: "tt0000003", name: "Series from Library", type: "series", removed: false, temp: false, state: {} },
      { _id: "kitsu:1", name: "Unsupported ID", type: "series", removed: false, temp: false, state: {} }
    ],
    watchedMovies: [{ movie: { title: "From Trakt", ids: { imdb: "tt-trakt" } } }],
    watchlistMovies: [
      { movie: { title: "Already visible", ids: { imdb: "tt0000001" } } },
      { movie: { title: "Add to Library", ids: { imdb: "tt0000004" } } }
    ],
    watchlistShows: [{ show: { title: "Series from Trakt", ids: { imdb: "tt0000005" } } }]
  });

  assert.deepEqual(plan, [
    { direction: "trakt-to-stremio", kind: "watched-movie", imdb: "tt-trakt", title: "From Trakt" },
    { direction: "stremio-to-trakt", kind: "watched-movie", imdb: "tt-stremio", title: "From Stremio" },
    { direction: "trakt-to-stremio", kind: "watchlist-movie", imdb: "tt0000004", title: "Add to Library" },
    { direction: "stremio-to-trakt", kind: "watchlist-movie", imdb: "tt0000002", title: "Movie from Library" },
    { direction: "trakt-to-stremio", kind: "watchlist-series", imdb: "tt0000005", title: "Series from Trakt" },
    { direction: "stremio-to-trakt", kind: "watchlist-series", imdb: "tt0000003", title: "Series from Library" }
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

test("maps Stremio Like and Love to the configured Trakt ratings", () => {
  assert.equal(mapStremioRating(null), null);
  assert.equal(mapStremioRating("watched"), null);
  assert.equal(mapStremioRating("liked"), 7);
  assert.equal(mapStremioRating("loved"), 9);
  assert.equal(mapStremioRating("liked", 6, 10), 6);
});

test("plans ratings in both directions and keeps existing Trakt ratings authoritative", async () => {
  const statuses = new Map([
    ["movie:tt0000001", "loved"],
    ["movie:tt0000002", "liked"],
    ["series:tt0000003", "liked"]
  ]);
  const fetcher: typeof fetch = async (input) => {
    const url = new URL(String(input));
    const key = `${url.searchParams.get("mediaType")}:${url.searchParams.get("mediaId")}`;
    return Response.json({ status: statuses.get(key) ?? null });
  };
  const plan = await buildRatingOperations(
    "auth",
    [
      { _id: "tt0000001", name: "Stremio only", type: "movie" },
      { _id: "tt0000002", name: "Trakt wins", type: "movie" },
      { _id: "tt0000003", name: "Series from Stremio", type: "series" }
    ],
    [{ rating: 9, movie: { title: "Trakt wins", ids: { imdb: "tt0000002" } } }],
    [],
    0,
    7,
    9,
    fetcher,
    "https://likes.example/api"
  );

  assert.deepEqual(plan.operations, [
    {
      direction: "stremio-to-trakt",
      kind: "rating-movie",
      imdb: "tt0000001",
      title: "Stremio only",
      traktRating: 9,
      ratingStatus: "loved"
    },
    {
      direction: "trakt-to-stremio",
      kind: "rating-movie",
      imdb: "tt0000002",
      title: "Trakt wins",
      traktRating: 9,
      ratingStatus: "loved"
    },
    {
      direction: "stremio-to-trakt",
      kind: "rating-series",
      imdb: "tt0000003",
      title: "Series from Stremio",
      traktRating: 7,
      ratingStatus: "liked"
    }
  ]);
  assert.equal(plan.checked, 3);
  assert.equal(plan.nextOffset, 0);
});

test("caps each account run to a bounded operation batch", () => {
  const baseline = Array.from({ length: 300 }, (_, index) => ({
    direction: "trakt-to-stremio" as const,
    kind: "watched-movie" as const,
    imdb: `tt-${index}`,
    title: null
  }));
  const rating = [{
    direction: "trakt-to-stremio" as const,
    kind: "rating-movie" as const,
    imdb: "tt-rating",
    title: null,
    ratingStatus: "loved" as const
  }];
  const batch = operationBatch(baseline, rating);

  assert.equal(batch.length, MAX_OPERATIONS_PER_RUN);
  assert.equal(batch[0]?.kind, "rating-movie");
  assert.equal(batch.at(-1)?.imdb, "tt-248");
});
