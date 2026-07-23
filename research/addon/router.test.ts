import test from "node:test";
import assert from "node:assert/strict";
import { handleAddonRequest } from "./router.js";

const origin = "http://127.0.0.1:7017";

test("serves a Stremio manifest with a configurable addon identity", async () => {
  const response = await handleAddonRequest({ method: "GET", url: "/manifest.json" }, origin);
  const body = JSON.parse(response.body) as {
    id?: unknown;
    name?: unknown;
    resources?: unknown;
    behaviorHints?: { configurable?: unknown; configurationRequired?: unknown };
  };

  assert.equal(response.status, 200);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.equal(body.id, "community.syncio");
  assert.equal(body.name, "SYNCIO");
  assert.deepEqual(body.resources, ["catalog"]);
  assert.equal(body.behaviorHints?.configurable, true);
  assert.equal(body.behaviorHints?.configurationRequired, false);
});

test("serves the configure page with a Stremio install link", async () => {
  const response = await handleAddonRequest({ method: "GET", url: "/configure" }, origin);

  assert.equal(response.status, 200);
  assert.match(response.body, /SYNCIO/);
  assert.match(response.body, /http:\/\/127\.0\.0\.1:7017\/manifest\.json/);
  assert.match(response.body, /stremio:\/\/127\.0\.0\.1:7017\/manifest\.json/);
  assert.match(response.body, /tracked operations/);
  assert.match(response.body, /Start Trakt Link/);
  assert.match(response.body, /Verify Trakt Account/);
  assert.match(response.body, /Preview Watched Sync/);
  assert.match(response.body, /Preview Full Test Sync/);
  assert.match(response.body, /Apply Full Test Sync/);
  assert.match(response.body, /Apply Watched Test/);
  assert.match(response.body, /Preview Ratings/);
  assert.match(response.body, /Apply Ratings Test/);
  assert.match(response.body, /Preview Watchlist/);
  assert.match(response.body, /Apply Watchlist Test/);
  assert.match(response.body, /metric-row/);
});

test("serves a visible status catalog", async () => {
  const response = await handleAddonRequest({ method: "GET", url: "/catalog/movie/syncio-status.json" }, origin);
  const body = JSON.parse(response.body) as { metas?: Array<{ id?: unknown; name?: unknown; poster?: unknown }> };

  assert.equal(response.status, 200);
  assert.equal(body.metas?.length, 1);
  assert.equal(body.metas[0]?.id, "syncio:status");
  assert.equal(body.metas[0]?.name, "SYNCIO Status");
  assert.equal(typeof body.metas[0]?.poster, "string");
});
