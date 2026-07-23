import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../storage/d1.js";
import { runScheduledSync } from "./scheduled.js";

test("scheduled sync does not contact accounts in preview-only mode", async () => {
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
  const result = await runScheduledSync({
    db,
    userId: "self-host",
    encryptionKey: "unused",
    fetcher: async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }
  });

  assert.deepEqual(result, { ok: true, status: "skipped", reason: "Preview-only mode." });
  assert.equal(fetched, false);
});

test("scheduled sync refuses an account scope without an activation record", async () => {
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

  const result = await runScheduledSync({
    db,
    userId: "self-host",
    encryptionKey: "unused",
    fetcher: async () => {
      fetched = true;
      throw new Error("unexpected fetch");
    }
  });

  assert.deepEqual(result, { ok: true, status: "skipped", reason: "Live synchronization is not armed." });
  assert.equal(fetched, false);
});
