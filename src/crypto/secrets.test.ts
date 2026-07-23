import test from "node:test";
import assert from "node:assert/strict";
import { decryptSecret, encryptSecret } from "./secrets.js";

const TEST_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY";

test("encrypts and decrypts a secret with context binding", async () => {
  const encrypted = await encryptSecret("trakt-client-id", TEST_KEY, "user_1:trakt-client-id");
  const decrypted = await decryptSecret(encrypted.value, TEST_KEY, "user_1:trakt-client-id");

  assert.equal(encrypted.encryptionVersion, 1);
  assert.match(encrypted.value, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.notEqual(encrypted.value, "trakt-client-id");
  assert.equal(decrypted, "trakt-client-id");
});

test("rejects decryption with the wrong context", async () => {
  const encrypted = await encryptSecret("secret", TEST_KEY, "user_1:trakt-refresh");

  await assert.rejects(() => decryptSecret(encrypted.value, TEST_KEY, "user_2:trakt-refresh"));
});

test("derives a stable AES key from a password-manager value", async () => {
  const key = "independent-random-encryption-key-48-characters-long";
  const encrypted = await encryptSecret("stremio-auth", key, "user_1:stremio-auth");

  assert.equal(await decryptSecret(encrypted.value, key, "user_1:stremio-auth"), "stremio-auth");
  await assert.rejects(() => decryptSecret(encrypted.value, `${key}-different`, "user_1:stremio-auth"));
});

test("rejects short encryption values", async () => {
  await assert.rejects(
    () => encryptSecret("secret", "too-short", "user_1:test"),
    /32-byte Base64 key or at least 32 characters/
  );
});
