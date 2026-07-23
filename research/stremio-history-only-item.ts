import { buildMovieWatchedChange, findLibraryItem } from "./lib/library-items.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey } from "./lib/stremio.js";
import { boolFlag, env, flag, requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-history-only-item", async (args) => {
  const id = requireFlag(args, "media-id", "SYNCIO_TEST_MOVIE_ID");
  const name = flag(args, "name") ?? env("SYNCIO_TEST_MOVIE_NAME") ?? "SYNCIO History-Only Test";
  const yearRaw = flag(args, "year") ?? env("SYNCIO_TEST_MOVIE_YEAR");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;
  const watchedAt = flag(args, "watched-at") ?? new Date().toISOString();
  const apply = boolFlag(args, "apply");
  const undo = boolFlag(args, "undo");

  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const existing = findLibraryItem(items, id);
  const change = buildMovieWatchedChange({
    existing,
    id,
    name,
    year,
    watchedAt,
    historyOnly: true,
    undo
  });
  change.removed = true;
  change.temp = true;

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to test history-only watched state.",
      details: {
        existingFound: Boolean(existing),
        expectedVisibleLibraryMembership: false,
        plannedChange: change
      }
    };
  }

  const result = await putLibraryChanges(authKey, [change]);
  return {
    status: "PASS",
    message: "Applied history-only item probe. Inspect Stremio clients for Library/Home visibility.",
    details: { result, undoCommandHint: "Re-run the same command with --apply --undo." }
  };
});
