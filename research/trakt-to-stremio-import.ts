import { fetchCinemetaVideoIds } from "./lib/cinemeta.js";
import { buildEpisodeWatchedChange, buildMovieWatchedChange, findLibraryItem } from "./lib/library-items.js";
import { boolFlag, flag, intFlag, ProbeAbort, runProbe } from "./lib/probe.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey, type StremioLibraryItem } from "./lib/stremio.js";
import { parseHistoryEpisodes, parseWatchedMovies, parseWatchedShows, type TraktHistoryEpisode } from "./lib/trakt-media.js";
import { traktRequest } from "./lib/trakt.js";
import { setVideoWatched } from "./lib/watched-bitfield.js";

await runProbe("trakt-to-stremio-import", async (args) => {
  const apply = boolFlag(args, "apply");
  const maxShows = intFlag(args, "max-shows", 25);
  const movieFilter = idFilter(flag(args, "movie-ids"));
  const showFilter = idFilter(flag(args, "show-ids"));
  const hasAnyFilter = movieFilter !== undefined || showFilter !== undefined;
  const authKey = await resolveStremioAuthKey();

  const [watchedMoviesPage, watchedShowsPage, existingItems] = await Promise.all([
    traktRequest("/sync/watched/movies"),
    traktRequest("/sync/watched/shows"),
    getLibraryItems(authKey)
  ]);

  const watchedMovies = parseWatchedMovies(watchedMoviesPage.body)
    .filter((item) => typeof item.movie.ids.imdb === "string")
    .filter((item) => matchesFilter(item.movie.ids.imdb, movieFilter, hasAnyFilter));
  const watchedShows = parseWatchedShows(watchedShowsPage.body)
    .filter((item) => typeof item.show.ids.imdb === "string" && typeof item.show.ids.trakt === "number")
    .filter((item) => matchesFilter(item.show.ids.imdb, showFilter, hasAnyFilter))
    .slice(0, maxShows);

  const historyByShow = await fetchEpisodeHistoryByShow(watchedShows.map((item) => item.show.ids.trakt));
  const videoSets = await fetchCinemetaVideoIds(
    watchedShows.map((item) => item.show.ids.imdb).filter((id): id is string => Boolean(id))
  );
  const videoSetsById = new Map(videoSets.map((set) => [set.id, set]));
  const changes: StremioLibraryItem[] = [];

  for (const item of watchedMovies) {
    const imdb = item.movie.ids.imdb;
    if (!imdb) continue;
    changes.push(buildMovieWatchedChange({
      existing: findLibraryItem(existingItems, imdb),
      id: imdb,
      name: item.movie.title,
      year: item.movie.year,
      watchedAt: item.watchedAt,
      historyOnly: true,
      undo: false
    }));
  }

  for (const item of watchedShows) {
    const showImdb = item.show.ids.imdb;
    const showTrakt = item.show.ids.trakt;
    if (!showImdb || showTrakt === undefined) continue;

    const videoSet = videoSetsById.get(showImdb);
    if (!videoSet) {
      throw new ProbeAbort("FAIL", `Cinemeta returned no video IDs for ${showImdb}.`);
    }

    const history = historyByShow.get(showTrakt) ?? [];
    const watchedEpisodes = uniqueWatchedEpisodes(history)
      .filter((episode) => videoSet.videos.includes(`${showImdb}:${episode.episode.season}:${episode.episode.number}`));
    if (watchedEpisodes.length === 0) continue;

    let watchedField = typeof findLibraryItem(existingItems, showImdb)?.state?.watched === "string"
      ? findLibraryItem(existingItems, showImdb)?.state?.watched as string
      : null;
    for (const episode of watchedEpisodes) {
      watchedField = setVideoWatched(
        watchedField,
        videoSet.videos,
        `${showImdb}:${episode.episode.season}:${episode.episode.number}`,
        true
      );
    }

    const latestWatchedAt = watchedEpisodes
      .map((episode) => episode.watchedAt)
      .sort()
      .at(-1) ?? item.watchedAt;

    changes.push(buildEpisodeWatchedChange({
      existing: findLibraryItem(existingItems, showImdb),
      id: showImdb,
      name: videoSet.name ?? item.show.title,
      year: item.show.year,
      watchedAt: latestWatchedAt,
      historyOnly: true,
      undo: false,
      watchedField,
      videoId: "",
      season: 0,
      episode: 0,
      seriesFlagged: false
    }));
  }

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write the Trakt watched import to Stremio.",
      details: summarizeImport(watchedMovies.length, watchedShows.length, historyByShow, changes, movieFilter, showFilter)
    };
  }

  const result = changes.length > 0 ? await putLibraryChanges(authKey, changes) : { success: true };
  return {
    status: "PASS",
    message: "Applied Trakt watched import to Stremio.",
    details: {
      ...summarizeImport(watchedMovies.length, watchedShows.length, historyByShow, changes, movieFilter, showFilter),
      result
    }
  };
});

async function fetchEpisodeHistoryByShow(showTraktIds: Array<number | undefined>): Promise<Map<number, TraktHistoryEpisode[]>> {
  const output = new Map<number, TraktHistoryEpisode[]>();
  for (const showTraktId of showTraktIds) {
    if (showTraktId === undefined) continue;
    const page = await traktRequest(`/sync/history/shows/${showTraktId}`);
    output.set(showTraktId, parseHistoryEpisodes(page.body));
  }
  return output;
}

function uniqueWatchedEpisodes(history: TraktHistoryEpisode[]): TraktHistoryEpisode[] {
  const byKey = new Map<string, TraktHistoryEpisode>();
  for (const item of history) {
    if (item.action && item.action !== "watch") continue;
    byKey.set(`${item.episode.season}:${item.episode.number}`, item);
  }
  return Array.from(byKey.values());
}

function summarizeImport(
  watchedMovieCount: number,
  watchedShowCount: number,
  historyByShow: Map<number, TraktHistoryEpisode[]>,
  changes: StremioLibraryItem[],
  movieFilter?: Set<string>,
  showFilter?: Set<string>
): Record<string, unknown> {
  return {
    filters: {
      movieIds: movieFilter ? Array.from(movieFilter) : "all",
      showIds: showFilter ? Array.from(showFilter) : "all"
    },
    trakt: {
      watchedMovies: watchedMovieCount,
      watchedShows: watchedShowCount,
      episodeHistoryEvents: Array.from(historyByShow.values()).reduce((sum, items) => sum + items.length, 0)
    },
    stremio: {
      plannedChanges: changes.length,
      movies: changes.filter((item) => item.type === "movie").length,
      series: changes.filter((item) => item.type === "series").length,
      ids: changes.map((item) => item._id)
    },
    plannedChanges: changes
  };
}

function idFilter(raw: string | undefined): Set<string> | undefined {
  if (!raw) return undefined;
  const ids = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : undefined;
}

function matchesFilter(id: string | undefined, filterSet: Set<string> | undefined, hasAnyFilter: boolean): boolean {
  if (!filterSet) return !hasAnyFilter;
  return id !== undefined && filterSet.has(id);
}
