import test from "node:test";
import assert from "node:assert/strict";
import {
  consumeCompanionPairingSession,
  createCompanionClient,
  getActiveCompanionClientByTokenHash,
  upsertCompanionPairingSession
} from "./companion-clients.js";
import type { D1DatabaseLike } from "../d1.js";

test("consumes a pairing code exactly once", async () => {
  const db = new MemoryD1();
  await upsertCompanionPairingSession(
    db,
    "self-host",
    "code-hash",
    "2026-07-30T11:00:00.000Z",
    "2026-07-30T10:00:00.000Z"
  );

  assert.equal(
    await consumeCompanionPairingSession(
      db,
      "self-host",
      "code-hash",
      "2026-07-30T10:05:00.000Z"
    ),
    true
  );
  assert.equal(
    await consumeCompanionPairingSession(
      db,
      "self-host",
      "code-hash",
      "2026-07-30T10:06:00.000Z"
    ),
    false
  );
});

test("stores only a token hash and returns an active companion client", async () => {
  const db = new MemoryD1();
  await createCompanionClient(db, {
    id: "client-1",
    userId: "self-host",
    tokenHash: "token-hash",
    label: "Firefox on Linux"
  }, "2026-07-30T10:00:00.000Z");

  const client = await getActiveCompanionClientByTokenHash(db, "token-hash");
  assert.equal(client?.id, "client-1");
  assert.equal(client?.tokenHash, "token-hash");
  assert.deepEqual(client?.scopes, ["status:read", "history:preview"]);
  assert.equal(await getActiveCompanionClientByTokenHash(db, "raw-token"), null);
});

class MemoryD1 implements D1DatabaseLike {
  pairing: Record<string, unknown> | null = null;
  readonly clients = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM companion_clients") && query.includes("token_hash = ?")) {
          return ([...self.clients.values()].find((row) =>
            row.token_hash === bound[0] && row.revoked_at === null
          ) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (query.startsWith("INSERT INTO companion_pairing_sessions")) {
          self.pairing = {
            user_id: bound[0],
            code_hash: bound[1],
            expires_at: bound[2],
            created_at: bound[3]
          };
          return { success: true, meta: { changes: 1 } };
        }
        if (query.startsWith("DELETE FROM companion_pairing_sessions")) {
          const matches = self.pairing?.user_id === bound[0]
            && self.pairing?.code_hash === bound[1]
            && String(self.pairing?.expires_at) > String(bound[2]);
          if (matches) self.pairing = null;
          return { success: true, meta: { changes: matches ? 1 : 0 } };
        }
        if (query.startsWith("INSERT INTO companion_clients")) {
          self.clients.set(String(bound[0]), {
            id: bound[0],
            user_id: bound[1],
            token_hash: bound[2],
            label: bound[3],
            scopes_json: bound[4],
            created_at: bound[5],
            last_seen_at: bound[6],
            revoked_at: null
          });
          return { success: true, meta: { changes: 1 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
    };
  }
}
