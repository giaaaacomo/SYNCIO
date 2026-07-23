import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import { deleteSyncioUserData } from "./data-lifecycle.js";

test("deletes all SYNCIO user data in foreign-key-safe order", async () => {
  const db = new RecordingD1();

  await deleteSyncioUserData(db, "self-host");

  assert.deepEqual(db.queries, [
    "DELETE FROM trakt_device_sessions WHERE user_id = ?",
    "DELETE FROM sync_cursors WHERE user_id = ?",
    "DELETE FROM change_ledger WHERE user_id = ?",
    "DELETE FROM sync_conflicts WHERE user_id = ?",
    "DELETE FROM sync_runs WHERE user_id = ?",
    "DELETE FROM connections WHERE user_id = ?",
    "DELETE FROM sync_settings WHERE user_id = ?",
    "DELETE FROM users WHERE id = ?"
  ]);
  assert.deepEqual(db.bindings, Array.from({ length: 8 }, () => ["self-host"]));
});

class RecordingD1 implements D1DatabaseLike {
  queries: string[] = [];
  bindings: unknown[][] = [];

  prepare(query: string) {
    this.queries.push(query);
    const self = this;
    return {
      bind(...values: unknown[]) {
        self.bindings.push(values);
        return this;
      },
      async first<T>() {
        return null as T | null;
      },
      async run() {
        return { success: true };
      }
    };
  }
}
