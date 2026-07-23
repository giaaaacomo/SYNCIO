import test from "node:test";
import assert from "node:assert/strict";
import {
  assertTestScopeForApply,
  defaultSyncSettings,
  parseSyncSettings,
  syncRunOptionsFromSettings
} from "./sync-settings.js";
import { ProbeAbort } from "./probe.js";

test("builds guarded test options from default settings", () => {
  const options = syncRunOptionsFromSettings(defaultSyncSettings());

  assert.deepEqual(options.include, { watched: true, ratings: true, watchlist: true });
  assert.deepEqual(options.watched?.movieIds, ["tt0133093"]);
  assert.deepEqual(options.ratings?.movieIds, ["tt0133093"]);
  assert.equal(options.ratings?.likeThreshold, 7);
  assert.equal(options.ratings?.loveThreshold, 9);
});

test("account preview scope removes test filters but keeps apply blocked", () => {
  const settings = parseSyncSettings({
    version: 1,
    scope: "account-preview",
    enabled: { watched: true, ratings: true, watchlist: false },
    ratings: { likeThreshold: 6, loveThreshold: 9 }
  });
  const options = syncRunOptionsFromSettings(settings);

  assert.deepEqual(options.include, { watched: true, ratings: true, watchlist: false });
  assert.equal(options.watched?.movieIds, undefined);
  assert.equal(options.ratings?.movieIds, undefined);
  assert.equal(options.watchlist?.movieIds, undefined);
  assert.throws(() => assertTestScopeForApply(settings), ProbeAbort);
});
