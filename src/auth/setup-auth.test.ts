import test from "node:test";
import assert from "node:assert/strict";
import { authorizeSetup } from "./setup-auth.js";

test("requires a configured setup token", async () => {
  const result = await authorizeSetup(new Request("https://syncio.example/api/setup/status"), undefined);
  assert.deepEqual(result, { ok: false, status: 503, error: "SYNCIO_SETUP_TOKEN is not configured." });
});

test("accepts only the matching bearer setup token", async () => {
  const rejected = await authorizeSetup(new Request("https://syncio.example/api/setup/status", {
    headers: { authorization: "Bearer wrong" }
  }), "correct");
  const accepted = await authorizeSetup(new Request("https://syncio.example/api/setup/status", {
    headers: { authorization: "Bearer correct" }
  }), "correct");

  assert.equal(rejected.ok, false);
  assert.deepEqual(accepted, { ok: true });
});
