import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../worker.js";
import type { D1DatabaseLike } from "../storage/d1.js";

const SETUP_TOKEN = "test-setup-token";

test("pairs a Companion once and previews normalized platform observations", async () => {
  const db = new CompanionD1();
  const env = { SYNCIO_DB: db, SYNCIO_SETUP_TOKEN: SETUP_TOKEN };

  const offerResponse = await handleRequest(setupRequest(
    "https://syncio.example/api/setup/companion/pairing",
    { method: "POST" }
  ), env);
  const offer = await offerResponse.json() as { code: string };
  assert.equal(offerResponse.status, 201);

  const pairResponse = await handleRequest(jsonRequest(
    "https://syncio.example/api/companion/pair",
    { code: offer.code, label: "Firefox on Linux" }
  ), env);
  const paired = await pairResponse.json() as {
    token: string;
    client: { id: string; scopes: string[] };
  };
  assert.equal(pairResponse.status, 201);
  assert.ok(paired.token.length >= 32);
  assert.notEqual([...db.clients.values()][0]?.token_hash, paired.token);

  const replayResponse = await handleRequest(jsonRequest(
    "https://syncio.example/api/companion/pair",
    { code: offer.code, label: "Replay" }
  ), env);
  assert.equal(replayResponse.status, 401);

  const statusResponse = await handleRequest(new Request(
    "https://syncio.example/api/companion/status",
    { headers: { authorization: `Bearer ${paired.token}` } }
  ), env);
  const status = await statusResponse.json() as {
    historyImport: {
      completionThreshold: number;
      browserNavigationHistory: string;
    };
  };
  assert.equal(statusResponse.status, 200);
  assert.equal(status.historyImport.completionThreshold, 80);
  assert.equal(status.historyImport.browserNavigationHistory, "not-read");

  const candidate = observation({
    sourceItemId: "netflix:episode:2",
    mediaType: "episode",
    title: "The Getaway",
    showTitle: "Example Show",
    season: 1,
    episode: 2,
    progressPercent: 96
  });
  const previewResponse = await handleRequest(companionJsonRequest(
    "https://syncio.example/api/companion/history/preview",
    paired.token,
    {
      observations: [
        observation({ sourceItemId: "netflix:movie:1", progressPercent: 2 }),
        candidate
      ]
    }
  ), env);
  const preview = await previewResponse.json() as {
    apply: boolean;
    counts: { candidate: number; excluded: number; review: number };
  };
  assert.equal(previewResponse.status, 200);
  assert.equal(preview.apply, false);
  assert.deepEqual(preview.counts, { candidate: 1, review: 0, excluded: 1 });

  const rejectedResponse = await handleRequest(companionJsonRequest(
    "https://syncio.example/api/companion/history/preview",
    paired.token,
    { observations: [{ ...candidate, cookies: "must-never-leave-the-browser" }] }
  ), env);
  const rejected = await rejectedResponse.json() as { error: string };
  assert.equal(rejectedResponse.status, 400);
  assert.match(rejected.error, /unsupported fields: cookies/);

  const disconnectResponse = await handleRequest(companionJsonRequest(
    "https://syncio.example/api/companion/disconnect",
    paired.token,
    {}
  ), env);
  assert.equal(disconnectResponse.status, 200);
  const disconnectedStatus = await handleRequest(new Request(
    "https://syncio.example/api/companion/status",
    { headers: { authorization: `Bearer ${paired.token}` } }
  ), env);
  assert.equal(disconnectedStatus.status, 401);
});

function observation(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    contractVersion: 1,
    provider: "netflix",
    sourceItemId: "netflix:movie:default",
    sourceShowId: null,
    mediaType: "movie",
    title: "Example Movie",
    year: 2026,
    showTitle: null,
    season: null,
    episode: null,
    absoluteEpisode: null,
    progressPercent: null,
    platformMarkedCompleted: null,
    watchedAt: "2026-07-30T10:00:00.000Z",
    durationSeconds: 5400,
    ...overrides
  };
}

function setupRequest(input: string, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${SETUP_TOKEN}`);
  return new Request(input, { ...init, headers });
}

function jsonRequest(input: string, body: unknown, token?: string): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request(input, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
}

function companionJsonRequest(input: string, token: string, body: unknown): Request {
  return jsonRequest(input, body, token);
}

class CompanionD1 implements D1DatabaseLike {
  readonly users = new Map<string, Record<string, unknown>>();
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
        if (query.includes("FROM users WHERE id = ?")) {
          return (self.users.get(String(bound[0])) ?? null) as T | null;
        }
        if (query.includes("FROM companion_clients") && query.includes("token_hash = ?")) {
          return ([...self.clients.values()].find((row) =>
            row.token_hash === bound[0] && row.revoked_at === null
          ) ?? null) as T | null;
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
          return { success: true, meta: { changes: 1 } };
        }
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
        if (query.startsWith("UPDATE companion_clients") && query.includes("last_seen_at")) {
          const row = self.clients.get(String(bound[1]));
          if (row) row.last_seen_at = bound[0];
          return { success: true, meta: { changes: row ? 1 : 0 } };
        }
        if (query.startsWith("UPDATE companion_clients") && query.includes("revoked_at")) {
          const row = self.clients.get(String(bound[2]));
          const matches = Boolean(row && row.user_id === bound[1] && row.revoked_at === null);
          if (matches && row) row.revoked_at = bound[0];
          return { success: true, meta: { changes: matches ? 1 : 0 } };
        }
        return { success: true, meta: { changes: 0 } };
      }
    };
  }
}
