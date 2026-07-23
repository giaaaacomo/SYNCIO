import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchStremioIdentity,
  fetchStremioTraktAuthorization,
  loginToStremio
} from "./account.js";

test("logs in without retaining or returning the password", async () => {
  let requestBody: Record<string, unknown> = {};
  const authKey = await loginToStremio("test@example.com", "private-password", async (_input, init) => {
    requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
    return Response.json({ result: { authKey: "stremio-auth-key" } });
  });

  assert.deepEqual(requestBody, { email: "test@example.com", password: "private-password" });
  assert.equal(authKey, "stremio-auth-key");
});

test("verifies the Stremio account behind an auth key", async () => {
  const identity = await fetchStremioIdentity("stremio-auth-key", async (_input, init) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { authKey: "stremio-auth-key" });
    return Response.json({ result: { _id: "stremio-user-12345678" } });
  });
  assert.deepEqual(identity, { userId: "stremio-user-12345678" });
});

test("returns only the live Trakt access grant exposed by Stremio", async () => {
  const createdAt = 1_700_000_000;
  const authorization = await fetchStremioTraktAuthorization(
    "stremio-auth-key",
    async (_input, init) => {
      assert.deepEqual(JSON.parse(String(init?.body)), { authKey: "stremio-auth-key" });
      return Response.json({
        result: {
          _id: "stremio-user-12345678",
          trakt: {
            access_token: "stremio-held-access-token",
            refresh_token: "must-not-leave-get-user-parser",
            created_at: createdAt,
            expires_in: 604800
          }
        }
      });
    },
    "https://stremio.test",
    createdAt * 1000 + 1000
  );

  assert.deepEqual(authorization, {
    userId: "stremio-user-12345678",
    accessToken: "stremio-held-access-token",
    expiresAt: new Date((createdAt + 604800) * 1000).toISOString()
  });
  assert.equal(JSON.stringify(authorization).includes("must-not-leave-get-user-parser"), false);
});

test("fails closed when Stremio exposes an expired Trakt access grant", async () => {
  const createdAt = 1_700_000_000;
  await assert.rejects(
    fetchStremioTraktAuthorization(
      "stremio-auth-key",
      async () => Response.json({
        result: {
          _id: "stremio-user-12345678",
          trakt: {
            access_token: "expired-token",
            created_at: createdAt,
            expires_in: 604800
          }
        }
      }),
      "https://stremio.test",
      (createdAt + 604800) * 1000
    ),
    /expired or too close to expiry/
  );
});
