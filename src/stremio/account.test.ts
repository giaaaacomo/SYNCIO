import test from "node:test";
import assert from "node:assert/strict";
import { fetchStremioIdentity, loginToStremio } from "./account.js";

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
