import { applyWatchedSync, planWatchedSync, type WatchedSyncDirection, type WatchedSyncOptions } from "./lib/sync-watched.js";
import { boolFlag, flag, intFlag, runProbe } from "./lib/probe.js";

await runProbe("sync-watched", async (args) => {
  const apply = boolFlag(args, "apply");
  const options = watchedOptionsFromArgs({
    direction: flag(args, "direction"),
    maxShows: intFlag(args, "max-shows", 25),
    movieIds: flag(args, "movie-ids"),
    showIds: flag(args, "show-ids"),
    statePath: flag(args, "state-path"),
    allowUnfilteredApply: boolFlag(args, "allow-unfiltered-apply")
  });

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write watched sync changes.",
      details: await planWatchedSync(options)
    };
  }

  return {
    status: "PASS",
    message: "Applied watched sync changes and updated local sync state.",
    details: await applyWatchedSync(options)
  };
});

function watchedOptionsFromArgs(input: {
  direction: string | undefined;
  maxShows: number;
  movieIds: string | undefined;
  showIds: string | undefined;
  statePath: string | undefined;
  allowUnfilteredApply: boolean;
}): WatchedSyncOptions {
  const options: WatchedSyncOptions = {
    direction: parseDirection(input.direction ?? "both"),
    maxShows: input.maxShows,
    allowUnfilteredApply: input.allowUnfilteredApply
  };
  const movieIds = idList(input.movieIds);
  const showIds = idList(input.showIds);
  if (movieIds) options.movieIds = movieIds;
  if (showIds) options.showIds = showIds;
  if (input.statePath) options.statePath = input.statePath;
  return options;
}

function parseDirection(value: string): WatchedSyncDirection {
  if (value === "both" || value === "trakt-to-stremio" || value === "stremio-to-trakt") return value;
  throw new Error("--direction must be both, trakt-to-stremio, or stremio-to-trakt.");
}

function idList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}
