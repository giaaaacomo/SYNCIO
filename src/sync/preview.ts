import type { D1DatabaseLike } from "../storage/d1.js";
import { fetchStremioIdentity } from "../stremio/account.js";
import { fetchTraktIdentity } from "../trakt/device-oauth.js";
import {
  getStremioRatingStatus,
  getCinemetaVideoSets,
  getStremioLibrary,
  traktGet,
  traktGetAllPages,
  type CinemetaVideoSet,
  type StremioLibraryItem,
  type StremioRatingStatus
} from "./api-clients.js";
import { loadSyncCredentials } from "./credentials.js";
import { getHostedSyncSettings } from "../storage/repositories/users.js";
import { getSyncCursor } from "../storage/repositories/sync-cursors.js";
import { decodeWatchedField } from "./watched-bitfield.js";

export interface BaselineOperation {
  direction: "trakt-to-stremio" | "stremio-to-trakt";
  kind: "watched-movie" | "watched-episode" | "watchlist-movie" | "watchlist-series" | "rating-movie" | "rating-series";
  imdb: string;
  title: string | null;
  season?: number;
  episode?: number;
  traktRating?: number;
  ratingStatus?: "liked" | "loved" | null;
}

const RATING_CURSOR_KEY = "ratings-known-items";
const RATING_BATCH_SIZE = 10;
export const MAX_OPERATIONS_PER_RUN = 250;

export async function previewWorkerSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  stremioTraktClientId?: string | undefined;
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
    traktApiBase: input.traktApiBase,
    stremioApiBase: input.stremioApiBase,
    stremioTraktClientId: input.stremioTraktClientId
  });
  const [
    stremioIdentity,
    traktIdentity,
    library,
    watchedMovies,
    watchedShows,
    watchedEpisodeHistoryPage,
    ratedMoviePages,
    ratedShowPages,
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
      ? traktGetAllPages(
        "/users/me/ratings/movies",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase,
        { limit: 250, maxPages: 10 }
      )
      : Promise.resolve({ items: [], pagesFetched: 0, pageCount: 0, itemCount: 0 }),
    settings.ratingSyncEnabled
      ? traktGetAllPages(
        "/users/me/ratings/shows",
        credentials.trakt.clientId,
        credentials.trakt.accessToken,
        input.fetcher,
        input.traktApiBase,
        { limit: 250, maxPages: 10 }
      )
      : Promise.resolve({ items: [], pagesFetched: 0, pageCount: 0, itemCount: 0 }),
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
    ? await buildRatingOperations(
      credentials.stremio.authKey,
      library,
      ratedMoviePages.items,
      ratedShowPages.items,
      ratingCursor,
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
      trakt: "verified",
      traktTransport: credentials.trakt.authMode
    },
    fetched: {
      stremioLibraryItems: library.length,
      traktWatchedMovies: arrayValue(watchedMovies).length,
      traktWatchedShows: arrayValue(watchedShows).length,
      traktEpisodeHistoryEvents: arrayValue(watchedEpisodeHistory).length,
      traktEpisodeHistoryPages: watchedEpisodeHistoryPage.pagesFetched,
      traktEpisodeHistoryTotal: watchedEpisodeHistoryPage.itemCount,
      traktRatedMovies: ratedMoviePages.itemCount,
      traktRatedMoviePages: ratedMoviePages.pagesFetched,
      traktRatedShows: ratedShowPages.itemCount,
      traktRatedShowPages: ratedShowPages.pagesFetched,
      stremioRatingCandidatesChecked: ratingPlan.checked,
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
    pendingCoverage: ratingPlan.nextOffset !== 0
      ? [{
        feature: "stremio-ratings",
        strategy: "known-library-item-sweep",
        remainingInCycle: ratingPlan.total - ratingPlan.nextOffset
      }]
      : []
  };
}

export function operationBatch(
  baseline: BaselineOperation[],
  ratingOperations: BaselineOperation[]
): BaselineOperation[] {
  return [...ratingOperations, ...baseline].slice(0, MAX_OPERATIONS_PER_RUN);
}

export async function buildRatingOperations(
  authKey: string,
  library: StremioLibraryItem[],
  ratedMovies: unknown,
  ratedShows: unknown,
  rawOffset: number,
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
  const traktRatings = new Map<string, {
    mediaType: "movie" | "series";
    title: string | null;
    rating: number;
  }>();
  addTraktRatings(traktRatings, ratedMovies, "movie");
  addTraktRatings(traktRatings, ratedShows, "series");

  const candidates = new Map<string, {
    imdb: string;
    mediaType: "movie" | "series";
    title: string | null;
  }>();
  for (const item of library) {
    if (!isImdbId(item._id) || (item.type !== "movie" && item.type !== "series")) continue;
    candidates.set(ratingKey(item.type, item._id), {
      imdb: item._id,
      mediaType: item.type,
      title: stringOrNull(item.name)
    });
  }
  for (const [key, item] of traktRatings) {
    if (!candidates.has(key)) candidates.set(key, {
      imdb: key.slice(key.indexOf(":") + 1),
      mediaType: item.mediaType,
      title: item.title
    });
  }

  const knownItems = Array.from(candidates.values()).sort((left, right) =>
    ratingKey(left.mediaType, left.imdb).localeCompare(ratingKey(right.mediaType, right.imdb))
  );
  const totalRatings = knownItems.length;
  const offset = totalRatings > 0 ? rawOffset % totalRatings : 0;
  const batch = knownItems.slice(offset, offset + RATING_BATCH_SIZE);
  const operations: BaselineOperation[] = [];
  for (const candidate of batch) {
    const current = await getStremioRatingStatus(
      authKey,
      candidate.imdb,
      candidate.mediaType,
      fetcher,
      likesBase
    );
    const trakt = traktRatings.get(ratingKey(candidate.mediaType, candidate.imdb));
    const kind = candidate.mediaType === "movie" ? "rating-movie" : "rating-series";
    if (trakt) {
      const target = mapTraktRating(trakt.rating, likeThreshold, loveThreshold);
      if (current !== target) operations.push({
        direction: "trakt-to-stremio",
        kind,
        imdb: candidate.imdb,
        title: trakt.title ?? candidate.title,
        traktRating: trakt.rating,
        ratingStatus: target
      });
      continue;
    }
    const traktRating = mapStremioRating(current, likeThreshold, loveThreshold);
    if (traktRating !== null) operations.push({
      direction: "stremio-to-trakt",
      kind,
      imdb: candidate.imdb,
      title: candidate.title,
      traktRating,
      ratingStatus: current === "liked" || current === "loved" ? current : null
    });
  }
  const nextOffset = offset + batch.length >= totalRatings ? 0 : offset + batch.length;
  return { operations, offset, checked: batch.length, total: totalRatings, nextOffset };
}

function addTraktRatings(
  output: Map<string, { mediaType: "movie" | "series"; title: string | null; rating: number }>,
  value: unknown,
  mediaType: "movie" | "series"
): void {
  const field = mediaType === "movie" ? "movie" : "show";
  for (const itemValue of arrayValue(value)) {
    const item = recordValue(itemValue);
    const media = recordValue(item[field]);
    const ids = recordValue(media.ids);
    if (typeof ids.imdb !== "string" || typeof item.rating !== "number") continue;
    output.set(ratingKey(mediaType, ids.imdb), {
      mediaType,
      title: stringOrNull(media.title),
      rating: item.rating
    });
  }
}

function ratingKey(mediaType: "movie" | "series", imdb: string): string {
  return `${mediaType}:${imdb}`;
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

export function mapStremioRating(
  status: StremioRatingStatus,
  likeThreshold = 7,
  loveThreshold = 9
): number | null {
  if (status === "loved") return loveThreshold;
  if (status === "liked") return likeThreshold;
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
