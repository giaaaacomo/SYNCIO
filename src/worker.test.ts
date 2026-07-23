import test from "node:test";
import assert from "node:assert/strict";
import worker, { handleRequest } from "./worker.js";
import type { D1DatabaseLike } from "./storage/d1.js";

const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";
const SETUP_TOKEN = "test-setup-token";

test("reports redacted setup status for a self-host install", async () => {
  const db = new MemoryD1();
  const response = await worker.fetch(authorizedRequest("https://syncio.example/api/setup/status"), {
    SYNCIO_DB: db,
    SYNCIO_ENCRYPTION_KEY: TEST_KEY,
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN
  });
  const body = await response.json() as Record<string, unknown>;

  assert.equal(response.status, 200);
  assert.deepEqual(body, {
    install: { mode: "self-host", id: "self-host" },
    storage: { d1: "configured", reachable: true },
    encryption: "configured",
    connections: {
      stremio: { auth: "missing", userId: null },
      traktApp: { clientId: "missing", clientSecret: "missing", redirectUri: "missing" },
      traktOAuth: { access: "missing", refresh: "missing", expiresAt: null, username: null },
      encryptionVersion: null
    },
    traktDevice: { state: "idle" },
    latestRun: null
  });
});

test("saves Trakt app credentials encrypted and returns only readiness state", async () => {
  const db = new MemoryD1();
  const response = await worker.fetch(authorizedRequest("https://syncio.example/api/setup/trakt-app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: "client-id-12345",
      clientSecret: "client-secret-67890",
      redirectUri: "https://syncio.example/oauth/trakt/callback"
    })
  }), {
    SYNCIO_DB: db,
    SYNCIO_ENCRYPTION_KEY: TEST_KEY,
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN
  });
  const body = await response.json() as Record<string, unknown>;
  const connection = db.connections.get("self-host");

  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(body).includes("client-id-12345"), false);
  assert.equal(JSON.stringify(body).includes("client-secret-67890"), false);
  assert.equal(connection?.trakt_client_id_ciphertext === "client-id-12345", false);
  assert.equal(connection?.trakt_client_secret_ciphertext === "client-secret-67890", false);
  assert.match(String(connection?.trakt_client_id_ciphertext), /^v1\./);
  assert.match(String(connection?.trakt_client_secret_ciphertext), /^v1\./);
  assert.deepEqual(body, {
    ok: true,
    connections: {
      stremio: { auth: "missing", userId: null },
      traktApp: { clientId: "configured", clientSecret: "configured", redirectUri: "configured" },
      traktOAuth: { access: "missing", refresh: "missing", expiresAt: null, username: null },
      encryptionVersion: 1
    }
  });
});

test("refuses to save Trakt app credentials without an encryption key", async () => {
  const response = await worker.fetch(authorizedRequest("https://syncio.example/api/setup/trakt-app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ clientId: "client-id-12345" })
  }), {
    SYNCIO_DB: new MemoryD1(),
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN
  });
  const body = await response.json() as { error?: string };

  assert.equal(response.status, 503);
  assert.equal(body.error, "SYNCIO_ENCRYPTION_KEY is not configured.");
});

test("returns JSON when Trakt app credentials cannot be encrypted", async () => {
  const response = await worker.fetch(authorizedRequest("https://syncio.example/api/setup/trakt-app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: "client-id-12345",
      clientSecret: "client-secret-67890",
      redirectUri: "https://syncio.example/oauth/trakt/callback"
    })
  }), {
    SYNCIO_DB: new MemoryD1(),
    SYNCIO_ENCRYPTION_KEY: "not-a-32-byte-key",
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN
  });

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Could not encrypt or save Trakt app credentials." });
});

test("protects setup routes with the setup token", async () => {
  const response = await worker.fetch(new Request("https://syncio.example/api/setup/status"), {
    SYNCIO_DB: new MemoryD1(),
    SYNCIO_ENCRYPTION_KEY: TEST_KEY,
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN
  });
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "Setup authorization required." });
});

test("completes Trakt Device OAuth and stores only encrypted verified credentials", async () => {
  const db = new MemoryD1();
  await worker.fetch(authorizedRequest("https://syncio.example/api/setup/trakt-app", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      clientId: "client-id-12345",
      clientSecret: "client-secret-67890",
      redirectUri: "https://syncio.example/oauth/trakt/callback"
    })
  }), workerEnv(db));

  const externalFetch: typeof fetch = async (input) => {
    const url = String(input);
    if (url.endsWith("/oauth/device/code")) {
      return Response.json({
        device_code: "raw-device-code",
        user_code: "ABC12345",
        verification_url: "https://trakt.tv/activate",
        expires_in: 600,
        interval: 5
      });
    }
    if (url.endsWith("/oauth/device/token")) {
      return Response.json({
        access_token: "raw-access-token",
        refresh_token: "raw-refresh-token",
        expires_in: 604800,
        created_at: 1784764800
      });
    }
    if (url.endsWith("/users/settings")) return Response.json({ user: { username: "verified_test" } });
    return new Response(null, { status: 404 });
  };

  const startResponse = await handleRequest(
    authorizedRequest("https://syncio.example/api/setup/trakt/start", { method: "POST" }),
    workerEnv(db),
    externalFetch
  );
  assert.equal(startResponse.status, 200);
  assert.equal(db.sessions.get("self-host")?.device_code_ciphertext === "raw-device-code", false);
  db.sessions.get("self-host")!.next_poll_at = new Date(Date.now() - 1000).toISOString();

  const pollResponse = await handleRequest(
    authorizedRequest("https://syncio.example/api/setup/trakt/poll", { method: "POST" }),
    workerEnv(db),
    externalFetch
  );
  const body = await pollResponse.json() as Record<string, unknown>;
  const serialized = JSON.stringify(body);
  const connection = db.connections.get("self-host");

  assert.equal(pollResponse.status, 200);
  assert.equal(serialized.includes("raw-access-token"), false);
  assert.equal(serialized.includes("raw-refresh-token"), false);
  assert.match(String(connection?.trakt_access_ciphertext), /^v1\./);
  assert.match(String(connection?.trakt_refresh_ciphertext), /^v1\./);
  assert.equal(connection?.trakt_username, "verified_test");
  assert.equal(db.sessions.has("self-host"), false);
});

test("links a verified Stremio auth key without exposing it", async () => {
  const db = new MemoryD1();
  const response = await handleRequest(
    authorizedRequest("https://syncio.example/api/setup/stremio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "auth-key", authKey: "raw-stremio-auth-key" })
    }),
    workerEnv(db),
    async (input) => {
      assert.equal(String(input), "https://stremio.test/api/getUser");
      return Response.json({ result: { _id: "stremio-user-12345678" } });
    }
  );
  const body = await response.json() as Record<string, unknown>;
  const serialized = JSON.stringify(body);
  const connection = db.connections.get("self-host");

  assert.equal(response.status, 200);
  assert.equal(serialized.includes("raw-stremio-auth-key"), false);
  assert.match(String(connection?.stremio_auth_ciphertext), /^v1\./);
  assert.equal(connection?.stremio_user_id, "stremio-user-12345678");
  assert.equal(serialized.includes("stremio-user-12345678"), false);
  assert.equal(serialized.includes("stre...[redacted]...5678"), true);
});

function authorizedRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${SETUP_TOKEN}`);
  return new Request(input, { ...init, headers });
}

function workerEnv(db: MemoryD1) {
  return {
    SYNCIO_DB: db,
    SYNCIO_ENCRYPTION_KEY: TEST_KEY,
    SYNCIO_SETUP_TOKEN: SETUP_TOKEN,
    TRAKT_API_BASE: "https://trakt.test",
    STREMIO_API_BASE: "https://stremio.test"
  };
}

class MemoryD1 implements D1DatabaseLike {
  readonly users = new Map<string, Record<string, unknown>>();
  readonly connections = new Map<string, Record<string, unknown>>();
  readonly sessions = new Map<string, Record<string, unknown>>();

  prepare(query: string) {
    let bound: unknown[] = [];
    const self = this;
    return {
      bind(...values: unknown[]) {
        bound = values;
        return this;
      },
      async first<T>() {
        if (query.includes("FROM users WHERE id = ?")) {
          return (self.users.get(String(bound[0])) ?? null) as T | null;
        }
        if (query.includes("FROM connections WHERE user_id = ?")) {
          return (self.connections.get(String(bound[0])) ?? null) as T | null;
        }
        if (query.includes("FROM trakt_device_sessions WHERE user_id = ?")) {
          return (self.sessions.get(String(bound[0])) ?? null) as T | null;
        }
        if (query.includes("COUNT(*) AS count")) {
          return { count: 0 } as T;
        }
        return null;
      },
      async run() {
        if (query.startsWith("INSERT INTO users")) {
          self.users.set(String(bound[0]), {
            id: bound[0],
            created_at: bound[1],
            updated_at: bound[2],
            disabled_at: null
          });
        }
        if (query.startsWith("INSERT INTO connections")) {
          const userId = String(bound[0]);
          const existing = self.connections.get(userId);
          self.connections.set(userId, {
            user_id: userId,
            stremio_auth_ciphertext: bound[1],
            stremio_user_id: bound[2],
            trakt_client_id_ciphertext: bound[3],
            trakt_client_secret_ciphertext: bound[4],
            trakt_redirect_uri: bound[5],
            trakt_access_ciphertext: bound[6],
            trakt_refresh_ciphertext: bound[7],
            trakt_expires_at: bound[8],
            trakt_username: bound[9],
            encryption_version: bound[10],
            created_at: existing?.created_at ?? bound[11],
            updated_at: bound[12]
          });
        }
        if (query.startsWith("INSERT INTO trakt_device_sessions")) {
          const userId = String(bound[0]);
          const existing = self.sessions.get(userId);
          self.sessions.set(userId, {
            user_id: userId,
            device_code_ciphertext: bound[1],
            user_code: bound[2],
            verification_url: bound[3],
            expires_at: bound[4],
            interval_seconds: bound[5],
            next_poll_at: bound[6],
            created_at: existing?.created_at ?? bound[7],
            updated_at: bound[8]
          });
        }
        if (query.startsWith("DELETE FROM trakt_device_sessions")) {
          self.sessions.delete(String(bound[0]));
        }
        return { success: true };
      }
    };
  }
}
