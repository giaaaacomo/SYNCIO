import test from "node:test";
import assert from "node:assert/strict";
import { getConnection, upsertConnection } from "./connections.js";
import type { D1DatabaseLike } from "../d1.js";

test("upserts a per-user Trakt app connection without a global client id", async () => {
  const db = new MemoryD1();

  const saved = await upsertConnection(db, "user_1", {
    traktClientIdCiphertext: "v1.iv.client",
    traktClientSecretCiphertext: "v1.iv.secret",
    encryptionVersion: 1
  }, "2026-07-20T00:00:00.000Z");

  assert.equal(saved.userId, "user_1");
  assert.equal(saved.traktClientIdCiphertext, "v1.iv.client");
  assert.equal(saved.traktClientSecretCiphertext, "v1.iv.secret");
  assert.equal(saved.traktAuthMode, "direct-oauth");
  assert.equal(saved.traktAccessCiphertext, null);
  assert.equal(saved.createdAt, "2026-07-20T00:00:00.000Z");
});

test("preserves existing connection fields across partial updates", async () => {
  const db = new MemoryD1();
  await upsertConnection(db, "user_1", {
    traktClientIdCiphertext: "v1.iv.client",
    encryptionVersion: 1
  }, "2026-07-20T00:00:00.000Z");

  const updated = await upsertConnection(db, "user_1", {
    traktAuthMode: "stremio-delegated",
    traktRefreshCiphertext: "v1.iv.refresh",
    traktExpiresAt: "2026-07-21T00:00:00.000Z",
    encryptionVersion: 1
  }, "2026-07-20T00:05:00.000Z");

  assert.equal(updated.traktClientIdCiphertext, "v1.iv.client");
  assert.equal(updated.traktAuthMode, "stremio-delegated");
  assert.equal(updated.traktRefreshCiphertext, "v1.iv.refresh");
  assert.equal(updated.createdAt, "2026-07-20T00:00:00.000Z");
  assert.equal(updated.updatedAt, "2026-07-20T00:05:00.000Z");
  assert.deepEqual(await getConnection(db, "missing"), null);
});

test("clears explicitly nulled connection fields", async () => {
  const db = new MemoryD1();
  await upsertConnection(db, "user_1", {
    traktClientIdCiphertext: "v1.iv.client",
    traktClientSecretCiphertext: "v1.iv.secret",
    encryptionVersion: 1
  }, "2026-07-20T00:00:00.000Z");

  const updated = await upsertConnection(db, "user_1", {
    traktClientSecretCiphertext: null,
    encryptionVersion: 1
  }, "2026-07-20T00:05:00.000Z");

  assert.equal(updated.traktClientIdCiphertext, "v1.iv.client");
  assert.equal(updated.traktClientSecretCiphertext, null);
});

class MemoryD1 implements D1DatabaseLike {
  readonly connections = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM connections WHERE user_id = ?")) {
          return (self.connections.get(String(bound[0])) ?? null) as T | null;
        }
        return null;
      },
      async run() {
        if (query.startsWith("INSERT INTO connections")) {
          const userId = String(bound[0]);
          const existing = self.connections.get(userId);
          self.connections.set(userId, {
            user_id: userId,
            stremio_auth_ciphertext: bound[1],
            stremio_user_id: bound[2],
            trakt_auth_mode: bound[3],
            trakt_client_id_ciphertext: bound[4],
            trakt_client_secret_ciphertext: bound[5],
            trakt_redirect_uri: bound[6],
            trakt_access_ciphertext: bound[7],
            trakt_refresh_ciphertext: bound[8],
            trakt_expires_at: bound[9],
            trakt_username: bound[10],
            encryption_version: bound[11],
            created_at: existing?.created_at ?? bound[12],
            updated_at: bound[13]
          });
        }
        return { success: true };
      }
    };
  }
}
