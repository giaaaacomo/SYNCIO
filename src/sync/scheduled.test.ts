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
