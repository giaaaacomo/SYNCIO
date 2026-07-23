import type { D1DatabaseLike } from "../storage/d1.js";
import { fetchStremioIdentity } from "../stremio/account.js";
import { fetchTraktIdentity } from "../trakt/device-oauth.js";
import {
  getStremioRatingStatus,
  getCinemetaVideoSets,
  getStremioLibrary,
  traktGet,
  traktGetAllPages,
  traktGetPage,
  type CinemetaVideoSet,
  type StremioLibraryItem
} from "./api-clients.js";
import { loadSyncCredentials } from "./credentials.js";
import { getHostedSyncSettings } from "../storage/repositories/users.js";
import { getSyncCursor } from "../storage/repositories/sync-cursors.js";
import { decodeWatchedField } from "./watched-bitfield.js";

export interface BaselineOperation {
  direction: "trakt-to-stremio" | "stremio-to-trakt";
  kind: "watched-movie" | "watched-episode" | "watchlist-movie" | "watchlist-series" | "rating-movie";
  imdb: string;
  title: string | null;
  season?: number;
  episode?: number;
  traktRating?: number;
  ratingStatus?: "liked" | "loved" | null;
}

const RATING_CURSOR_KEY = "ratings-movies";
const RATING_BATCH_SIZE = 10;
const RATING_PAGE_SIZE = 100;
export const MAX_OPERATIONS_PER_RUN = 250;

export async function previewWorkerSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  cinemetaVideoIdsBase?: string | undefined;
  stremioLikesBase?: string | undefined;
}): Promise<Record<string, unknown>> {
  const settings = await getHostedSyncSettings(input.db, input.userId);
  const ratingCursor = await getSyncCursor(input.db, input.userId, RATING_CURSOR_KEY);
  const credentials = await loadSyncCredentials({
    db: input.db,
    userId: input.userId,
    encryptionKey: input.encryptionKey,
    fetcher: input.fetcher,
    traktApiBase: input.traktApiBase
  });
  const [
    stremioIdentity,
    traktIdentity,
    library,
    watchedMovies,
    watchedShows,
    watchedEpisodeHistoryPage,
    initialRatedMoviesPage,
    watchlistMoviePages,
    watchlistShowPages
  ] = await Promise.all([
    fetchStremioIdentity(credentials.stremio.authKey, input.fetcher, input.stremioApiBase),
    fetchTraktIdentity(credentials.trakt.clientId, credentials.trakt.accessToken, input.fetcher, input.traktApiBase),
    getStremioLibrary(credentials.stremio.authKey, input.fetcher, input.stremioApiBase),
    settings.watchedEnabled
      ? traktGet("/sync/watched/movies", credentials.trakt.clientId, credentials.trakt.accessToken, input.fetcher, input.traktApiBase)
      : Promise.resolve([]),
    settings.watchedEnabled
      ? traktGet("/sync/watched/shows", credentials.trakt.clientId, credentials.trakt.accessToken, input.fetcher, input.traktApiBase)
      : Promise.resolve([]),
    settings.watchedEnabled
      ? traktGetAllPages(
        "/sync/history/episodes",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase
      )
      : Promise.resolve({ items: [], pagesFetched: 0, pageCount: 0, itemCount: 0 }),
    settings.ratingSyncEnabled
      ? traktGetPage(
        "/sync/ratings/movies",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase,
        { page: Math.floor(ratingCursor / RATING_PAGE_SIZE) + 1, limit: RATING_PAGE_SIZE }
      )
      : Promise.resolve({ items: [], page: 1, pageCount: 1, itemCount: 0 }),
    settings.libraryWatchlistEnabled
      ? traktGetAllPages(
        "/sync/watchlist/movies",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase
      )
      : Promise.resolve({ items: [], pagesFetched: 0, pageCount: 0, itemCount: 0 }),
    settings.libraryWatchlistEnabled
      ? traktGetAllPages(
        "/sync/watchlist/shows",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase
      )
      : Promise.resolve({ items: [], pagesFetched: 0, pageCount: 0, itemCount: 0 })
  ]);
  if (stremioIdentity.userId !== credentials.stremio.userId) throw new Error("Stremio account guard failed during preview.");
  if (traktIdentity.username !== credentials.trakt.username) throw new Error("Trakt account guard failed during preview.");

  const watchedEpisodeHistory = watchedEpisodeHistoryPage.items;
  let ratedMoviesPage = initialRatedMoviesPage;
  const normalizedRatingOffset = ratedMoviesPage.itemCount > 0 ? ratingCursor % ratedMoviesPage.itemCount : 0;
  const normalizedRatingPage = Math.floor(normalizedRatingOffset / RATING_PAGE_SIZE) + 1;
  if (settings.ratingSyncEnabled && normalizedRatingPage !== ratedMoviesPage.page) {
    ratedMoviesPage = await traktGetPage(
      "/sync/ratings/movies",
      credentials.trakt.clientId,
      credentials.trakt.accessToken,
      input.fetcher,
      input.traktApiBase,
      { page: normalizedRatingPage, limit: RATING_PAGE_SIZE }
    );
  }
  const showIds = new Set([
    ...inputShowImdbIds(watchedShows),
    ...inputEpisodeHistoryShowImdbIds(watchedEpisodeHistory),
    ...library.filter((item) => item.type === "series" && typeof item.state?.watched === "string").map((item) => item._id)
  ]);
  const videoSets = await getCinemetaVideoSets(Array.from(showIds), input.fetcher, input.cinemetaVideoIdsBase);
  const baseline = await buildBaselinePlan({
    library,
    watchedMovies,
    watchedShows,
    watchedEpisodeHistory,
    watchlistMovies: watchlistMoviePages.items,
    watchlistShows: watchlistShowPages.items,
    videoSets
  });
  const ratingPlan = settings.ratingSyncEnabled
    ? await ratingOperations(
      credentials.stremio.authKey,
      ratedMoviesPage.items,
      ratingCursor,
      (ratedMoviesPage.page - 1) * RATING_PAGE_SIZE,
      ratedMoviesPage.itemCount,
      settings.likeThreshold,
      settings.loveThreshold,
      input.fetcher,
      input.stremioLikesBase
    )
    : { operations: [], offset: 0, checked: 0, total: 0, nextOffset: 0 };
  const allOperations = [...ratingPlan.operations, ...baseline];
  const operations = operationBatch(baseline, ratingPlan.operations);
  const fingerprint = await operationFingerprint(operations);
  return {
    mode: "preview",
    apply: false,
    stage: "read-only-baseline",
    accounts: {
      stremio: "verified",
      trakt: "verified"
    },
    fetched: {
      stremioLibraryItems: library.length,
      traktWatchedMovies: arrayValue(watchedMovies).length,
      traktWatchedShows: arrayValue(watchedShows).length,
      traktEpisodeHistoryEvents: arrayValue(watchedEpisodeHistory).length,
      traktEpisodeHistoryPages: watchedEpisodeHistoryPage.pagesFetched,
      traktEpisodeHistoryTotal: watchedEpisodeHistoryPage.itemCount,
      traktRatedMovies: ratedMoviesPage.itemCount,
      traktRatedMoviesPage: ratedMoviesPage.page,
      traktRatedMoviesChecked: ratingPlan.checked,
      traktWatchlistMovies: watchlistMoviePages.itemCount,
      traktWatchlistMoviePages: watchlistMoviePages.pagesFetched,
      traktWatchlistShows: watchlistShowPages.itemCount,
      traktWatchlistShowPages: watchlistShowPages.pagesFetched
    },
    operations: {
      total: operations.length,
      totalDifferences: allOperations.length,
      deferred: allOperations.length - operations.length,
      hasMore: allOperations.length > operations.length,
      fingerprint,
      items: operations
    },
    ratingScan: {
      cursorKey: RATING_CURSOR_KEY,
      offset: ratingPlan.offset,
      checked: ratingPlan.checked,
      total: ratingPlan.total,
      nextOffset: ratingPlan.nextOffset
    },
    pendingCoverage: []
  };
}

export function operationBatch(
  baseline: BaselineOperation[],
  ratingOperations: BaselineOperation[]
): BaselineOperation[] {
  return [...ratingOperations, ...baseline].slice(0, MAX_OPERATIONS_PER_RUN);
}

async function ratingOperations(
  authKey: string,
  ratedMovies: unknown,
  rawOffset: number,
  pageStart: number,
  totalRatings: number,
  likeThreshold: number,
  loveThreshold: number,
  fetcher: typeof fetch,
  likesBase?: string
): Promise<{
  operations: BaselineOperation[];
  offset: number;
  checked: number;
  total: number;
  nextOffset: number;
}> {
  const pageRatings = arrayValue(ratedMovies);
  const offset = totalRatings > 0 ? rawOffset % totalRatings : 0;
  const localOffset = Math.max(0, offset - pageStart);
  const batch = pageRatings.slice(localOffset, localOffset + RATING_BATCH_SIZE);
  if (totalRatings > offset && batch.length === 0) {
    throw new Error("Trakt ratings pagination returned an empty page before the declared end.");
  }
  const operations: BaselineOperation[] = [];
  for (const itemValue of batch) {
    const item = recordValue(itemValue);
    const movie = recordValue(item.movie);
    const ids = recordValue(movie.ids);
    if (typeof ids.imdb !== "string" || typeof item.rating !== "number") continue;
    const target = mapTraktRating(item.rating, likeThreshold, loveThreshold);
    const current = await getStremioRatingStatus(authKey, ids.imdb, "movie", fetcher, likesBase);
    if (current === target) continue;
    operations.push({
      direction: "trakt-to-stremio",
      kind: "rating-movie",
      imdb: ids.imdb,
      title: stringOrNull(movie.title),
      traktRating: item.rating,
      ratingStatus: target
    });
  }
  const nextOffset = offset + batch.length >= totalRatings ? 0 : offset + batch.length;
  return { operations, offset, checked: batch.length, total: totalRatings, nextOffset };
}

export function mapTraktRating(
  rating: number,
  likeThreshold = 7,
  loveThreshold = 9
): "liked" | "loved" | null {
  if (rating >= loveThreshold) return "loved";
  if (rating >= likeThreshold) return "liked";
  return null;
}

export async function operationFingerprint(operations: BaselineOperation[]): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify(operations));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildBaselinePlan(input: {
  library: StremioLibraryItem[];
  watchedMovies: unknown;
  watchedShows?: unknown;
  watchedEpisodeHistory?: unknown;
  watchlistMovies: unknown;
  watchlistShows?: unknown;
  videoSets?: CinemetaVideoSet[];
}): Promise<BaselineOperation[]> {
  const stremioWatched = new Map(
    input.library.filter((item) => item.type === "movie" && isStremioMovieWatched(item)).map((item) => [item._id, item])
  );
  const visibleLibraryMovies = new Map(
    input.library
      .filter((item) => item.type === "movie" && isVisibleLibraryItem(item) && isImdbId(item._id))
      .map((item) => [item._id, item])
  );
  const visibleLibraryShows = new Map(
    input.library
      .filter((item) => item.type === "series" && isVisibleLibraryItem(item) && isImdbId(item._id))
      .map((item) => [item._id, item])
  );
  const traktWatched = mediaMap(input.watchedMovies, "movie");
  const traktWatchlistMovies = mediaMap(input.watchlistMovies, "movie");
  const traktWatchlistShows = mediaMap(input.watchlistShows, "show");
  const operations: BaselineOperation[] = [];

  for (const [imdb, movie] of traktWatched) {
    if (!stremioWatched.has(imdb)) operations.push({
      direction: "trakt-to-stremio",
      kind: "watched-movie",
      imdb,
      title: stringOrNull(movie.title)
    });
  }
  for (const [imdb, movie] of stremioWatched) {
    if (!traktWatched.has(imdb)) operations.push({
      direction: "stremio-to-trakt",
      kind: "watched-movie",
      imdb,
      title: stringOrNull(movie.name)
    });
  }
  for (const [imdb, movie] of traktWatchlistMovies) {
    if (!visibleLibraryMovies.has(imdb)) operations.push({
      direction: "trakt-to-stremio",
      kind: "watchlist-movie",
      imdb,
      title: stringOrNull(movie.title)
    });
  }
  for (const [imdb, movie] of visibleLibraryMovies) {
    if (!traktWatchlistMovies.has(imdb)) operations.push({
      direction: "stremio-to-trakt",
      kind: "watchlist-movie",
      imdb,
      title: stringOrNull(movie.name)
    });
  }
  for (const [imdb, show] of traktWatchlistShows) {
    if (!visibleLibraryShows.has(imdb)) operations.push({
      direction: "trakt-to-stremio",
      kind: "watchlist-series",
      imdb,
      title: stringOrNull(show.title)
    });
  }
  for (const [imdb, show] of visibleLibraryShows) {
    if (!traktWatchlistShows.has(imdb)) operations.push({
      direction: "stremio-to-trakt",
      kind: "watchlist-series",
      imdb,
      title: stringOrNull(show.name)
    });
  }
  operations.push(...await episodeOperations(
    input.library,
    input.watchedShows,
    input.watchedEpisodeHistory,
    input.videoSets ?? []
  ));
  return operations;
}

async function episodeOperations(
  library: StremioLibraryItem[],
  watchedShows: unknown,
  watchedEpisodeHistory: unknown,
  videoSets: CinemetaVideoSet[]
): Promise<BaselineOperation[]> {
  const traktShows = watchedShowMap(watchedShows, watchedEpisodeHistory);
  const libraryById = new Map(library.filter((item) => item.type === "series").map((item) => [item._id, item]));
  const operations: BaselineOperation[] = [];

  for (const videoSet of videoSets) {
    const item = libraryById.get(videoSet.id);
    const decoded = await decodeWatchedField(
      typeof item?.state?.watched === "string" ? item.state.watched : null,
      videoSet.videos
    );
    const stremioEpisodes = new Set(decoded.videoIds.filter((_id, index) => decoded.values[index]));
    const traktShow = traktShows.get(videoSet.id);
    const traktEpisodes = traktShow?.episodes ?? new Set<string>();

    for (const videoId of traktEpisodes) {
      if (stremioEpisodes.has(videoId) || !videoSet.videos.includes(videoId)) continue;
      const episode = parseVideoId(videoId);
      if (episode) operations.push({
        direction: "trakt-to-stremio",
        kind: "watched-episode",
        imdb: videoSet.id,
        title: traktShow?.title ?? videoSet.name,
        ...episode
      });
    }
    for (const videoId of stremioEpisodes) {
      if (traktEpisodes.has(videoId)) continue;
      const episode = parseVideoId(videoId);
      if (episode) operations.push({
        direction: "stremio-to-trakt",
        kind: "watched-episode",
        imdb: videoSet.id,
        title: stringOrNull(item?.name) ?? videoSet.name,
        ...episode
      });
    }
  }
  return operations;
}

function watchedShowMap(
  value: unknown,
  episodeHistory?: unknown
): Map<string, { title: string | null; episodes: Set<string> }> {
  const output = new Map<string, { title: string | null; episodes: Set<string> }>();
  for (const itemValue of arrayValue(value)) {
    const item = recordValue(itemValue);
    const show = recordValue(item.show);
    const ids = recordValue(show.ids);
    if (typeof ids.imdb !== "string") continue;
    const episodes = new Set<string>();
    for (const seasonValue of arrayValue(item.seasons)) {
      const season = recordValue(seasonValue);
      if (typeof season.number !== "number") continue;
      for (const episodeValue of arrayValue(season.episodes)) {
        const episode = recordValue(episodeValue);
        if (typeof episode.number === "number") episodes.add(`${ids.imdb}:${season.number}:${episode.number}`);
      }
    }
    output.set(ids.imdb, { title: stringOrNull(show.title), episodes });
  }
  for (const eventValue of arrayValue(episodeHistory)) {
    const event = recordValue(eventValue);
    const show = recordValue(event.show);
    const showIds = recordValue(show.ids);
    const episode = recordValue(event.episode);
    if (typeof showIds.imdb !== "string" || typeof episode.season !== "number" || typeof episode.number !== "number") {
      continue;
    }
    const existing = output.get(showIds.imdb) ?? {
      title: stringOrNull(show.title),
      episodes: new Set<string>()
    };
    existing.episodes.add(`${showIds.imdb}:${episode.season}:${episode.number}`);
    output.set(showIds.imdb, existing);
  }
  return output;
}

function inputShowImdbIds(value: unknown): string[] {
  return Array.from(watchedShowMap(value).keys());
}

function inputEpisodeHistoryShowImdbIds(value: unknown): string[] {
  return Array.from(watchedShowMap([], value).keys());
}

function parseVideoId(value: string): { season: number; episode: number } | null {
  const match = /:(\d+):(\d+)$/.exec(value);
  if (!match) return null;
  return { season: Number(match[1]), episode: Number(match[2]) };
}

function mediaMap(value: unknown, field: string): Map<string, Record<string, unknown>> {
  const output = new Map<string, Record<string, unknown>>();
  for (const itemValue of arrayValue(value)) {
    const item = recordValue(itemValue);
    const media = recordValue(item[field]);
    const ids = recordValue(media.ids);
    if (typeof ids.imdb === "string" && ids.imdb.length > 0) output.set(ids.imdb, media);
  }
  return output;
}

function isStremioMovieWatched(item: StremioLibraryItem): boolean {
  return Number(item.state?.flaggedWatched ?? 0) > 0 || Number(item.state?.timesWatched ?? 0) > 0;
}

function isVisibleLibraryItem(item: StremioLibraryItem): boolean {
  return item.removed === false && item.temp === false;
}

function isImdbId(value: string): boolean {
  return /^tt\d+$/.test(value);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
