import test from "node:test";
import assert from "node:assert/strict";
import { applyWorkerSync, buildTraktHistoryPayload } from "./apply.js";
import type { D1DatabaseLike } from "../storage/d1.js";

test("refuses apply outside test-account mode before any external request", async () => {
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
  }), /Test account mode/);
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
