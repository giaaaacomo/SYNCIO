import test from "node:test";
import assert from "node:assert/strict";
import type { D1DatabaseLike } from "../d1.js";
import { getRecentSyncRuns } from "./sync-runs.js";

test("returns recent sync runs from the bounded JSON aggregate", async () => {
  const runs = [{
    id: "run-1",
    mode: "scheduled",
    status: "succeeded",
    started_at: "2026-07-23T17:00:00.000Z",
    finished_at: "2026-07-23T17:00:02.000Z",
    planned_changes: 2,
    error_message: null
  }];
  const db = new AggregateD1(JSON.stringify(runs));

  assert.deepEqual(await getRecentSyncRuns(db, "self-host", 8), [{
    id: "run-1",
    mode: "scheduled",
    status: "succeeded",
    startedAt: "2026-07-23T17:00:00.000Z",
    finishedAt: "2026-07-23T17:00:02.000Z",
    plannedChanges: 2,
    errorMessage: null
  }]);
  assert.deepEqual(db.bound, ["self-host", 8]);
});

test("rejects unbounded sync run history requests", async () => {
  await assert.rejects(getRecentSyncRuns(new AggregateD1("[]"), "self-host", 51), /between 1 and 50/);
});

class AggregateD1 implements D1DatabaseLike {
  bound: unknown[] = [];

  constructor(private readonly runs: string) {}

  prepare() {
    const self = this;
    return {
      bind(...values: unknown[]) {
        self.bound = values;
        return this;
      },
      async first<T>() {
        return { runs: self.runs } as T;
      },
      async run() {
        return { success: true };
      }
    };
  }
}
