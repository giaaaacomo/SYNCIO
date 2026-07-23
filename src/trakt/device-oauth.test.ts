import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchTraktIdentity,
  pollTraktDeviceAuthorization,
  refreshTraktToken,
  startTraktDeviceAuthorization
} from "./device-oauth.js";

test("starts device authorization with the client id", async () => {
  let requestBody: unknown;
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body));
    return Response.json({
      device_code: "device-code",
      user_code: "ABC12345",
      verification_url: "https://trakt.tv/activate",
      expires_in: 600,
      interval: 5
    });
  };

  const result = await startTraktDeviceAuthorization("client-id", fetcher, "https://trakt.test/");
  assert.deepEqual(requestBody, { client_id: "client-id" });
  assert.equal(result.userCode, "ABC12345");
});

test("polls with both app credentials and parses tokens", async () => {
  let requestBody: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({
      access_token: "access-token",
      refresh_token: "refresh-token",
      expires_in: 604800,
      created_at: 1784764800
    });
  };

  const result = await pollTraktDeviceAuthorization("client-id", "client-secret", "device-code", fetcher);
  assert.deepEqual(requestBody, { code: "device-code", client_id: "client-id", client_secret: "client-secret" });
  assert.equal(result.kind, "authorized");
});

test("maps Trakt device polling status codes", async () => {
  for (const [status, kind] of [[400, "pending"], [404, "invalid"], [409, "used"], [410, "expired"], [418, "denied"], [429, "slow-down"]] as const) {
    const result = await pollTraktDeviceAuthorization("id", "secret", "code", async () => new Response(null, { status }));
    assert.equal(result.kind, kind);
  }
});

test("reads the verified Trakt username", async () => {
  const identity = await fetchTraktIdentity("client-id", "access-token", async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer access-token");
    return Response.json({ user: { username: "test_account" } });
  });
  assert.deepEqual(identity, { username: "test_account" });
});

test("refreshes Trakt tokens with the app redirect URI", async () => {
  let body: Record<string, unknown> = {};
  const tokens = await refreshTraktToken(
    "client-id",
    "client-secret",
    "https://syncio.example/oauth/trakt/callback",
    "old-refresh-token",
    async (_input, init) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Response.json({
        access_token: "new-access",
        refresh_token: "new-refresh",
        expires_in: 604800,
        created_at: 1784764800
      });
    }
  );

  assert.equal(body.grant_type, "refresh_token");
  assert.equal(body.redirect_uri, "https://syncio.example/oauth/trakt/callback");
  assert.equal(tokens.refreshToken, "new-refresh");
});
