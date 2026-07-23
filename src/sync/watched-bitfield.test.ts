import test from "node:test";
import assert from "node:assert/strict";
import { decodeWatchedField, encodeWatchedField, setEpisodeWatched } from "./watched-bitfield.js";

test("round-trips watched episode ids containing colons", async () => {
  const ids = ["tt0944947:1:1", "tt0944947:1:2", "tt0944947:1:3"];
  const serialized = await setEpisodeWatched(null, ids, ids[1]!, true);
  const decoded = await decodeWatchedField(serialized, ids);
  assert.deepEqual(decoded.values, [false, true, false]);
  assert.match(serialized, /^tt0944947:1:2:3:/);
});

test("preserves shifted values when old episode ids disappear", async () => {
  const oldIds = ["show:1:1", "show:1:2", "show:1:3"];
  const serialized = await encodeWatchedField([true, false, true], oldIds);
  const decoded = await decodeWatchedField(serialized, ["show:1:2", "show:1:3", "show:1:4"]);
  assert.deepEqual(decoded.values, [false, true, false]);
});
