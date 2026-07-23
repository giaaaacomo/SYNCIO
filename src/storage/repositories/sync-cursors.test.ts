import test from "node:test";
import assert from "node:assert/strict";
import { getSyncCursor, setSyncCursor } from "./sync-cursors.js";
import type { D1DatabaseLike } from "../d1.js";

test("persists and reads a non-negative sync cursor", async () => {
  let value: number | null = null;
  const db: D1DatabaseLike = {
    prepare(query) {
      let bound: unknown[] = [];
      return {
        bind(...input) { bound = input; return this; },
        async first<T>() {
          return (query.startsWith("SELECT") && value !== null ? { cursor_value: value } : null) as T | null;
        },
        async run() { value = Number(bound[2]); return { success: true }; }
      };
    }
  };

  assert.equal(await getSyncCursor(db, "user", "ratings"), 0);
  await setSyncCursor(db, "user", "ratings", 10);
  assert.equal(await getSyncCursor(db, "user", "ratings"), 10);
  await assert.rejects(() => setSyncCursor(db, "user", "ratings", -1), /non-negative/);
});
