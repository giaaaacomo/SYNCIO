import test from "node:test";
import assert from "node:assert/strict";
import { traktGetAllPages } from "./api-clients.js";
import { TraktApiError } from "../trakt/api-error.js";

test("reads every declared Trakt page", async () => {
  const requested: string[] = [];
  const result = await traktGetAllPages(
    "/sync/history/episodes",
    "client",
    "token",
    async (input) => {
      const url = String(input);
      requested.push(url);
      const page = new URL(url).searchParams.get("page");
      return Response.json([{ page }], {
        headers: {
          "x-pagination-page-count": "2",
          "x-pagination-item-count": "2"
        }
      });
    },
    "https://trakt.test",
    { limit: 1000, maxPages: 2 }
  );

  assert.deepEqual(result.items, [{ page: "1" }, { page: "2" }]);
  assert.equal(result.pagesFetched, 2);
  assert.equal(result.itemCount, 2);
  assert.deepEqual(requested, [
    "https://trakt.test/sync/history/episodes?page=1&limit=1000",
    "https://trakt.test/sync/history/episodes?page=2&limit=1000"
  ]);
});

test("fails instead of returning a partial Trakt history", async () => {
  await assert.rejects(() => traktGetAllPages(
    "/sync/history/episodes",
    "client",
    "token",
    async () => Response.json([], { headers: { "x-pagination-page-count": "3" } }),
    "https://trakt.test",
    { maxPages: 2 }
  ), /requires 3 pages; the safe limit is 2/);
});

test("uses Trakt's bounded page size by default", async () => {
  const requested: string[] = [];
  await traktGetAllPages(
    "/sync/watchlist/movies",
    "client",
    "token",
    async (input) => {
      requested.push(String(input));
      return Response.json([]);
    },
    "https://trakt.test"
  );

  assert.deepEqual(requested, [
    "https://trakt.test/sync/watchlist/movies?page=1&limit=250"
  ]);
});

test("preserves Retry-After when a paginated Trakt read is rate limited", async () => {
  await assert.rejects(
    () => traktGetAllPages(
      "/sync/watchlist/shows",
      "client",
      "token",
      async () => new Response(null, { status: 429, headers: { "retry-after": "12" } }),
      "https://trakt.test"
    ),
    (error: unknown) => {
      assert.ok(error instanceof TraktApiError);
      assert.equal(error.retryAfterSeconds, 12);
      return true;
    }
  );
});
