import { planWatchlistImport, applyWatchlistImport, type WatchlistImportOptions } from "./lib/sync-watchlist.js";
import { boolFlag, flag, runProbe } from "./lib/probe.js";

await runProbe("trakt-to-stremio-watchlist", async (args) => {
  const apply = boolFlag(args, "apply");
  const options = optionsFromMovieIds(flag(args, "movie-ids"));

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to import Trakt movie watchlist to visible Stremio library items.",
      details: await planWatchlistImport(options)
    };
  }

  return {
    status: "PASS",
    message: "Applied Trakt movie watchlist import to Stremio.",
    details: await applyWatchlistImport(options)
  };
});

function idList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function optionsFromMovieIds(raw: string | undefined): WatchlistImportOptions {
  const movieIds = idList(raw);
  return movieIds ? { movieIds } : {};
}
