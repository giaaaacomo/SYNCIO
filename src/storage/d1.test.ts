import test from "node:test";
import assert from "node:assert/strict";
import { isD1Database, readStorageStatus, type D1DatabaseLike } from "./d1.js";

test("reports missing D1 binding", async () => {
  const status = await readStorageStatus(undefined);

  assert.equal(status.d1Binding, "missing");
  assert.equal(status.reachable, false);
});

test("counts known D1 tables", async () => {
  const status = await readStorageStatus(fakeD1({
    users: 2,
    sync_runs: 3,
    change_ledger: 5,
    sync_conflicts: 1
  }));

  assert.equal(status.d1Binding, "configured");
  assert.equal(status.reachable, true);
  assert.deepEqual(status.tables, {
    users: 2,
    syncRuns: 3,
    ledgerEntries: 5,
    conflicts: 1
  });
});

test("detects D1-like bindings", () => {
  assert.equal(isD1Database(fakeD1({})), true);
  assert.equal(isD1Database({}), false);
});

function fakeD1(counts: Record<string, number>): D1DatabaseLike {
  return {
    prepare(query: string) {
      return {
        bind() {
          return this;
        },
        async first<T>() {
          const table = /FROM ([a-z_]+)/.exec(query)?.[1] ?? "";
          return { count: counts[table] ?? 0 } as T;
        },
        async run() {
          return { success: true };
        }
      };
    }
  };
}
