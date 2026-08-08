import test from "node:test";
import assert from "node:assert/strict";
import { compareSemver, readUpdateStatus } from "./updates.js";

test("compares stable and prerelease semantic versions", () => {
  assert.equal(compareSemver("0.3.8", "0.3.9"), -1);
  assert.equal(compareSemver("0.4.0-beta.1", "0.4.0-beta.2"), -1);
  assert.equal(compareSemver("0.4.0", "0.4.0-beta.2"), 1);
  assert.equal(compareSemver("1.0.0", "1.0.0"), 0);
});

test("reports an available update from the public source", async () => {
  const status = await readUpdateStatus("0.3.8", async () => Response.json({ version: "0.4.0" }));

  assert.equal(status.state, "available");
  assert.equal(status.updateAvailable, true);
  assert.equal(status.latestVersion, "0.4.0");
});

test("fails closed when the public update source is unavailable", async () => {
  const status = await readUpdateStatus("0.3.8", async () => new Response(null, { status: 503 }));

  assert.equal(status.state, "unavailable");
  assert.equal(status.updateAvailable, false);
  assert.match(status.error || "", /HTTP 503/);
});
