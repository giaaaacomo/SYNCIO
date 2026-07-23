import { fetchCinemetaVideoIds } from "./lib/cinemeta.js";
import { buildEpisodeWatchedChange, findLibraryItem } from "./lib/library-items.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey } from "./lib/stremio.js";
import { setVideoWatched } from "./lib/watched-bitfield.js";
import { boolFlag, env, flag, intFlag, requireFlag, runProbe } from "./lib/probe.js";

await runProbe("stremio-episode-watched-write", async (args) => {
  const showId = requireFlag(args, "show-id", "SYNCIO_TEST_SHOW_ID");
  const season = intFlag(args, "season", 1);
  const episode = intFlag(args, "episode", 1);
  const name = flag(args, "name") ?? env("SYNCIO_TEST_SHOW_NAME") ?? "SYNCIO Test Show";
  const yearRaw = flag(args, "year") ?? env("SYNCIO_TEST_SHOW_YEAR");
  const year = yearRaw ? Number.parseInt(yearRaw, 10) : undefined;
  const watchedAt = flag(args, "watched-at") ?? new Date().toISOString();
  const apply = boolFlag(args, "apply");
  const undo = boolFlag(args, "undo");
  const historyOnly = !boolFlag(args, "visible");
  const seriesFlagged = boolFlag(args, "series-flagged");

  const [videoSet] = await fetchCinemetaVideoIds([showId]);
  if (!videoSet) {
    return { status: "FAIL", message: `Cinemeta returned no video IDs for ${showId}.` };
  }

  const targetVideoId = `${showId}:${season}:${episode}`;
  if (!videoSet.videos.includes(targetVideoId)) {
    return {
      status: "FAIL",
      message: `Target episode video id ${targetVideoId} was not found in Cinemeta video IDs.`,
      details: { showId, videoCount: videoSet.videos.length, firstVideoIds: videoSet.videos.slice(0, 10) }
    };
  }

  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const existing = findLibraryItem(items, showId);
  const existingWatched = typeof existing?.state?.watched === "string" ? existing.state.watched : null;
  const watchedField = setVideoWatched(existingWatched, videoSet.videos, targetVideoId, !undo);
  const change = buildEpisodeWatchedChange({
    existing,
    id: showId,
    name: videoSet.name ?? name,
    year,
    watchedAt,
    historyOnly,
    undo,
    watchedField,
    videoId: targetVideoId,
    season,
    episode,
    seriesFlagged
  });

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write the planned episode watched change.",
      details: {
        existingFound: Boolean(existing),
        targetVideoId,
        videoCount: videoSet.videos.length,
        historyOnly,
        seriesFlagged,
        plannedChange: change
      }
    };
  }

  const result = await putLibraryChanges(authKey, [change]);
  return {
    status: "PASS",
    message: undo ? "Applied episode watched undo change." : "Applied episode watched change.",
    details: { result, targetVideoId }
  };
});
