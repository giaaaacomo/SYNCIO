import test from "node:test";
import assert from "node:assert/strict";
import { buildSyncRunReview } from "./sync-run-review.js";
import type { SyncRunResult } from "./sync-run.js";

test("groups planned watched episodes by show", () => {
  const review = buildSyncRunReview(syncRunWithWatchedEpisodes(), "account-preview");
  const watched = review.sections.find((section) => section.title === "Watched");

  assert.equal(review.summary.plannedChanges, 2);
  assert.ok(review.warnings.some((line) => line.includes("Apply is disabled")));
  assert.ok(watched);
  assert.ok(watched?.lines.some((line) => line.includes("Collected Future Show: 2 episodes")));
  assert.ok(watched?.lines.some((line) => line.includes("visible Library membership would be preserved")));
  assert.ok(watched?.lines.some((line) => line.includes("S1E1")));
  assert.ok(watched?.lines.some((line) => line.includes("S1E2")));
});

function syncRunWithWatchedEpisodes(): SyncRunResult {
  return {
    mode: "preview",
    startedAt: "2026-07-20T00:00:00.000Z",
    finishedAt: "2026-07-20T00:00:01.000Z",
    durationMs: 1000,
    include: { watched: true, ratings: false, watchlist: false },
    summary: { plannedChanges: 2, watched: 2, ratings: 0, watchlist: 0 },
    results: {
      watched: {
        traktToStremio: {
          plannedStremioItems: [
            {
              id: "tt9999999",
              name: "Collected Future Show",
              visibleLibraryItem: true,
              historyOnly: false
            }
          ],
          operations: {
            planned: 2,
            items: [
              {
                direction: "trakt-to-stremio",
                kind: "episode",
                summary: "episode tt9999999 S1E1",
                status: "planned"
              },
              {
                direction: "trakt-to-stremio",
                kind: "episode",
                summary: "episode tt9999999 S1E2",
                status: "planned"
              }
            ]
          }
        }
      }
    }
  };
}
