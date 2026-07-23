import test from "node:test";
import assert from "node:assert/strict";
import { recordAppliedChanges } from "./change-ledger.js";

test("records a group of logical changes with one D1 query", async () => {
  let runCount = 0;
  let values: unknown[] = [];
  const db = {
    prepare(query: string) {
      assert.match(query, /json_each/);
      return {
        bind(...bound: unknown[]) {
          values = bound;
          return this;
        },
        async first() { return null; },
        async run() {
          runCount += 1;
          return { success: true };
        }
      };
    }
  };

  await recordAppliedChanges(db, [
    { key: "one", userId: "user", direction: "to", kind: "movie", summary: "One" },
    { key: "two", userId: "user", direction: "to", kind: "episode", summary: "Two" }
  ], "2026-07-23T00:00:00.000Z");

  assert.equal(runCount, 1);
  assert.deepEqual(JSON.parse(String(values[0])), [
    { key: "one", userId: "user", direction: "to", kind: "movie", summary: "One" },
    { key: "two", userId: "user", direction: "to", kind: "episode", summary: "Two" }
  ]);
  assert.deepEqual(values.slice(1), ["2026-07-23T00:00:00.000Z", "2026-07-23T00:00:00.000Z"]);
});
