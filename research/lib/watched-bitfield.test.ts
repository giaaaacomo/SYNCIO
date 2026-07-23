import test from "node:test";
import assert from "node:assert/strict";
import { constructFromSerialized, serialize, setVideoWatched } from "./watched-bitfield.js";

test("serializes and decodes video ids containing colons", () => {
  const videoIds = ["tt0944947:1:1", "tt0944947:1:2", "tt0944947:1:3"];
  const serialized = setVideoWatched(null, videoIds, "tt0944947:1:2", true);
  const decoded = constructFromSerialized(serialized, videoIds);

  assert.equal(decoded.values[0], false);
  assert.equal(decoded.values[1], true);
  assert.equal(decoded.values[2], false);
});

test("anchors serialized field to the latest watched video", () => {
  const videoIds = ["show:1:1", "show:1:2", "show:1:3"];
  const serialized = setVideoWatched(null, videoIds, "show:1:1", true);
  const decoded = constructFromSerialized(serialized, videoIds);

  assert.match(serialized, /^show:1:1:3:/);
  assert.deepEqual(decoded.values, [true, false, false]);
});

test("preserves shifted old values when the front of the list is removed", () => {
  const oldIds = ["show:1:1", "show:1:2", "show:1:3"];
  const oldSerialized = serialize([true, false, true], oldIds);
  const newIds = ["show:1:2", "show:1:3", "show:1:4"];
  const decoded = constructFromSerialized(oldSerialized, newIds);

  assert.deepEqual(decoded.values, [false, true, false]);
});
