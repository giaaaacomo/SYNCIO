import test from "node:test";
import assert from "node:assert/strict";
import {
  activateWorkerSync,
  applyWorkerSync,
  buildTraktHistoryPayload,
  buildTraktWatchlistPayload
} from "./apply.js";
import type { D1DatabaseLike } from "../storage/d1.js";

test("refuses apply in preview-only mode before any external request", async () => {
  let fetched = false;
  const db: D1DatabaseLike = {
    prepare() {
      return {
        bind() { return this; },
        async first() { return null; },
        async run() { return { success: true }; }
      };
    }
  };

  await assert.rejects(() => applyWorkerSync({
    db,
    userId: "self-host",
    encryptionKey: "unused",
    expectedFingerprint: "a".repeat(64),
    fetcher: async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }
  }), /not enabled for the current sync mode/);
  assert.equal(fetched, false);
});

test("groups Stremio watched operations into a Trakt history payload", () => {
  const payload = buildTraktHistoryPayload([
    { direction: "stremio-to-trakt", kind: "watched-movie", imdb: "tt-movie", title: "Movie" },
    { direction: "stremio-to-trakt", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 1 },
    { direction: "stremio-to-trakt", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 1, episode: 2 },
    { direction: "stremio-to-trakt", kind: "watched-episode", imdb: "tt-show", title: "Show", season: 2, episode: 1 }
  ]);

  assert.deepEqual(payload, {
    movies: [{ ids: { imdb: "tt-movie" } }],
    shows: [{
      ids: { imdb: "tt-show" },
      seasons: [
        { number: 1, episodes: [{ number: 1 }, { number: 2 }] },
        { number: 2, episodes: [{ number: 1 }] }
      ]
    }]
  });
});

test("groups visible Stremio Library items into a Trakt watchlist payload", () => {
  const payload = buildTraktWatchlistPayload([
    { direction: "stremio-to-trakt", kind: "watchlist-movie", imdb: "tt-movie", title: "Movie" },
    { direction: "stremio-to-trakt", kind: "watchlist-series", imdb: "tt-show", title: "Show" },
    { direction: "trakt-to-stremio", kind: "watchlist-movie", imdb: "tt-other", title: "Other" }
  ]);

  assert.deepEqual(payload, {
    movies: [{ ids: { imdb: "tt-movie" } }],
    shows: [{ ids: { imdb: "tt-show" } }]
  });
});

test("requires the exact live activation phrase before reading state", async () => {
  let prepared = false;
  const db: D1DatabaseLike = {
    prepare() {
      prepared = true;
      throw new Error("unexpected database access");
    }
  };

  await assert.rejects(() => activateWorkerSync({
    db,
    userId: "self-host",
    encryptionKey: "unused",
    expectedFingerprint: "a".repeat(64),
    confirmation: "enable syncio",
    fetcher: async () => {
      throw new Error("unexpected fetch");
    }
  }), /Type ENABLE SYNCIO/);
  assert.equal(prepared, false);
});

test("refuses live apply when account scope has no activation record", async () => {
  let fetched = false;
  const db: D1DatabaseLike = {
    prepare(query: string) {
      return {
        bind() { return this; },
        async first<T>() {
          if (query.includes("SELECT scope")) return {
            scope: "account",
            history_mode: "union",
            watched_enabled: 1,
            rating_sync_enabled: 1,
            library_watchlist_enabled: 1,
            removals_enabled: 0,
            like_threshold: 7,
            love_threshold: 9,
            sync_interval_minutes: 60,
            optional_catalogs_enabled: 0
          } as T;
          return null;
        },
        async run() { return { success: true }; }
      };
    }
  };

  await assert.rejects(() => applyWorkerSync({
    db,
    userId: "self-host",
    encryptionKey: "unused",
    expectedFingerprint: "a".repeat(64),
    fetcher: async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }
  }), /Live sync is not armed/);
  assert.equal(fetched, false);
});
