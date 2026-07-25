import test from "node:test";
import assert from "node:assert/strict";
import { encryptSecret } from "../crypto/secrets.js";
import type { D1DatabaseLike } from "../storage/d1.js";
import { loadSyncCredentials } from "./credentials.js";

const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

test("loads delegated Trakt access from Stremio without persisted Trakt tokens", async () => {
  const encrypted = await encryptSecret("stremio-auth-key", TEST_KEY, "self-host:stremio-auth");
  const createdAt = 1_800_000_000;
  const db = new ReadOnlyD1({
    user_id: "self-host",
    stremio_auth_ciphertext: encrypted.value,
    stremio_user_id: "stremio-user-12345678",
    trakt_auth_mode: "stremio-delegated",
    trakt_client_id_ciphertext: null,
    trakt_client_secret_ciphertext: null,
    trakt_redirect_uri: null,
    trakt_access_ciphertext: null,
    trakt_refresh_ciphertext: null,
    trakt_expires_at: null,
    trakt_username: "expected_test_user",
    encryption_version: 1,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z"
  });

  const credentials = await loadSyncCredentials({
    db,
    userId: "self-host",
    encryptionKey: TEST_KEY,
    fetcher: async (input, init) => {
      if (String(input) === "https://stremio.test/api/getUser") {
        assert.deepEqual(JSON.parse(String(init?.body)), { authKey: "stremio-auth-key" });
        return Response.json({
          result: {
            _id: "stremio-user-12345678",
            trakt: {
              access_token: "ephemeral-stremio-trakt-token",
              refresh_token: "never-return-this-refresh-token",
              created_at: createdAt,
              expires_in: 604800
            }
          }
        });
      }
      assert.equal(String(input), "https://trakt.test/users/settings");
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer ephemeral-stremio-trakt-token");
      return Response.json({ user: { username: "expected_test_user" } });
    },
    stremioApiBase: "https://stremio.test",
    traktApiBase: "https://trakt.test",
    stremioTraktClientId: "stremio-trakt-client-id",
    now: createdAt * 1000 + 1000
  });

  assert.deepEqual(credentials, {
    stremio: {
      authKey: "stremio-auth-key",
      userId: "stremio-user-12345678"
    },
    trakt: {
      authMode: "stremio-delegated",
      clientId: "stremio-trakt-client-id",
      accessToken: "ephemeral-stremio-trakt-token",
      username: "expected_test_user",
      expiresAt: new Date((createdAt + 604800) * 1000).toISOString()
    }
  });
  assert.equal(JSON.stringify(credentials).includes("never-return-this-refresh-token"), false);
  assert.equal(db.writeCount, 0);
});

test("loads a rotated delegated grant on the next run without persisting either token", async () => {
  const encrypted = await encryptSecret("stremio-auth-key", TEST_KEY, "self-host:stremio-auth");
  const firstCreatedAt = 1_800_000_000;
  const secondCreatedAt = firstCreatedAt + 604_000;
  const db = new ReadOnlyD1({
    user_id: "self-host",
    stremio_auth_ciphertext: encrypted.value,
    stremio_user_id: "stremio-user-12345678",
    trakt_auth_mode: "stremio-delegated",
    trakt_client_id_ciphertext: null,
    trakt_client_secret_ciphertext: null,
    trakt_redirect_uri: null,
    trakt_access_ciphertext: null,
    trakt_refresh_ciphertext: null,
    trakt_expires_at: null,
    trakt_username: "expected_test_user",
    encryption_version: 1,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z"
  });
  let activeGrant = {
    accessToken: "first-ephemeral-token",
    createdAt: firstCreatedAt
  };
  const fetcher: typeof fetch = async (input, init) => {
    if (String(input) === "https://stremio.test/api/getUser") {
      return Response.json({
        result: {
          _id: "stremio-user-12345678",
          trakt: {
            access_token: activeGrant.accessToken,
            refresh_token: "must-stay-inside-stremio",
            created_at: activeGrant.createdAt,
            expires_in: 604800
          }
        }
      });
    }
    assert.equal(String(input), "https://trakt.test/users/settings");
    assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${activeGrant.accessToken}`);
    return Response.json({ user: { username: "expected_test_user" } });
  };

  const first = await loadSyncCredentials({
    db,
    userId: "self-host",
    encryptionKey: TEST_KEY,
    fetcher,
    stremioApiBase: "https://stremio.test",
    traktApiBase: "https://trakt.test",
    stremioTraktClientId: "stremio-trakt-client-id",
    now: firstCreatedAt * 1000 + 1000
  });

  activeGrant = {
    accessToken: "rotated-ephemeral-token",
    createdAt: secondCreatedAt
  };
  const second = await loadSyncCredentials({
    db,
    userId: "self-host",
    encryptionKey: TEST_KEY,
    fetcher,
    stremioApiBase: "https://stremio.test",
    traktApiBase: "https://trakt.test",
    stremioTraktClientId: "stremio-trakt-client-id",
    now: secondCreatedAt * 1000 + 1000
  });

  assert.equal(first.trakt.accessToken, "first-ephemeral-token");
  assert.equal(second.trakt.accessToken, "rotated-ephemeral-token");
  assert.equal(second.trakt.expiresAt, new Date((secondCreatedAt + 604800) * 1000).toISOString());
  assert.equal(JSON.stringify(second).includes("must-stay-inside-stremio"), false);
  assert.equal(db.writeCount, 0);
});

test("rejects delegated access when the Trakt account changes", async () => {
  const encrypted = await encryptSecret("stremio-auth-key", TEST_KEY, "self-host:stremio-auth");
  const createdAt = 1_800_000_000;
  const db = new ReadOnlyD1({
    user_id: "self-host",
    stremio_auth_ciphertext: encrypted.value,
    stremio_user_id: "stremio-user-12345678",
    trakt_auth_mode: "stremio-delegated",
    trakt_client_id_ciphertext: null,
    trakt_client_secret_ciphertext: null,
    trakt_redirect_uri: null,
    trakt_access_ciphertext: null,
    trakt_refresh_ciphertext: null,
    trakt_expires_at: null,
    trakt_username: "expected_test_user",
    encryption_version: 1,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z"
  });

  await assert.rejects(
    loadSyncCredentials({
      db,
      userId: "self-host",
      encryptionKey: TEST_KEY,
      fetcher: async (input) => String(input).includes("stremio.test")
        ? Response.json({
          result: {
            _id: "stremio-user-12345678",
            trakt: {
              access_token: "ephemeral-token",
              created_at: createdAt,
              expires_in: 604800
            }
          }
        })
        : Response.json({ user: { username: "different_user" } }),
      stremioApiBase: "https://stremio.test",
      traktApiBase: "https://trakt.test",
      now: createdAt * 1000 + 1000
    }),
    /received different_user, expected expected_test_user/
  );
});

test("rejects delegated access when the Stremio account changes", async () => {
  const encrypted = await encryptSecret("stremio-auth-key", TEST_KEY, "self-host:stremio-auth");
  const db = new ReadOnlyD1({
    user_id: "self-host",
    stremio_auth_ciphertext: encrypted.value,
    stremio_user_id: "expected-stremio-user",
    trakt_auth_mode: "stremio-delegated",
    trakt_client_id_ciphertext: null,
    trakt_client_secret_ciphertext: null,
    trakt_redirect_uri: null,
    trakt_access_ciphertext: null,
    trakt_refresh_ciphertext: null,
    trakt_expires_at: null,
    trakt_username: "expected_test_user",
    encryption_version: 1,
    created_at: "2026-07-23T00:00:00.000Z",
    updated_at: "2026-07-23T00:00:00.000Z"
  });

  await assert.rejects(
    loadSyncCredentials({
      db,
      userId: "self-host",
      encryptionKey: TEST_KEY,
      fetcher: async () => Response.json({
        result: {
          _id: "different-stremio-user",
          trakt: {
            access_token: "ephemeral-token",
            created_at: 1_800_000_000,
            expires_in: 604800
          }
        }
      }),
      stremioApiBase: "https://stremio.test",
      now: 1_800_000_000_000
    }),
    /Stremio account guard failed/
  );
});

class ReadOnlyD1 implements D1DatabaseLike {
  writeCount = 0;

  constructor(private readonly row: Record<string, unknown>) {}

  prepare(query: string) {
    const self = this;
    return {
      bind() {
        return this;
      },
      async first<T>() {
        return query.includes("FROM connections WHERE user_id = ?")
          ? self.row as T
          : null;
      },
      async run() {
        self.writeCount += 1;
        return { success: true };
      }
    };
  }
}
