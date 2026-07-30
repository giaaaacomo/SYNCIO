import test from "node:test";
import assert from "node:assert/strict";
import { authorizeCompanion, hashCompanionSecret } from "./companion-auth.js";
import type { D1DatabaseLike } from "../storage/d1.js";

test("requires a hashed active token with the requested scope", async () => {
  const tokenHash = await hashCompanionSecret("raw-companion-token");
  const db = new MemoryD1(tokenHash);

  const missing = await authorizeCompanion(
    new Request("https://syncio.example/api/companion/status"),
    db,
    "status:read"
  );
  const accepted = await authorizeCompanion(
    new Request("https://syncio.example/api/companion/status", {
      headers: { authorization: "Bearer raw-companion-token" }
    }),
    db,
    "status:read"
  );
  const forbidden = await authorizeCompanion(
    new Request("https://syncio.example/api/companion/history", {
      headers: { authorization: "Bearer raw-companion-token" }
    }),
    db,
    "history:submit"
  );

  assert.deepEqual(missing, { ok: false, status: 401, error: "Companion authorization required." });
  assert.equal(accepted.ok, true);
  assert.deepEqual(forbidden, { ok: false, status: 403, error: "Companion scope is not authorized." });
});

class MemoryD1 implements D1DatabaseLike {
  constructor(private readonly tokenHash: string) {}

  prepare(query: string) {
    let bound: unknown[] = [];
    const tokenHash = this.tokenHash;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM companion_clients") && bound[0] === tokenHash) {
          return {
            id: "client-1",
            user_id: "self-host",
            token_hash: tokenHash,
            label: "Test browser",
            scopes_json: JSON.stringify(["status:read"]),
            created_at: "2026-07-30T10:00:00.000Z",
            last_seen_at: "2026-07-30T10:00:00.000Z",
            revoked_at: null
          } as T;
        }
        return null;
      },
      async run() {
        return { success: true, meta: { changes: 1 } };
      }
    };
  }
}
