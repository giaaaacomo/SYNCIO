import { planRatingsImport, applyRatingsImport, type RatingsImportOptions } from "./lib/sync-ratings.js";
import { boolFlag, flag, runProbe } from "./lib/probe.js";

await runProbe("trakt-to-stremio-ratings", async (args) => {
  const apply = boolFlag(args, "apply");
  const options = optionsFromMovieIds(flag(args, "movie-ids"));

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write mapped Stremio rating states.",
      details: await planRatingsImport(options)
    };
  }

  return {
    status: "PASS",
    message: "Applied mapped Trakt movie ratings to Stremio.",
    details: await applyRatingsImport(options)
  };
});

function idList(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

function optionsFromMovieIds(raw: string | undefined): RatingsImportOptions {
  const movieIds = idList(raw);
  return movieIds ? { movieIds } : {};
}
