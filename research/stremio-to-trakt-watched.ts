import { fetchCinemetaVideoIds } from "./lib/cinemeta.js";
import { isHistoryOnlyLibraryItem } from "./lib/library-items.js";
import { boolFlag, flag, runProbe } from "./lib/probe.js";
import { getLibraryItems, resolveStremioAuthKey, type StremioLibraryItem } from "./lib/stremio.js";
import { traktPost } from "./lib/trakt.js";
import { constructFromSerialized } from "./lib/watched-bitfield.js";

await runProbe("stremio-to-trakt-watched", async (args) => {
  const apply = boolFlag(args, "apply");
  const movieFilter = idFilter(flag(args, "movie-ids"));
  const showFilter = idFilter(flag(args, "show-ids"));
  const hasAnyFilter = movieFilter !== undefined || showFilter !== undefined;
  const authKey = await resolveStremioAuthKey();
  const items = await getLibraryItems(authKey);
  const watchedMovies = items
    .filter((item) => item.type === "movie")
    .filter((item) => matchesFilter(item._id, movieFilter, hasAnyFilter))
    .filter(isMovieWatched);
  const watchedSeries = items
    .filter((item) => item.type === "series")
    .filter((item) => matchesFilter(item._id, showFilter, hasAnyFilter))
    .filter((item) => typeof item.state?.watched === "string" && item.state.watched.length > 0);

  const videoSets = await fetchCinemetaVideoIds(watchedSeries.map((item) => item._id));
  const videoSetsById = new Map(videoSets.map((set) => [set.id, set]));

  const payload = {
    movies: watchedMovies.map(toTraktMovieHistory),
    shows: watchedSeries.map((item) => toTraktShowHistory(item, videoSetsById.get(item._id))).filter((item) => item !== null)
  };

  if (!apply) {
    return {
      status: "PASS",
      message: "Dry-run complete. Re-run with --apply to write Stremio watched state to Trakt history.",
      details: summarize(movieFilter, showFilter, payload)
    };
  }

  const result = await traktPost("/sync/history", payload);
  return {
    status: "PASS",
    message: "Applied Stremio watched state to Trakt history.",
    details: {
      ...summarize(movieFilter, showFilter, payload),
      result
    }
  };
});

interface TraktMovieHistoryItem {
  title?: string;
  year?: number;
  watched_at?: string;
  ids: { imdb: string };
}

interface TraktEpisodeHistoryItem {
  number: number;
  watched_at?: string;
}

interface TraktSeasonHistoryItem {
  number: number;
  episodes: TraktEpisodeHistoryItem[];
}

interface TraktShowHistoryItem {
  title?: string;
  year?: number;
  ids: { imdb: string };
  seasons: TraktSeasonHistoryItem[];
}

function toTraktMovieHistory(item: StremioLibraryItem): TraktMovieHistoryItem {
  const output: TraktMovieHistoryItem = { ids: { imdb: item._id } };
  assignIfDefined(output, "title", stringValue(item.name));
  assignIfDefined(output, "year", numberValue(item.year));
  assignIfDefined(output, "watched_at", stringValue(item.state?.lastWatched));
  return output;
}

function toTraktShowHistory(
  item: StremioLibraryItem,
  videoSet: { videos: string[] } | undefined
): TraktShowHistoryItem | null {
  const watched = typeof item.state?.watched === "string" ? item.state.watched : null;
  if (!watched || !videoSet) return null;
  const decoded = constructFromSerialized(watched, videoSet.videos);
  const seasons = new Map<number, TraktEpisodeHistoryItem[]>();

  for (let index = 0; index < decoded.values.length; index += 1) {
    if (!decoded.values[index]) continue;
    const videoId = decoded.videoIds[index];
    if (!videoId) continue;
    const parsed = parseStremioVideoId(videoId);
    if (!parsed) continue;
    const episodes = seasons.get(parsed.season) ?? [];
    const episode: TraktEpisodeHistoryItem = { number: parsed.episode };
    assignIfDefined(episode, "watched_at", stringValue(item.state?.lastWatched));
    episodes.push(episode);
    seasons.set(parsed.season, episodes);
  }

  if (seasons.size === 0) return null;
  const output: TraktShowHistoryItem = {
    ids: { imdb: item._id },
    seasons: Array.from(seasons.entries()).map(([number, episodes]) => ({ number, episodes }))
  };
  assignIfDefined(output, "title", stringValue(item.name));
  assignIfDefined(output, "year", numberValue(item.year));
  return output;
}

function isMovieWatched(item: StremioLibraryItem): boolean {
  return Boolean(
    isHistoryOnlyLibraryItem(item)
    && Number(item.state?.flaggedWatched ?? 0) > 0
    && Number(item.state?.timesWatched ?? 0) > 0
  );
}

function parseStremioVideoId(value: string): { season: number; episode: number } | null {
  const parts = value.split(":");
  const season = Number.parseInt(parts.at(-2) ?? "", 10);
  const episode = Number.parseInt(parts.at(-1) ?? "", 10);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode };
}

function summarize(
  movieFilter: Set<string> | undefined,
  showFilter: Set<string> | undefined,
  payload: { movies: TraktMovieHistoryItem[]; shows: TraktShowHistoryItem[] }
): Record<string, unknown> {
  return {
    filters: {
      movieIds: movieFilter ? Array.from(movieFilter) : "all",
      showIds: showFilter ? Array.from(showFilter) : "all"
    },
    payloadSummary: {
      movies: payload.movies.length,
      shows: payload.shows.length,
      episodes: payload.shows.reduce((sum, show) => (
        sum + show.seasons.reduce((seasonSum, season) => seasonSum + season.episodes.length, 0)
      ), 0)
    },
    payload
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function assignIfDefined<Target extends object, Key extends keyof Target>(
  target: Target,
  key: Key,
  value: Target[Key] | undefined
): void {
  if (value !== undefined) target[key] = value;
}
