import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultHostedSyncSettings,
  ensureUser,
  getHostedSyncSettings,
  getUser,
  upsertHostedSyncSettings,
  type HostedSyncSettings
} from "./users.js";
import type { D1DatabaseLike } from "../d1.js";

test("ensures a user and reads it back", async () => {
  const db = new MemoryD1();
  const created = await ensureUser(db, "user_1", "2026-07-20T00:00:00.000Z");
  const read = await getUser(db, "user_1");

  assert.equal(created.id, "user_1");
  assert.equal(created.createdAt, "2026-07-20T00:00:00.000Z");
  assert.deepEqual(read, created);
});

test("returns default settings before a row exists", async () => {
  const db = new MemoryD1();

  assert.deepEqual(await getHostedSyncSettings(db, "user_1"), defaultHostedSyncSettings());
});

test("upserts hosted sync settings", async () => {
  const db = new MemoryD1();
  await ensureUser(db, "user_1", "2026-07-20T00:00:00.000Z");
  const settings: HostedSyncSettings = {
    ...defaultHostedSyncSettings(),
    scope: "account-preview",
    watchedEnabled: false,
    likeThreshold: 6,
    loveThreshold: 10
  };

  const saved = await upsertHostedSyncSettings(db, "user_1", settings);

  assert.equal(saved.scope, "account-preview");
  assert.equal(saved.watchedEnabled, false);
  assert.equal(saved.likeThreshold, 6);
  assert.equal(saved.loveThreshold, 10);
});

class MemoryD1 implements D1DatabaseLike {
  readonly users = new Map<string, Record<string, unknown>>();
  readonly settings = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM users WHERE id = ?")) {
          return (self.users.get(String(bound[0])) ?? null) as T | null;
        }
        if (query.includes("FROM sync_settings WHERE user_id = ?")) {
          return (self.settings.get(String(bound[0])) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (query.startsWith("INSERT INTO users")) {
          self.users.set(String(bound[0]), {
            id: bound[0],
            created_at: bound[1],
            updated_at: bound[2],
            disabled_at: null
          });
        } else if (query.startsWith("INSERT INTO sync_settings")) {
          self.settings.set(String(bound[0]), {
            user_id: bound[0],
            scope: bound[1],
            history_mode: bound[2],
            watched_enabled: bound[3],
            rating_sync_enabled: bound[4],
            library_watchlist_enabled: bound[5],
            removals_enabled: bound[6],
            like_threshold: bound[7],
            love_threshold: bound[8],
            sync_interval_minutes: bound[9],
            optional_catalogs_enabled: bound[10]
          });
        }
        return { success: true };
      }
    };
  }
}
