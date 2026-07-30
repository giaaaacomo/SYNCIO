import test from "node:test";
import assert from "node:assert/strict";
import {
  COMPANION_CONTRACT_VERSION,
  parseObservationBatch,
  previewObservations,
  type CompanionObservation
} from "./contracts.js";

const observation: CompanionObservation = {
  contractVersion: COMPANION_CONTRACT_VERSION,
  provider: "netflix",
  sourceItemId: "netflix-episode-1",
  sourceShowId: "netflix-show-1",
  mediaType: "episode",
  title: "Pilot",
  year: 2026,
  showTitle: "Example",
  season: 1,
  episode: 1,
  absoluteEpisode: null,
  progressPercent: 92,
  platformMarkedCompleted: null,
  watchedAt: "2026-07-30T10:00:00.000Z",
  durationSeconds: 3600
};

test("classifies only native completion evidence as an automatic candidate", () => {
  const result = previewObservations([
    observation,
    { ...observation, sourceItemId: "brief-click", progressPercent: 2 },
    {
      ...observation,
      sourceItemId: "platform-complete",
      progressPercent: 12,
      platformMarkedCompleted: true
    },
    {
      ...observation,
      sourceItemId: "unknown-progress",
      progressPercent: null,
      platformMarkedCompleted: null
    }
  ]);

  assert.deepEqual(result.counts, { candidate: 2, review: 1, excluded: 1 });
  assert.deepEqual(result.items.map((item) => [item.sourceItemId, item.disposition, item.reason]), [
    ["netflix-episode-1", "candidate", "completion-threshold-met"],
    ["brief-click", "excluded", "below-completion-threshold"],
    ["platform-complete", "candidate", "completed-by-platform"],
    ["unknown-progress", "review", "missing-completion-evidence"]
  ]);
});

test("sends conflicting or incomplete episode evidence to review", () => {
  const result = previewObservations([
    {
      ...observation,
      sourceItemId: "conflict",
      platformMarkedCompleted: false
    },
    {
      ...observation,
      sourceItemId: "missing-date",
      watchedAt: null
    },
    {
      ...observation,
      sourceItemId: "missing-coordinates",
      season: null,
      episode: null,
      absoluteEpisode: null
    }
  ]);

  assert.deepEqual(result.items.map((item) => item.reason), [
    "conflicting-completion-signals",
    "missing-watched-date",
    "missing-episode-coordinates"
  ]);
});

test("rejects raw or unsupported provider payload fields", () => {
  assert.throws(
    () => parseObservationBatch({
      observations: [{
        ...observation,
        cookies: "must-never-leave-the-browser"
      }]
    }),
    /unsupported fields: cookies/
  );
});

test("normalizes an allowed observation batch", () => {
  const parsed = parseObservationBatch({
    observations: [{ ...observation, watchedAt: "2026-07-30T12:00:00+02:00" }]
  });

  assert.equal(parsed[0]?.watchedAt, "2026-07-30T10:00:00.000Z");
});
