import type { D1DatabaseLike } from "../storage/d1.js";
import { recordAppliedChanges } from "../storage/repositories/change-ledger.js";
import { setSyncCursor } from "../storage/repositories/sync-cursors.js";
import {
  activateLiveSync,
  getHostedSyncSettings,
  getLiveSyncActivation,
  upsertHostedSyncSettings
} from "../storage/repositories/users.js";
import { fetchStremioIdentity } from "../stremio/account.js";
import { fetchTraktIdentity } from "../trakt/device-oauth.js";
import {
  getCinemetaVideoSets,
  getStremioLibrary,
  sendStremioRatingStatus,
  stremioApiRequest,
  traktPost,
  type StremioLibraryItem
} from "./api-clients.js";
import { loadSyncCredentials } from "./credentials.js";
import { buildVisibleMovie, buildVisibleSeries, buildWatchedMovie, buildWatchedSeries } from "./library-changes.js";
import { operationFingerprint, previewWorkerSync, type BaselineOperation } from "./preview.js";
import { decodeWatchedField, encodeWatchedField } from "./watched-bitfield.js";

export async function applyWorkerSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  expectedFingerprint: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  cinemetaVideoIdsBase?: string | undefined;
  stremioLikesBase?: string | undefined;
}): Promise<Record<string, unknown>> {
  return applyWorkerSyncForScopes(input, ["test", "account"]);
}

export async function activateWorkerSync(input: {
  db: D1DatabaseLike;
  userId: string;
  encryptionKey: string;
  expectedFingerprint: string;
  confirmation: string;
  fetcher: typeof fetch;
  traktApiBase?: string | undefined;
  stremioApiBase?: string | undefined;
  cinemetaVideoIdsBase?: string | undefined;
  stremioLikesBase?: string | undefined;
}): Promise<Record<string, unknown>> {
  if (input.confirmation !== "ENABLE SYNCIO") throw new Error("Type ENABLE SYNCIO to activate live synchronization.");
  const settings = await getHostedSyncSettings(input.db, input.userId);
  if (settings.scope !== "account-preview") throw new Error("Live sync activation requires Preview only mode.");
  await upsertHostedSyncSettings(input.db, input.userId, settings);
  const result = await applyWorkerSyncForScopes(input, ["account-preview"]);
  const activation = await activateLiveSync(input.db, input.userId, input.expectedFingerprint);
  return { ...result, liveSync: "active", activatedAt: activation.activatedAt };
}

async function applyWorkerSyncForScopes(
  input: {
    db: D1DatabaseLike;
    userId: string;
    encryptionKey: string;
    expectedFingerprint: string;
    fetcher: typeof fetch;
    traktApiBase?: string | undefined;
    stremioApiBase?: string | undefined;
    cinemetaVideoIdsBase?: string | undefined;
    stremioLikesBase?: string | undefined;
  },
  allowedScopes: Array<"test" | "account-preview" | "account">
): Promise<Record<string, unknown>> {
  const settings = await getHostedSyncSettings(input.db, input.userId);
  if (!allowedScopes.includes(settings.scope)) throw new Error("Apply is not enabled for the current sync mode.");
  if (settings.scope === "account" && !await getLiveSyncActivation(input.db, input.userId)) {
    throw new Error("Live sync is not armed. Return to Preview only mode and activate it again.");
  }
  if (settings.removalsEnabled) throw new Error("Removal sync is not supported.");

  const report = await previewWorkerSync(input);
  const operations = extractOperations(report);
  const ratingCursor = extractRatingCursor(report);
  const fingerprint = await operationFingerprint(operations);
  if (fingerprint !== input.expectedFingerprint) {
    throw new Error("Preview changed. Run a new preview before applying.");
  }
  if (operations.length === 0) {
    await setSyncCursor(input.db, input.userId, ratingCursor.key, ratingCursor.nextOffset);
    return { ok: true, applied: 0, fingerprint, ratingNextOffset: ratingCursor.nextOffset };
  }

  const credentials = await loadSyncCredentials(input);
  const [stremioIdentity, traktIdentity] = await Promise.all([
    fetchStremioIdentity(credentials.stremio.authKey, input.fetcher, input.stremioApiBase),
    fetchTraktIdentity(credentials.trakt.clientId, credentials.trakt.accessToken, input.fetcher, input.traktApiBase)
  ]);
  if (stremioIdentity.userId !== credentials.stremio.userId) throw new Error("Stremio account guard failed during apply.");
  if (traktIdentity.username !== credentials.trakt.username) throw new Error("Trakt account guard failed during apply.");

  const toStremio = operations.filter((item) => item.direction === "trakt-to-stremio");
  const toTrakt = operations.filter((item) => item.direction === "stremio-to-trakt");
  const ratingOperations = toStremio.filter((item) => item.kind === "rating-movie");
  const libraryOperations = toStremio.filter((item) => item.kind !== "rating-movie");
  let stremioChanges = 0;
  if (libraryOperations.length > 0) {
    const library = await getStremioLibrary(credentials.stremio.authKey, input.fetcher, input.stremioApiBase);
    const changes = await buildChanges(libraryOperations, library, input.fetcher, input.cinemetaVideoIdsBase);
    await stremioApiRequest(
      "datastorePut",
      credentials.stremio.authKey,
      { collection: "libraryItem", changes },
      input.fetcher,
      input.stremioApiBase
    );
    stremioChanges = changes.length;
    await recordOperations(input.db, input.userId, libraryOperations);
  }
  if (ratingOperations.length > 0) {
    for (const operation of ratingOperations) {
      await sendStremioRatingStatus(
        credentials.stremio.authKey,
        operation.imdb,
        "movie",
        operation.ratingStatus ?? null,
        input.fetcher,
        input.stremioLikesBase
      );
    }
    await recordOperations(input.db, input.userId, ratingOperations);
  }

  const historyOperations = toTrakt.filter((item) =>
    item.kind === "watched-movie" || item.kind === "watched-episode"
  );
  const watchlistOperations = toTrakt.filter((item) =>
    item.kind === "watchlist-movie" || item.kind === "watchlist-series"
  );
  if (historyOperations.length > 0) {
    await traktPost(
      "/sync/history",
      buildTraktHistoryPayload(historyOperations),
      credentials.trakt.clientId,
      credentials.trakt.accessToken,
      input.fetcher,
      input.traktApiBase
    );
    await recordOperations(input.db, input.userId, historyOperations);
  }
  if (watchlistOperations.length > 0) {
    await traktPost(
      "/sync/watchlist",
      buildTraktWatchlistPayload(watchlistOperations),
      credentials.trakt.clientId,
      credentials.trakt.accessToken,
      input.fetcher,
      input.traktApiBase
    );
    await recordOperations(input.db, input.userId, watchlistOperations);
  }
  await setSyncCursor(input.db, input.userId, ratingCursor.key, ratingCursor.nextOffset);
  return {
    ok: true,
    applied: operations.length,
    stremioOperations: toStremio.length,
    stremioChanges,
    ratingOperations: ratingOperations.length,
    traktOperations: toTrakt.length,
    traktHistoryOperations: historyOperations.length,
    traktWatchlistOperations: watchlistOperations.length,
    ratingNextOffset: ratingCursor.nextOffset,
    fingerprint
  };
}

export function buildTraktHistoryPayload(operations: BaselineOperation[]): Record<string, unknown> {
  const movies = operations
    .filter((item) => item.direction === "stremio-to-trakt" && item.kind === "watched-movie")
    .map((item) => ({ ids: { imdb: item.imdb } }));
  const shows = new Map<string, { ids: { imdb: string }; seasons: Array<{ number: number; episodes: Array<{ number: number }> }> }>();
  for (const operation of operations) {
    if (operation.direction !== "stremio-to-trakt" || operation.kind !== "watched-episode") continue;
    if (operation.season === undefined || operation.episode === undefined) continue;
    let show = shows.get(operation.imdb);
    if (!show) {
      show = { ids: { imdb: operation.imdb }, seasons: [] };
      shows.set(operation.imdb, show);
    }
    let season = show.seasons.find((item) => item.number === operation.season);
    if (!season) {
      season = { number: operation.season, episodes: [] };
      show.seasons.push(season);
    }
    if (!season.episodes.some((item) => item.number === operation.episode)) {
      season.episodes.push({ number: operation.episode });
    }
  }
  return { movies, shows: Array.from(shows.values()) };
}

export function buildTraktWatchlistPayload(operations: BaselineOperation[]): Record<string, unknown> {
  const movies = operations
    .filter((item) => item.direction === "stremio-to-trakt" && item.kind === "watchlist-movie")
    .map((item) => ({ ids: { imdb: item.imdb } }));
  const shows = operations
    .filter((item) => item.direction === "stremio-to-trakt" && item.kind === "watchlist-series")
    .map((item) => ({ ids: { imdb: item.imdb } }));
  return { movies, shows };
}

async function recordOperations(db: D1DatabaseLike, userId: string, operations: BaselineOperation[]): Promise<void> {
  const appliedAt = new Date().toISOString();
  const entries = await Promise.all(operations.map(async (operation) => ({
    key: await operationFingerprint([operation]),
    userId,
    direction: operation.direction,
    kind: operation.kind,
    summary: operationSummary(operation)
  })));
  await recordAppliedChanges(db, entries, appliedAt);
}

async function buildChanges(
  operations: BaselineOperation[],
  library: StremioLibraryItem[],
  fetcher: typeof fetch,
  cinemetaVideoIdsBase?: string
): Promise<StremioLibraryItem[]> {
  const byId = new Map(library.map((item) => [item._id, item]));
  for (const operation of operations.filter((item) => item.kind === "watched-movie")) {
    byId.set(operation.imdb, buildWatchedMovie(
      byId.get(operation.imdb), operation.imdb, operation.title ?? operation.imdb, new Date().toISOString()
    ));
  }
  for (const operation of operations.filter((item) => item.kind === "watchlist-movie")) {
    byId.set(operation.imdb, buildVisibleMovie(byId.get(operation.imdb), operation.imdb, operation.title ?? operation.imdb));
  }
  for (const operation of operations.filter((item) => item.kind === "watchlist-series")) {
    byId.set(operation.imdb, buildVisibleSeries(byId.get(operation.imdb), operation.imdb, operation.title ?? operation.imdb));
  }

  const episodeOperations = operations.filter((item) => item.kind === "watched-episode");
  const showIds = Array.from(new Set(episodeOperations.map((item) => item.imdb)));
  const videoSets = await getCinemetaVideoSets(showIds, fetcher, cinemetaVideoIdsBase);
  for (const videoSet of videoSets) {
    const relevant = episodeOperations.filter((item) => item.imdb === videoSet.id);
    if (relevant.length === 0) continue;
    const existing = byId.get(videoSet.id);
    const decoded = await decodeWatchedField(
      typeof existing?.state?.watched === "string" ? existing.state.watched : null,
      videoSet.videos
    );
    for (const operation of relevant) {
      const videoId = `${operation.imdb}:${operation.season}:${operation.episode}`;
      const index = videoSet.videos.indexOf(videoId);
      if (index === -1) throw new Error(`Cinemeta no longer contains ${videoId}.`);
      decoded.values[index] = true;
    }
    const watchedField = await encodeWatchedField(decoded.values, videoSet.videos);
    byId.set(videoSet.id, buildWatchedSeries(
      existing,
      videoSet.id,
      videoSet.name ?? relevant[0]?.title ?? videoSet.id,
      watchedField,
      new Date().toISOString()
    ));
  }
  const changedIds = new Set(operations.map((item) => item.imdb));
  return Array.from(changedIds, (id) => byId.get(id)).filter((item): item is StremioLibraryItem => Boolean(item));
}

function extractOperations(report: Record<string, unknown>): BaselineOperation[] {
  const operations = report.operations;
  if (!operations || typeof operations !== "object") throw new Error("Preview has no operations.");
  const items = (operations as { items?: unknown }).items;
  if (!Array.isArray(items)) throw new Error("Preview operations are invalid.");
  return items as BaselineOperation[];
}

function extractRatingCursor(report: Record<string, unknown>): { key: string; nextOffset: number } {
  const scan = report.ratingScan;
  if (!scan || typeof scan !== "object") throw new Error("Preview has no rating cursor.");
  const key = (scan as { cursorKey?: unknown }).cursorKey;
  const nextOffset = (scan as { nextOffset?: unknown }).nextOffset;
  if (typeof key !== "string" || typeof nextOffset !== "number" || !Number.isInteger(nextOffset) || nextOffset < 0) {
    throw new Error("Preview rating cursor is invalid.");
  }
  return { key, nextOffset };
}

function operationSummary(operation: BaselineOperation): string {
  if (operation.kind === "watched-episode") {
    return `${operation.imdb} S${operation.season}E${operation.episode}`;
  }
  return `${operation.imdb} ${operation.title ?? ""}`.trim();
}
