import { fetchCinemetaVideoIds } from "./cinemeta.js";
import { buildEpisodeWatchedChange, buildMovieWatchedChange, findLibraryItem, isHistoryOnlyLibraryItem } from "./library-items.js";
import { ProbeAbort } from "./probe.js";
import { getLibraryItems, putLibraryChanges, resolveStremioAuthKey, type StremioLibraryItem } from "./stremio.js";
import {
  hasAppliedOperation,
  loadSyncState,
  markAppliedOperation,
  resolveStatePath,
  saveSyncState,
  watchedEpisodeKey,
  watchedMovieKey,
  type SyncioState
} from "./sync-state.js";
import { parseHistoryEpisodes, parseWatchedMovies, parseWatchedShows, type TraktHistoryEpisode } from "./trakt-media.js";
import { traktPost, traktRequest } from "./trakt.js";
import { constructFromSerialized, setVideoWatched } from "./watched-bitfield.js";

export type WatchedSyncDirection = "both" | "trakt-to-stremio" | "stremio-to-trakt";
type OperationStatus = "planned" | "state-skip" | "target-skip";

export interface WatchedSyncOptions {
  direction?: WatchedSyncDirection;
  maxShows?: number;
  movieIds?: string[];
  showIds?: string[];
  statePath?: string;
  allowUnfilteredApply?: boolean;
}

export interface WatchedSyncApplyResult extends Record<string, unknown> {
  applyResults: Record<string, unknown>;
}

interface PlannedOperation {
  key: string;
  direction: Exclude<WatchedSyncDirection, "both">;
  kind: "movie" | "episode";
  summary: string;
  status: OperationStatus;
  reason?: string;
}

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

interface TraktToStremioPlan {
  operations: PlannedOperation[];
  changes: StremioLibraryItem[];
  fetched: {
    watchedMovies: number;
    watchedShows: number;
    episodeHistoryEvents: number;
  };
}

interface StremioToTraktPlan {
  operations: PlannedOperation[];
  payload: {
    movies: TraktMovieHistoryItem[];
    shows: TraktShowHistoryItem[];
  };
  fetched: {
    stremioItems: number;
    traktWatchedMovies: number;
    traktEpisodeHistoryEvents: number;
  };
}

export async function planWatchedSync(options: WatchedSyncOptions = {}): Promise<Record<string, unknown>> {
  const prepared = await prepareWatchedSync(options);
  return summarize(
    prepared.direction,
    prepared.statePath,
    prepared.movieFilter,
    prepared.showFilter,
    prepared.hasAnyFilter,
    prepared.plans
  );
}

export async function applyWatchedSync(options: WatchedSyncOptions = {}): Promise<WatchedSyncApplyResult> {
  const prepared = await prepareWatchedSync(options);

  if (!options.allowUnfilteredApply && !prepared.hasAnyFilter) {
    throw new ProbeAbort(
      "FAIL",
      "Refusing unfiltered apply. Add --movie-ids/--show-ids, or pass --allow-unfiltered-apply once we intentionally sync the whole test account."
    );
  }

  const appliedAt = new Date().toISOString();
  const applyResults: Record<string, unknown> = {};

  if (prepared.plans.traktToStremio) {
    applyResults.traktToStremio = prepared.plans.traktToStremio.changes.length > 0
      ? await putLibraryChanges(prepared.authKey, prepared.plans.traktToStremio.changes)
      : { success: true };
    markPlannedOperations(prepared.state, prepared.plans.traktToStremio.operations, appliedAt);
  }

  if (prepared.plans.stremioToTrakt) {
    const payload = prepared.plans.stremioToTrakt.payload;
    const hasPayload = payload.movies.length > 0 || payload.shows.length > 0;
    applyResults.stremioToTrakt = hasPayload
      ? await traktPost("/sync/history", payload)
      : { added: { movies: 0, episodes: 0 } };
    markPlannedOperations(prepared.state, prepared.plans.stremioToTrakt.operations, appliedAt);
  }

  await saveSyncState(prepared.statePath, prepared.state);

  return {
    ...summarize(
      prepared.direction,
      prepared.statePath,
      prepared.movieFilter,
      prepared.showFilter,
      prepared.hasAnyFilter,
      prepared.plans
    ),
    applyResults
  };
}

async function prepareWatchedSync(options: WatchedSyncOptions): Promise<{
  authKey: string;
  state: SyncioState;
  statePath: string;
  direction: WatchedSyncDirection;
  movieFilter: Set<string> | undefined;
  showFilter: Set<string> | undefined;
  hasAnyFilter: boolean;
  plans: {
    traktToStremio?: TraktToStremioPlan;
    stremioToTrakt?: StremioToTraktPlan;
  };
}> {
  const direction = parseDirection(options.direction ?? "both");
  const maxShows = options.maxShows ?? 25;
  const movieFilter = idFilterFromList(options.movieIds);
  const showFilter = idFilterFromList(options.showIds);
  const hasAnyFilter = movieFilter !== undefined || showFilter !== undefined;
  const statePath = resolveStatePath(options.statePath);
  const state = await loadSyncState(statePath);
  const authKey = await resolveStremioAuthKey();
  const plans: {
    traktToStremio?: TraktToStremioPlan;
    stremioToTrakt?: StremioToTraktPlan;
  } = {};

  if (direction === "both" || direction === "trakt-to-stremio") {
    plans.traktToStremio = await planTraktToStremio({
      authKey,
      state,
      movieFilter,
      showFilter,
      hasAnyFilter,
      maxShows
    });
  }

  if (direction === "both" || direction === "stremio-to-trakt") {
    plans.stremioToTrakt = await planStremioToTrakt({
      authKey,
      state,
      movieFilter,
      showFilter,
      hasAnyFilter
    });
  }

  return { authKey, state, statePath, direction, movieFilter, showFilter, hasAnyFilter, plans };
}

async function planTraktToStremio(input: {
  authKey: string;
  state: SyncioState;
  movieFilter: Set<string> | undefined;
  showFilter: Set<string> | undefined;
  hasAnyFilter: boolean;
  maxShows: number;
}): Promise<TraktToStremioPlan> {
  const [watchedMoviesPage, watchedShowsPage, existingItems] = await Promise.all([
    traktRequest("/sync/watched/movies"),
    traktRequest("/sync/watched/shows"),
    getLibraryItems(input.authKey)
  ]);

  const watchedMovies = parseWatchedMovies(watchedMoviesPage.body)
    .filter((item) => typeof item.movie.ids.imdb === "string")
    .filter((item) => matchesFilter(item.movie.ids.imdb, input.movieFilter, input.hasAnyFilter));
  const watchedShows = parseWatchedShows(watchedShowsPage.body)
    .filter((item) => typeof item.show.ids.imdb === "string" && typeof item.show.ids.trakt === "number")
    .filter((item) => matchesFilter(item.show.ids.imdb, input.showFilter, input.hasAnyFilter))
    .slice(0, input.maxShows);

  const historyByShow = await fetchEpisodeHistoryByShow(watchedShows.map((item) => item.show.ids.trakt));
  const videoSets = await fetchCinemetaVideoIds(
    watchedShows.map((item) => item.show.ids.imdb).filter((id): id is string => Boolean(id))
  );
  const videoSetsById = new Map(videoSets.map((set) => [set.id, set]));
  const operations: PlannedOperation[] = [];
  const changes: StremioLibraryItem[] = [];

  for (const item of watchedMovies) {
    const imdb = item.movie.ids.imdb;
    if (!imdb) continue;
    const key = watchedMovieKey("trakt-to-stremio", imdb, item.watchedAt);
    const existing = findLibraryItem(existingItems, imdb);
    const summary = `movie ${imdb} ${item.movie.title}`;
    if (hasAppliedOperation(input.state, key)) {
      operations.push(operation(key, "trakt-to-stremio", "movie", summary, "state-skip", "already applied from local state"));
      continue;
    }
    if (existing && isMovieWatched(existing)) {
      operations.push(operation(key, "trakt-to-stremio", "movie", summary, "target-skip", "already watched in Stremio"));
      continue;
    }
    operations.push(operation(key, "trakt-to-stremio", "movie", summary, "planned"));
    changes.push(buildMovieWatchedChange({
      existing,
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
    if (!videoSet) throw new ProbeAbort("FAIL", `Cinemeta returned no video IDs for ${showImdb}.`);

    const existing = findLibraryItem(existingItems, showImdb);
    let watchedField = typeof existing?.state?.watched === "string" ? existing.state.watched : null;
    let changed = false;

    const watchedEpisodes = uniqueWatchedEpisodes(historyByShow.get(showTrakt) ?? [])
      .filter((episode) => videoSet.videos.includes(`${showImdb}:${episode.episode.season}:${episode.episode.number}`));
    for (const episode of watchedEpisodes) {
      const videoId = `${showImdb}:${episode.episode.season}:${episode.episode.number}`;
      const key = watchedEpisodeKey(
        "trakt-to-stremio",
        showImdb,
        episode.episode.season,
        episode.episode.number,
        episode.watchedAt
      );
      const summary = `episode ${showImdb} S${episode.episode.season}E${episode.episode.number}`;
      if (hasAppliedOperation(input.state, key)) {
        operations.push(operation(key, "trakt-to-stremio", "episode", summary, "state-skip", "already applied from local state"));
        continue;
      }
      if (isEpisodeWatchedInStremio(existing, videoSet.videos, videoId)) {
        operations.push(operation(key, "trakt-to-stremio", "episode", summary, "target-skip", "already watched in Stremio"));
        continue;
      }
      watchedField = setVideoWatched(watchedField, videoSet.videos, videoId, true);
      changed = true;
      operations.push(operation(key, "trakt-to-stremio", "episode", summary, "planned"));
    }

    if (!changed) continue;
    const latestWatchedAt = watchedEpisodes.map((episode) => episode.watchedAt).sort().at(-1) ?? item.watchedAt;
    changes.push(buildEpisodeWatchedChange({
      existing,
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

  return {
    operations,
    changes,
    fetched: {
      watchedMovies: watchedMovies.length,
      watchedShows: watchedShows.length,
      episodeHistoryEvents: Array.from(historyByShow.values()).reduce((sum, items) => sum + items.length, 0)
    }
  };
}

async function planStremioToTrakt(input: {
  authKey: string;
  state: SyncioState;
  movieFilter: Set<string> | undefined;
  showFilter: Set<string> | undefined;
  hasAnyFilter: boolean;
}): Promise<StremioToTraktPlan> {
  const [existingItems, traktWatchedMoviesPage] = await Promise.all([
    getLibraryItems(input.authKey),
    traktRequest("/sync/watched/movies")
  ]);

  const traktWatchedMovieIds = new Set(
    parseWatchedMovies(traktWatchedMoviesPage.body)
      .map((item) => item.movie.ids.imdb)
      .filter((id): id is string => Boolean(id))
  );
  const watchedMovies = existingItems
    .filter((item) => item.type === "movie")
    .filter((item) => matchesFilter(item._id, input.movieFilter, input.hasAnyFilter))
    .filter(isMovieWatched);
  const watchedSeries = existingItems
    .filter((item) => item.type === "series")
    .filter((item) => matchesFilter(item._id, input.showFilter, input.hasAnyFilter))
    .filter((item) => typeof item.state?.watched === "string" && item.state.watched.length > 0);

  const videoSets = await fetchCinemetaVideoIds(watchedSeries.map((item) => item._id));
  const videoSetsById = new Map(videoSets.map((set) => [set.id, set]));
  const showLookups = await lookupTraktShowIds(watchedSeries.map((item) => item._id));
  const historyByShow = await fetchEpisodeHistoryByShow(Array.from(showLookups.values()));
  const operations: PlannedOperation[] = [];
  const movies: TraktMovieHistoryItem[] = [];
  const shows = new Map<string, TraktShowHistoryItem>();

  for (const item of watchedMovies) {
    const watchedAt = stringValue(item.state?.lastWatched);
    const key = watchedMovieKey("stremio-to-trakt", item._id, watchedAt);
    const summary = `movie ${item._id} ${item.name ?? ""}`.trim();
    if (hasAppliedOperation(input.state, key)) {
      operations.push(operation(key, "stremio-to-trakt", "movie", summary, "state-skip", "already applied from local state"));
      continue;
    }
    if (traktWatchedMovieIds.has(item._id)) {
      operations.push(operation(key, "stremio-to-trakt", "movie", summary, "target-skip", "already watched in Trakt"));
      continue;
    }
    operations.push(operation(key, "stremio-to-trakt", "movie", summary, "planned"));
    movies.push(toTraktMovieHistory(item));
  }

  for (const item of watchedSeries) {
    const videoSet = videoSetsById.get(item._id);
    if (!videoSet || typeof item.state?.watched !== "string") continue;
    const showTraktId = showLookups.get(item._id);
    const remoteEpisodes = showTraktId ? episodeKeySet(historyByShow.get(showTraktId) ?? []) : new Set<string>();
    const decoded = constructFromSerialized(item.state.watched, videoSet.videos);

    for (let index = 0; index < decoded.values.length; index += 1) {
      if (!decoded.values[index]) continue;
      const videoId = decoded.videoIds[index];
      if (!videoId) continue;
      const parsed = parseStremioVideoId(videoId);
      if (!parsed) continue;

      const watchedAt = stringValue(item.state.lastWatched);
      const key = watchedEpisodeKey("stremio-to-trakt", item._id, parsed.season, parsed.episode, watchedAt);
      const summary = `episode ${item._id} S${parsed.season}E${parsed.episode}`;
      if (hasAppliedOperation(input.state, key)) {
        operations.push(operation(key, "stremio-to-trakt", "episode", summary, "state-skip", "already applied from local state"));
        continue;
      }
      if (remoteEpisodes.has(`${parsed.season}:${parsed.episode}`)) {
        operations.push(operation(key, "stremio-to-trakt", "episode", summary, "target-skip", "already watched in Trakt"));
        continue;
      }

      operations.push(operation(key, "stremio-to-trakt", "episode", summary, "planned"));
      const show = getOrCreateTraktShow(shows, item);
      const season = getOrCreateTraktSeason(show, parsed.season);
      const episode: TraktEpisodeHistoryItem = { number: parsed.episode };
      assignIfDefined(episode, "watched_at", watchedAt);
      season.episodes.push(episode);
    }
  }

  return {
    operations,
    payload: { movies, shows: Array.from(shows.values()) },
    fetched: {
      stremioItems: existingItems.length,
      traktWatchedMovies: traktWatchedMovieIds.size,
      traktEpisodeHistoryEvents: Array.from(historyByShow.values()).reduce((sum, items) => sum + items.length, 0)
    }
  };
}

async function fetchEpisodeHistoryByShow(showTraktIds: Array<number | undefined>): Promise<Map<number, TraktHistoryEpisode[]>> {
  const output = new Map<number, TraktHistoryEpisode[]>();
  for (const showTraktId of showTraktIds) {
    if (showTraktId === undefined) continue;
    const page = await traktRequest(`/sync/history/shows/${showTraktId}`);
    output.set(showTraktId, parseHistoryEpisodes(page.body));
  }
  return output;
}

async function lookupTraktShowIds(imdbIds: string[]): Promise<Map<string, number>> {
  const output = new Map<string, number>();
  for (const imdb of imdbIds) {
    const result = await traktRequest(`/search/imdb/${imdb}?type=show`);
    if (!Array.isArray(result.body)) continue;
    const traktId = result.body.map(extractShowTraktId).find((id) => id !== undefined);
    if (traktId !== undefined) output.set(imdb, traktId);
  }
  return output;
}

function extractShowTraktId(value: unknown): number | undefined {
  const item = record(value);
  const show = record(item.show);
  const ids = record(show.ids);
  return numberValue(ids.trakt);
}

function getOrCreateTraktShow(shows: Map<string, TraktShowHistoryItem>, item: StremioLibraryItem): TraktShowHistoryItem {
  const existing = shows.get(item._id);
  if (existing) return existing;
  const created: TraktShowHistoryItem = { ids: { imdb: item._id }, seasons: [] };
  assignIfDefined(created, "title", stringValue(item.name));
  assignIfDefined(created, "year", numberValue(item.year));
  shows.set(item._id, created);
  return created;
}

function getOrCreateTraktSeason(show: TraktShowHistoryItem, seasonNumber: number): TraktSeasonHistoryItem {
  let season = show.seasons.find((item) => item.number === seasonNumber);
  if (!season) {
    season = { number: seasonNumber, episodes: [] };
    show.seasons.push(season);
  }
  return season;
}

function toTraktMovieHistory(item: StremioLibraryItem): TraktMovieHistoryItem {
  const output: TraktMovieHistoryItem = { ids: { imdb: item._id } };
  assignIfDefined(output, "title", stringValue(item.name));
  assignIfDefined(output, "year", numberValue(item.year));
  assignIfDefined(output, "watched_at", stringValue(item.state?.lastWatched));
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

function episodeKeySet(history: TraktHistoryEpisode[]): Set<string> {
  return new Set(uniqueWatchedEpisodes(history).map((item) => `${item.episode.season}:${item.episode.number}`));
}

function isMovieWatched(item: StremioLibraryItem): boolean {
  return Boolean(
    isHistoryOnlyLibraryItem(item)
    && Number(item.state?.flaggedWatched ?? 0) > 0
    && Number(item.state?.timesWatched ?? 0) > 0
  );
}

function isEpisodeWatchedInStremio(
  item: StremioLibraryItem | undefined,
  videoIds: string[],
  targetVideoId: string
): boolean {
  if (typeof item?.state?.watched !== "string") return false;
  const decoded = constructFromSerialized(item.state.watched, videoIds);
  const index = decoded.videoIds.indexOf(targetVideoId);
  return index !== -1 && decoded.values[index] === true;
}

function parseStremioVideoId(value: string): { season: number; episode: number } | null {
  const parts = value.split(":");
  const season = Number.parseInt(parts.at(-2) ?? "", 10);
  const episode = Number.parseInt(parts.at(-1) ?? "", 10);
  if (!Number.isFinite(season) || !Number.isFinite(episode)) return null;
  return { season, episode };
}

function operation(
  key: string,
  direction: Exclude<WatchedSyncDirection, "both">,
  kind: "movie" | "episode",
  summary: string,
  status: OperationStatus,
  reason?: string
): PlannedOperation {
  const output: PlannedOperation = { key, direction, kind, summary, status };
  assignIfDefined(output, "reason", reason);
  return output;
}

function markPlannedOperations(state: SyncioState, operations: PlannedOperation[], appliedAt: string): void {
  for (const item of operations.filter((candidate) => candidate.status === "planned")) {
    markAppliedOperation(state, item, appliedAt);
  }
}

function summarize(
  direction: WatchedSyncDirection,
  statePath: string,
  movieFilter: Set<string> | undefined,
  showFilter: Set<string> | undefined,
  hasAnyFilter: boolean,
  plans: { traktToStremio?: TraktToStremioPlan; stremioToTrakt?: StremioToTraktPlan }
): Record<string, unknown> {
  const t2s = plans.traktToStremio;
  const s2t = plans.stremioToTrakt;
  return {
    direction,
    statePath,
    filters: {
      movieIds: filterSummary(movieFilter, hasAnyFilter),
      showIds: filterSummary(showFilter, hasAnyFilter)
    },
    traktToStremio: t2s ? {
      fetched: t2s.fetched,
      operations: operationSummary(t2s.operations),
      plannedStremioChanges: t2s.changes.length,
      plannedIds: t2s.changes.map((item) => item._id),
      plannedStremioItems: t2s.changes.map((item) => ({
        id: item._id,
        name: item.name,
        type: item.type,
        visibleLibraryItem: item.removed === false && item.temp === false,
        historyOnly: item.removed === true && item.temp === true
      }))
    } : undefined,
    stremioToTrakt: s2t ? {
      fetched: s2t.fetched,
      operations: operationSummary(s2t.operations),
      payloadSummary: {
        movies: s2t.payload.movies.length,
        shows: s2t.payload.shows.length,
        episodes: s2t.payload.shows.reduce((sum, show) => (
          sum + show.seasons.reduce((seasonSum, season) => seasonSum + season.episodes.length, 0)
        ), 0)
      },
      payload: s2t.payload
    } : undefined
  };
}

function operationSummary(operations: PlannedOperation[]): Record<string, unknown> {
  return {
    total: operations.length,
    planned: operations.filter((item) => item.status === "planned").length,
    stateSkipped: operations.filter((item) => item.status === "state-skip").length,
    targetSkipped: operations.filter((item) => item.status === "target-skip").length,
    items: operations
  };
}

function filterSummary(filterSet: Set<string> | undefined, hasAnyFilter: boolean): string | string[] {
  if (filterSet) return Array.from(filterSet);
  return hasAnyFilter ? "none" : "all";
}

function parseDirection(value: string): WatchedSyncDirection {
  if (value === "both" || value === "trakt-to-stremio" || value === "stremio-to-trakt") return value;
  throw new ProbeAbort("FAIL", "--direction must be both, trakt-to-stremio, or stremio-to-trakt.");
}

function idFilterFromList(raw: string[] | undefined): Set<string> | undefined {
  if (!raw || raw.length === 0) return undefined;
  const ids = raw.map((item) => item.trim()).filter(Boolean);
  return ids.length > 0 ? new Set(ids) : undefined;
}

function matchesFilter(id: string | undefined, filterSet: Set<string> | undefined, hasAnyFilter: boolean): boolean {
  if (!filterSet) return !hasAnyFilter;
  return id !== undefined && filterSet.has(id);
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
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
