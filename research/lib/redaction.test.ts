import test from "node:test";
import assert from "node:assert/strict";
import { redact } from "./probe.js";

test("redacts obvious secret keys", () => {
  const output = redact({
    authKey: "abcdefghijklmnopqrstuvwxyz1234567890",
    userId: "abcdefghijklmnopqrstuvwxyz1234567890",
    nested: { password: "secret-password" },
    normal: "movie"
  });

  assert.deepEqual(output, {
    authKey: "abcd...[redacted]...7890",
    userId: "abcd...[redacted]...7890",
    nested: { password: "secr...[redacted]...word" },
    normal: "movie"
  });
});

test("redacts secret query parameters in URLs", () => {
  const output = redact("https://example.test/path?authToken=abcdef1234567890abcdef1234567890&mediaId=tt1");
  assert.equal(output, "https://example.test/path?authToken=%5Bredacted%5D&mediaId=tt1");
});
