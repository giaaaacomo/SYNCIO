import { buildMovieWatchedChange, findLibraryItem } from "./lib/library-items.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey } from "./lib/stremio.js";
import { boolFlag, env, flag, requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-movie-watched-write", async (args) => {
  const id = requireFlag(args, "media-id", "SYNCIO_TEST_MOVIE_ID");
  const name = flag(args, "name") ?? env("SYNCIO_TEST_MOVIE_NAME") ?? "SYNCIO Test Movie";
  const yearRaw = flag(args, "year") ?? env("SYNCIO_TEST_MOVIE_YEAR");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;
  const watchedAt = flag(args, "watched-at") ?? new Date().toISOString();
  const apply = boolFlag(args, "apply");
  const undo = boolFlag(args, "undo");
  const historyOnly = !boolFlag(args, "visible");

  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const existing = findLibraryItem(items, id);
  const change = buildMovieWatchedChange({
    existing,
    id,
    name,
    year,
    watchedAt,
    historyOnly,
    undo
  });

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write the planned movie watched change.",
      details: {
        existingFound: Boolean(existing),
        mode: undo ? "undo" : "mark-watched",
        historyOnly,
        plannedChange: change
      }
    };
  }

  const result = await putLibraryChanges(authKey, [change]);
  return {
    status: "PASS",
    message: undo ? "Applied movie watched undo change." : "Applied movie watched change.",
    details: { result }
  };
});
